import { nextFrame } from "@/components/ui/frame"

import { useEffect, useId, useRef, useState } from "react"
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue, type Transition } from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useInvariant } from "@/components/ui/invariant"
import { EXIT, SPRINGS } from "@/components/ui/ease"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { Spinner } from "@/components/ui/spinner"

/**
 * 长按确认（DESIGN.md K1、§4.3、§5.3）：删除这类不可逆、后果一句说得清的动作都用它——按住，底色从左往右填满，满了才执行；松手原路退回。
 * 指针捕获、移出、失焦与后台均取消；键盘也需完整按住，轻点与重复键不会执行动作。
 * 异步失败保留重试入口，卸载后不更新状态。
 * - label 必须以「按住」开头（不变量）：入口文字就是用法，按钮写「删除」会被当成点一下。
 * - 填充：危险按钮填成红实底、字变成红底上的字色；次按钮填成墨色实底；主按钮本来就是实底，填一层浅色。
 *   字的变色用同一组文字的第二份（只在填充层里、按同一条边裁出），两份文字位置完全重合，边线扫过哪里，哪里换色。
 * - onHoldChange：开始按住回 true；松手、移出、失焦、后台、变为 disabled、按满、卸载都回 false——成对出现，旁边的「继续按住」不会卡住。
 * - confirmed（受控）：撤销或请求失败后传 false 复位（进度归零、文字回到 label）；传 true 直接显示完成。不传就由组件自己管。
 * - 读屏：aria-describedby 指向一句看不见的说明（按住几秒、键盘怎么按），按钮名字就是当前文字；处理中、完成写进 role="status"。
 * - 宽度按三段文字里最长的一段预留，换字不改宽（§4.4 零跳动）。
 * - 触屏：长按不弹系统菜单、不选中文字（contextmenu 拦掉、user-select none、-webkit-touch-callout none）；手指开始滚动 = 取消。
 *
 * 动效（谁引起 → 用哪条 → 减少动态时；DESIGN.md §4.2）：
 * - 按住（指针主键，或键盘空格 / Enter）→ 时间驱动的匀速：进度在 holdDuration 内 linear 从左填满，满了才执行
 *   → 减少动态时不横向伸长，整块填充的深浅随进度变化（只留明暗）。
 * - 指针中途松手、移出 24px、失焦、页面后台 → 进度 SPRINGS.fast（0.08s）原路退回 0：按是慢的、要想；退是系统在回应，要快。
 *   再按从当前进度接着填 → 减少动态时直接归零。键盘松手直接归零。
 * - 按下 → Button 自己的按压：面向内收 1px（80ms 收、180ms 回，不缩放，DESIGN.md §4.1）。保留它：pointerdown 当帧要有回应（K2），
 *   按住的这一段面一直是收着的，手指还没离开。填充裁在和面一样大的盒子里，读同一组按钮变量（--btn-out / --btn-dur），
 *   面收的时候填充同一刻收，上下边不比面多出 1px。
 * - 按满 → 填充保持满格显示「正在…」；完成时填充 EXIT.fast（0.06s）淡出，露出原来的按钮和「✓ 已…」（结果不用大面积状态色，§4.1）。
 * - 指针按满（时间到）→ 文字模糊交叉：新字走 fast 全长（0.08s、easeOut）淡入、旧字 EXIT.fast（0.06s、easeIn）淡出，模糊 2px → 0；
 *   完成时对勾一笔画出（pathLength，SPRINGS.fast）；触屏完成时轻震一下（navigator.vibrate，设备不支持就什么都不做）
 *   → 键盘按满、减少动态时文字、对勾与填充淡出 0ms 直接换。
 * - confirmed 从外部复位（撤销）→ 同上的文字交叉；由键盘引起时 0ms；进度直接归零（按钮此刻没被按着，没有可退回的手势）。
 */
type HoldToConfirmProps = {
  onConfirm: () => void | Promise<unknown>
  label?: string
  pendingLabel?: string
  successLabel?: string
  holdDuration?: number
  disabled?: boolean
  /** 默认 danger（删除）；吊销、断开这类放在次要位置的用 secondary */
  variant?: "primary" | "secondary" | "danger"
  /** 和同一行别的按钮同一档（工具条里用 sm）；不写时随区域密度（Density） */
  size?: "sm" | "md"
  /** 受控的完成状态：撤销、请求失败后传 false 复位；不传由组件自己管 */
  confirmed?: boolean
  /** 按住开始（true）与结束（false），成对出现 */
  onHoldChange?: (holding: boolean) => void
  className?: string
}

type State = "idle" | "holding" | "pending" | "done" | "error"
type Face = "idle" | "pending" | "done"

/** 换字：出现走 fast 的全长（easeOut），消失走 EXIT.fast（easeIn），出现总比消失长（DESIGN.md §4.2「图标互换」同一套） */
const FADE_IN: Transition = { type: "tween", duration: 0.08, ease: "easeOut" }
const FADE_OUT: Transition = { ...EXIT.fast, ease: "easeIn" }
const INSTANT: Transition = { duration: 0 }
/** 填充层的颜色（写成 --hold-fill）：危险填红实底、次按钮填墨色实底（字一起换色）；主按钮本来就是实底，只叠一层浅色、字不换 */
const FILL = {
  danger: { bg: "[--hold-fill:var(--ds-danger)]", fg: "text-danger-fg" },
  secondary: { bg: "[--hold-fill:var(--ds-action)]", fg: "text-action-fg" },
  primary: { bg: "[--hold-fill:color-mix(in_srgb,currentColor_15%,transparent)]", fg: null },
} as const
/**
 * 填充裁在和按钮的面一样大的盒子里：平时满尺寸，按下时四边各收 1px（读按钮的 --btn-out，时长 --btn-dur：80 收 / 180 回），
 * 圆角跟按钮。原来填充是满尺寸、只靠按钮裁：面收 1px 时填充上下各多出 1px（2026-10-07 按住一半实测：面 34 高，填充 36 高）。
 * 动的是 1px 的 inset，不是位移：和面的阴影同一刻、同一条曲线收回，两者才对得上。
 */
const FILL_BOX =
  "pointer-events-none absolute inset-[calc(1px-var(--btn-out))] overflow-hidden [border-radius:inherit] [corner-shape:inherit] transition-[inset] [transition-duration:var(--btn-dur)] ease-ds"

function HoldToConfirm({ onConfirm, label = "按住确认", pendingLabel = "正在处理", successLabel = "已完成", holdDuration = 1200, disabled = false, variant = "danger", size = "md", confirmed, onHoldChange, className }: HoldToConfirmProps) {
  const [state, setState] = useState<State>(confirmed ? "done" : "idle")
  const fail = useInvariant("HoldToConfirm")
  useEffect(() => {
    if (!label.startsWith("按住")) fail(`label「${label}」要以「按住」开头：入口文字就是用法，写成「删除」会被当成点一下`)
  }, [label, fail])
  const hintId = useId()
  const button = useRef<HTMLButtonElement>(null)
  const source = useRef<number | string | null>(null)
  const touch = useRef(false)
  const bounds = useRef<DOMRect | null>(null)
  const running = useRef<{ stop: () => void } | null>(null)
  const busy = useRef(false), alive = useRef(true), holding = useRef(false)
  const reduced = useReducedMotion()
  const instantResponse = useRef(false)
  // 这一次换字要不要动：指针按满、外部复位（非键盘）才动；键盘、减少动态 0ms
  const [still, setStill] = useState(true)
  const progress = useMotionValue(0)
  const transform = useTransform(progress, value => `scaleX(${Math.min(1, Math.max(0, value))})`)
  // 换色的那份文字按同一条边裁：右边吃掉 (1 − 进度)，和底色 scaleX 的右沿同一处
  const clip = useTransform(progress, value => `inset(0 ${(1 - Math.min(1, Math.max(0, value))) * 100}% 0 0)`)
  // 回调总拿最新的：监听只挂一次
  const latest = useRef({ onHoldChange })
  latest.current = { onHoldChange }
  const setHolding = (next: boolean) => {
    if (holding.current === next) return
    holding.current = next
    latest.current.onHoldChange?.(next)
  }
  const resetProgress = () => {
    if (instantResponse.current) progress.set(0)
    else running.current = animate(progress, 0, SPRINGS.fast)
  }
  const cancel = () => {
    if (source.current === null) return
    source.current = null
    setHolding(false)
    running.current?.stop()
    if (busy.current) return
    setState("idle")
    resetProgress()
  }
  const confirm = async () => {
    if (busy.current || !alive.current) return
    const viaKeyboard = typeof source.current === "string"
    busy.current = true; source.current = null; setHolding(false)
    setStill(viaKeyboard || Boolean(reduced))
    if (touch.current) try { navigator.vibrate?.(10) } catch { /* 不支持震动的设备什么都不做 */ }
    setState("pending")
    try {
      await onConfirm()
      if (alive.current) setState("done")
    } catch {
      if (alive.current) { setState("error"); resetProgress() }
    } finally { busy.current = false }
  }
  const start = (key: number | string, pointerType?: string) => {
    if (disabled || busy.current || state === "done" || source.current !== null) return
    source.current = key
    touch.current = pointerType === "touch"
    instantResponse.current = typeof key === "string" || Boolean(reduced)
    running.current?.stop()
    setState("holding")
    setHolding(true)
    running.current = animate(progress, 1, { duration: Math.max(100, holdDuration) / 1000 * (1 - progress.get()), ease: "linear", onComplete: () => void confirm() })
  }
  // 受控复位：撤销或请求失败后，使用方把 confirmed 改回 false
  useEffect(() => {
    if (confirmed === undefined || busy.current) return
    if (confirmed && state !== "done") { setStill(fromKeyboard() || Boolean(reduced)); running.current?.stop(); progress.set(1); setState("done") }
    if (!confirmed && (state === "done" || state === "error")) { setStill(fromKeyboard() || Boolean(reduced)); running.current?.stop(); progress.set(0); setState("idle") }
    // 只在 confirmed 变化时对齐；state 由组件自己的流程推进
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed])
  useEffect(() => {
    alive.current = true
    const leave = () => cancel()
    const visibility = () => { if (document.hidden) cancel() }
    window.addEventListener("blur", leave)
    document.addEventListener("visibilitychange", visibility)
    return () => {
      alive.current = false; running.current?.stop()
      if (holding.current) latest.current.onHoldChange?.(false)
      window.removeEventListener("blur", leave); document.removeEventListener("visibilitychange", visibility)
    }
    // 监听器只读取 refs；不随每一帧进度重新绑定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!disabled) return
    if (instantResponse.current) return cancel()
    return nextFrame(cancel)
  }, [disabled])
  // 三段文字一直叠在同一格里，只换哪一段看得见：不挂载、不卸载，连着换也不会叠出两段
  const face: Face = state === "pending" ? "pending" : state === "done" ? "done" : "idle"
  const faces: [Face, string][] = [["idle", state === "error" ? "按住重试" : label], ["pending", pendingLabel], ["done", successLabel]]
  const longest = [label, pendingLabel, successLabel].reduce((a, b) => (b.length > a.length ? b : a))
  return (
    <div data-slot="hold-to-confirm" data-state={state} className={cn("inline-grid gap-part", className)}>
      <Button ref={button} variant={variant} size={size} disabled={disabled} aria-disabled={state === "pending" || state === "done" || undefined}
        aria-busy={state === "pending" || undefined} data-result={state === "done" || undefined} aria-describedby={hintId}
        // 按钮把内容包在一层 display: contents 的文案格里：让它也继承圆角，填充盒的 inherit 才拿得到按钮的圆角（否则是直角，按下时左边角被裁成斜口）
        className="relative overflow-hidden select-none [-webkit-touch-callout:none] [&>[data-slot=button-label]]:[border-radius:inherit] [&>[data-slot=button-label]]:[corner-shape:inherit]"
        onClick={e => e.preventDefault()}
        onContextMenu={e => e.preventDefault()}
        onPointerDown={e => {
          if (e.button !== 0 || !e.isPrimary || source.current !== null || busy.current || disabled || state === "done") return
          bounds.current = e.currentTarget.getBoundingClientRect()
          e.currentTarget.setPointerCapture(e.pointerId); start(e.pointerId, e.pointerType)
        }}
        onPointerMove={e => {
          if (source.current !== e.pointerId || !bounds.current) return
          const { left, right, top, bottom } = bounds.current
          if (e.clientX < left - 24 || e.clientX > right + 24 || e.clientY < top - 24 || e.clientY > bottom + 24) cancel()
        }}
        onPointerUp={e => { if (source.current === e.pointerId) cancel() }}
        onPointerCancel={cancel} onLostPointerCapture={cancel} onBlur={cancel}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing || (e.key !== " " && e.key !== "Enter")) return
          e.preventDefault(); if (!e.repeat) start(e.key)
        }}
        onKeyUp={e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (source.current === e.key) cancel() } }}>
        <HoldFace progress={progress} transform={transform} clip={clip} reduced={Boolean(reduced)} variant={variant} face={face} faces={faces} longest={longest} still={still} />
      </Button>
      {/* 必要提示：按钮只写了「按住删除」，读屏用户听不出要按多久、键盘怎么按住；这句只给读屏，不上界面（§4.2 键位不上界面）。 */}
      <span id={hintId} className="sr-only">{`按住 ${Math.round(Math.max(100, holdDuration) / 100) / 10} 秒确认，键盘按住空格或回车`}</span>
      {/* 必要提示：操作失败，需要在原处提供重新按住的入口。 */}
      {state === "error" && <span role="alert" className="sr-only">操作失败，请重试</span>}
      <span role="status" className="sr-only">{state === "pending" ? pendingLabel : state === "done" ? successLabel : ""}</span>
    </div>
  )
}

/**
 * 按钮里的全部内容（填充、占位、三段文字）。单独成一个组件、只收 props 不收 children：
 * Button 按「文字 + 元素类型」判断换文案，身份固定为 <HoldFace>，就不会在自己这层再做一次交叉——
 * 换字只由下面三段文字自己交叉（2026-10-04 复查：两层交叉叠在一起，处理中第一帧露出一块深色底和一块浅色框）。
 * 填充层里的第二份文字不带 data-hold-text（审计按它数「同一时刻只有一层字」），整层 aria-hidden。
 */
function HoldFace({ progress, transform, clip, reduced, variant, face, faces, longest, still }: {
  progress: MotionValue<number>
  transform: MotionValue<string>
  clip: MotionValue<string>
  reduced: boolean
  variant: keyof typeof FILL
  face: Face
  faces: [Face, string][]
  longest: string
  still: boolean
}) {
  const { bg, fg } = FILL[variant]
  return (
    <>
      {/* 占位：图标位 + 最长的一段文字，换字、出现对勾或加载圈都不改宽 */}
      <span aria-hidden className="invisible flex items-center gap-part"><span className="size-4" />{longest}</span>
      <Faces face={face} faces={faces} still={still} marked />
      {/* 填充层排在文字后面、盖在上面。完成时整层淡出，露出原来的按钮；复位后进度已是 0，再亮起来也看不见 */}
      <motion.span aria-hidden className={cn(FILL_BOX, bg)} initial={false}
        animate={{ opacity: face === "done" ? 0 : 1 }} transition={still || face !== "done" ? INSTANT : FADE_OUT}>
        <motion.span data-hold-progress className="absolute inset-0 origin-left bg-(--hold-fill)" style={reduced ? { opacity: progress } : { transform }} />
        {fg && (
          <motion.span data-hold-fill-text className={cn("absolute inset-0", fg)} style={reduced ? { opacity: progress } : { clipPath: clip }}>
            <Faces face={face} faces={faces} still={still} />
          </motion.span>
        )}
      </motion.span>
    </>
  )
}

/**
 * 叠在同一格里的三段文字：不挂载、不卸载，只换哪一段看得见，连着换也不会叠出两段。
 * marked：带 data-hold-text 的那一份（读屏与审计认它）；填充层里的第二份不带。
 */
function Faces({ face, faces, still, marked = false }: { face: Face; faces: [Face, string][]; still: boolean; marked?: boolean }) {
  return (
    <span aria-hidden={!marked || undefined} className="absolute inset-0 grid place-items-center">
      {faces.map(([name, words]) => {
        const on = name === face
        return (
          <motion.span key={name} data-hold-text={marked ? name : undefined} aria-hidden={!on || undefined} className="flex items-center gap-part [grid-area:1/1]"
            initial={false} animate={on ? { willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 1, filter: "blur(0px)" } : { willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 0, filter: "blur(2px)" }}
            transition={still ? INSTANT : on ? FADE_IN : FADE_OUT}>
            {name === "pending" && on ? <Spinner delay={400} /> : name === "done" ? <DrawnCheck on={on} still={still} marked={marked} /> : null}{words}
          </motion.span>
        )
      })}
    </span>
  )
}

/** 完成的对勾：和 lucide Check 同一条路径，一笔画出（SPRINGS.fast）；键盘、减少动态时直接出现。收起时等文字淡完再收回长度，下次重新画 */
function DrawnCheck({ on, still, marked }: { on: boolean; still: boolean; marked: boolean }) {
  return (
    <svg aria-hidden data-slot={marked ? "hold-to-confirm-check" : undefined} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-4">
      <motion.path d="M20 6 9 17l-5-5" initial={false} animate={{ pathLength: on ? 1 : 0 }}
        transition={still ? INSTANT : on ? SPRINGS.fast : { duration: 0, delay: EXIT.fast.duration }} />
    </svg>
  )
}

export { HoldToConfirm, type HoldToConfirmProps }
