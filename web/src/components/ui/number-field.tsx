import * as React from "react"
import { CircleAlert, Minus, Plus } from "lucide-react"
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { EXIT, SPRINGS } from "@/components/ui/ease"
import { useFieldControl } from "@/components/ui/field"
import { fromKeyboard, isComposing } from "@/components/ui/hotkeys"
import { useFieldSurface } from "@/components/ui/input"

/**
 * 数字框：有上下限的数量（席位、份数、天数、金额）。[− 数字 单位 +] 一颗凹槽，数字和单位一起居中，等宽数字，位数变了宽度不跳。
 * - 点 ± 一步；按住 400ms 后连发并加速（150ms → 40ms），松手、移出按钮、指针取消、窗口失焦、切到后台都停；到上下限停。
 * - ↑ ↓ 一步，Shift+↑↓ / PageUp / PageDown 大步（largeStep），没在打字时 Home / End 到上下限。
 * - 到上下限时那颗按钮变淡（aria-disabled，不用 disabled：焦点不丢、还能再按）；再按，数字朝按的方向挣一下，框上方冒出「最多 10 个」。
 * - 直接输入：只收数字（全角转半角）、一个小数点（step 有小数时）、负号（min < 0 时）；超限时框描红（aria-invalid）并提示上限，
 *   回车或失焦才夹回上下限（DESIGN.md §4.3：不在打字时改写），Esc 撤回草稿。小数按 step 的位数取整，不出现 0.30000000000000004。
 * - label 必填：步进按钮叫「增加{label}」「减少{label}」，不在 Field 里时也是输入框的名字。unit 可以是函数（1 晚 / 2 晚）。
 * - 受控 value / 非受控 defaultValue；name 写进隐藏 input（提交的是数字）。放进 Field 自动接线（useFieldControl）。
 *
 * 外观与状态同 Input（DESIGN.md §4.3：禁用 → 出错 → 聚焦 → 悬停 → 静止；FieldGroup 里换成 quiet 外观）；高度是控件档 36 · 28，
 * ± 是控件高 − 8 的正方，离框 4（外壳 = 外圆角 − 内圆角），图标 16 · 14。
 *
 * 动效（DESIGN.md §4.2）：
 * - 指针在上下限再按 → 数字朝按的方向挣 4px 再回零：去和回各走一段 fast 弹簧（0.08s），连按从当前位置接着走；
 *   提示淡入 fast、1.5 秒后淡出（fast 的退场 0.06s）。
 * - 按下 ± → 底色当帧加深一档（bg-active，同字段里别的部件），松手回去；不缩放（DESIGN.md §4.1：按下不用缩放）。
 *   悬停：底色与图标颜色 80ms，图标线 1.5 → 2。
 * - 键盘（方向键、PageUp/Down、Home/End、回车夹紧）→ 0ms：数字直接换，到限不挣，提示直接出现。
 * - 数字本身直接换（每天按很多次，高频；不做数位滚动）。
 * - 减少动态 → 不挣，提示只淡入淡出。
 */

const decimalsOf = (n: number) => {
  const s = String(n)
  return s.includes("e-") ? Number(s.split("e-")[1]) : (s.split(".")[1]?.length ?? 0)
}

function StepButton({
  dir,
  label,
  atLimit,
  disabled,
  onStart,
  onStop,
  onKeyboard,
}: {
  dir: 1 | -1
  label: string
  atLimit: boolean
  disabled?: boolean
  onStart: () => void
  onStop: () => void
  onKeyboard: () => void
}) {
  // 按下态写在 data-pressed 上（不用 :active：按住移出按钮时 :active 还在，底却该回来）
  const stop = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.removeAttribute("data-pressed")
    onStop()
  }
  return (
    <button
      type="button"
      tabIndex={-1}
      data-slot={dir > 0 ? "number-field-increment" : "number-field-decrement"}
      aria-label={`${dir > 0 ? "增加" : "减少"}${label}`}
      aria-disabled={atLimit || undefined}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        // 不抢焦点：正在输入就留在框里
        e.preventDefault()
        e.currentTarget.setAttribute("data-pressed", "")
        onStart()
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      // 读屏、开关控制这类没有指针的「点击」
      onClick={(e) => e.detail === 0 && onKeyboard()}
      className={cn(
        "hit-area relative grid size-[calc(var(--ds-h-md)-8px)] shrink-0 touch-manipulation place-items-center rounded-control-in text-fg-muted outline-none",
        "transition-[background-color,color,opacity] duration-(--ds-dur-fast) ease-ds hover:bg-hover hover:text-fg data-pressed:bg-active data-pressed:transition-none",
        "[&_svg.lucide]:transition-[stroke-width] [&_svg.lucide]:duration-(--ds-dur-fast) hover:not-aria-disabled:[&_svg.lucide]:stroke-2",
        "aria-disabled:opacity-40 aria-disabled:hover:bg-transparent disabled:pointer-events-none"
      )}
    >
      {dir > 0 ? <Plus className="size-(--ds-icon)" aria-hidden /> : <Minus className="size-(--ds-icon)" aria-hidden />}
    </button>
  )
}

function NumberField({
  label,
  value,
  defaultValue = 0,
  onValueChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  largeStep,
  unit,
  name,
  disabled,
  id,
  "aria-describedby": describedBy,
  "aria-invalid": ariaInvalid,
  className,
}: {
  /** 必填：步进按钮叫「增加{label}」「减少{label}」；不在 Field 里时也是输入框的名字 */
  label: string
  value?: number
  defaultValue?: number
  onValueChange?: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** PageUp / PageDown、Shift+方向键的步长，默认 step × 10 */
  largeStep?: number
  /** 数字后面的单位；函数可以按数值换（1 晚 / 2 晚） */
  unit?: string | ((value: number) => string)
  /** 写进隐藏 input，提交的是数字 */
  name?: string
  disabled?: boolean
  id?: string
  "aria-describedby"?: string
  "aria-invalid"?: React.AriaAttributes["aria-invalid"]
  className?: string
}) {
  const reduce = useReducedMotion()
  const hintId = `${React.useId()}-limit`
  const decimals = Math.max(decimalsOf(step), decimalsOf(min === -Infinity ? 0 : min))
  const round = (n: number) => Number(n.toFixed(decimals))
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const format = (n: number) => n.toFixed(decimals)

  const [inner, setInner] = React.useState(defaultValue)
  const committed = value ?? inner
  const cur = React.useRef(committed)
  cur.current = committed
  const [draft, setDraftState] = React.useState<string | null>(null)
  // 连发在定时器里走，读的是最新的草稿
  const draftRef = React.useRef(draft)
  draftRef.current = draft
  const setDraft = (d: string | null) => {
    draftRef.current = d
    setDraftState(d)
  }
  const composing = React.useRef(false)
  const lastValid = React.useRef("")
  const input = React.useRef<HTMLInputElement>(null)

  // 到限提示：哪条边、是不是键盘引起的；按出来的 1.5 秒后收起，打字超限的一直在
  const [pushed, setPushed] = React.useState<{ edge: "min" | "max"; instant: boolean } | null>(null)
  const pushTimer = React.useRef<number | undefined>(undefined)
  const strain = useMotionValue(0)
  const strainRun = React.useRef(0)

  const parse = (d: string | null) => (d === null || d === "" || d === "-" || d === "." ? null : Number(d))
  const parsed = parse(draft)
  const over = parsed === null || Number.isNaN(parsed) ? null : parsed > max ? "max" : parsed < min ? "min" : null
  const edge = over ?? pushed?.edge ?? null
  const unitOf = (n: number) => (typeof unit === "function" ? unit(n) : (unit ?? ""))
  const hint = edge ? `${edge === "max" ? "最多" : "最少"} ${format(edge === "max" ? max : min)}${unitOf(edge === "max" ? max : min) ? ` ${unitOf(edge === "max" ? max : min)}` : ""}` : ""

  const control = useFieldControl({ id, "aria-describedby": [describedBy, over ? hintId : null].filter(Boolean).join(" ") || undefined, "aria-invalid": ariaInvalid })
  const invalid = Boolean(over) || control["aria-invalid"] === true || control["aria-invalid"] === "true"

  const set = (next: number) => {
    const v = round(clamp(next))
    if (v === cur.current) return
    cur.current = v
    if (value === undefined) setInner(v)
    onValueChange?.(v)
  }
  const atLimit = (dir: 1 | -1, via: "pointer" | "keyboard") => {
    window.clearTimeout(pushTimer.current)
    setPushed({ edge: dir > 0 ? "max" : "min", instant: via === "keyboard" })
    pushTimer.current = window.setTimeout(() => setPushed(null), 1500)
    // 先向边界轻推 4px，再回零；不给首帧注入冲量（原 260px/s 会在首帧走过约 67%）。
    const id = ++strainRun.current
    if (via === "pointer" && !reduce) {
      let returning = false
      animate(strain, dir * 4, {
        ...SPRINGS.fast,
        onUpdate: (value) => {
          // 接近峰值就带着当前速度回程；不等待弹簧的静止尾部，整次反馈在 600ms 内归零。
          if (!returning && strainRun.current === id && value * dir >= 3.2) {
            returning = true
            animate(strain, 0, SPRINGS.fast)
          }
        },
      })
    } else strain.jump(0)
  }
  /** 走一步；到限返回 false（连发就此停下） */
  const stepBy = (dir: 1 | -1, big: boolean, via: "pointer" | "keyboard") => {
    if (disabled) return false
    let base = cur.current
    if (draftRef.current !== null) {
      const typed = parse(draftRef.current)
      if (typed !== null && !Number.isNaN(typed)) base = round(clamp(typed))
      setDraft(null)
    }
    const next = round(clamp(base + dir * (big ? (largeStep ?? step * 10) : step)))
    if (next === base) {
      if (base !== cur.current) set(base)
      atLimit(dir, via)
      return false
    }
    set(next)
    return true
  }
  const commit = () => {
    if (draft === null) return
    if (parsed !== null && !Number.isNaN(parsed)) set(parsed)
    setDraft(null)
  }

  // 按住连发：400ms 后开始，间隔 150ms 起每步乘 0.8，最快 40ms
  const hold = React.useRef<number | undefined>(undefined)
  const stopHold = React.useCallback(() => {
    window.clearTimeout(hold.current)
    hold.current = undefined
  }, [])
  const startHold = (dir: 1 | -1) => {
    stopHold()
    if (!stepBy(dir, false, "pointer")) return
    let delay = 150
    const tick = () => {
      if (!stepBy(dir, false, "pointer")) return stopHold()
      delay = Math.max(40, delay * 0.8)
      hold.current = window.setTimeout(tick, delay)
    }
    hold.current = window.setTimeout(tick, 400)
  }
  React.useEffect(() => {
    const off = () => stopHold()
    const hidden = () => document.hidden && stopHold()
    window.addEventListener("blur", off)
    document.addEventListener("visibilitychange", hidden)
    return () => {
      window.removeEventListener("blur", off)
      document.removeEventListener("visibilitychange", hidden)
      stopHold()
      strainRun.current++
      strain.stop()
      window.clearTimeout(pushTimer.current)
    }
  }, [stopHold])

  const allowed = new RegExp(`^${min < 0 ? "-?" : ""}\\d*${decimals > 0 ? "(\\.\\d*)?" : ""}$`)
  const accept = (raw: string) => {
    const s = raw.normalize("NFKC").replace(/\s/g, "")
    if (!allowed.test(s)) return
    lastValid.current = s
    setDraft(s)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(e.nativeEvent) || composing.current) return
    const big = e.shiftKey || e.key === "PageUp" || e.key === "PageDown"
    if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "ArrowDown" || e.key === "PageDown") {
      e.preventDefault()
      stepBy(e.key === "ArrowUp" || e.key === "PageUp" ? 1 : -1, big, "keyboard")
    } else if ((e.key === "Home" || e.key === "End") && draft === null && Number.isFinite(e.key === "Home" ? min : max)) {
      e.preventDefault()
      set(e.key === "Home" ? min : max)
    } else if (e.key === "Enter" && draft !== null) {
      // 有草稿：这一下回车是确认数字，不提交表单
      e.preventDefault()
      commit()
    } else if (e.key === "Escape" && draft !== null) {
      e.preventDefault()
      e.stopPropagation()
      setDraft(null)
    }
  }

  const shownText = draft ?? format(committed)
  const shownValue = parsed !== null && !Number.isNaN(parsed) ? parsed : committed
  const unitText = unitOf(shownValue)
  const hintInstant = over ? fromKeyboard() : (pushed?.instant ?? true)
  const surface = useFieldSurface()
  return (
    <div data-slot="number-field" className={cn("relative w-48 max-w-full", className)}>
      <div
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
        className={cn(surface, "flex h-(--ds-h-md) w-full items-center rounded-control px-1 text-md leading-(--ds-lh-control)")}
      >
        <StepButton dir={-1} label={label} atLimit={committed <= min} disabled={disabled} onStart={() => startHold(-1)} onStop={stopHold} onKeyboard={() => stepBy(-1, false, "keyboard")} />
        {/* 点数字两边的空白也是点输入框 */}
        <label className="flex h-full min-w-0 flex-1 cursor-text items-center justify-center" htmlFor={control.id}>
          <motion.span data-slot="number-field-value" className="flex min-w-0 items-baseline gap-1" style={{ x: strain }}>
            <span className="relative inline-grid min-w-0">
              <span aria-hidden className="invisible col-start-1 row-start-1 px-px whitespace-pre tabular-nums">
                {shownText || "0"}
              </span>
              <input
                ref={input}
                id={control.id}
                type="text"
                // 宽度由镜像按数字撑出；size=1 让输入框自己不贡献默认的 20 个字宽
                size={1}
                inputMode={decimals > 0 ? "decimal" : "numeric"}
                role="spinbutton"
                autoComplete="off"
                aria-label={control.labelledBy ? undefined : label}
                aria-labelledby={control.labelledBy}
                aria-describedby={control["aria-describedby"]}
                aria-invalid={invalid || undefined}
                aria-valuenow={committed}
                aria-valuemin={Number.isFinite(min) ? min : undefined}
                aria-valuemax={max < Number.MAX_SAFE_INTEGER ? max : undefined}
                aria-valuetext={`${format(committed)}${unitOf(committed) ? ` ${unitOf(committed)}` : ""}`}
                disabled={disabled}
                value={shownText}
                onChange={(e) => (composing.current ? setDraft(e.target.value) : accept(e.target.value))}
                onCompositionStart={() => {
                  composing.current = true
                  lastValid.current = draft ?? format(committed)
                }}
                onCompositionEnd={(e) => {
                  composing.current = false
                  const s = e.currentTarget.value.normalize("NFKC").replace(/\s/g, "")
                  if (allowed.test(s)) accept(s)
                  else setDraft(lastValid.current)
                }}
                onKeyDown={onKeyDown}
                onBlur={commit}
                className="col-start-1 row-start-1 w-full min-w-0 bg-transparent px-px text-center text-fg tabular-nums outline-none disabled:cursor-not-allowed"
              />
            </span>
            {unitText ? <span className="shrink-0 text-fg-muted">{unitText}</span> : null}
          </motion.span>
        </label>
        <StepButton dir={1} label={label} atLimit={committed >= max} disabled={disabled} onStart={() => startHold(1)} onStop={stopHold} onKeyboard={() => stepBy(1, false, "keyboard")} />
      </div>
      <AnimatePresence>
        {hint ? (
          <motion.span
            key="hint"
            id={hintId}
            data-slot="number-field-limit"
            // 行高取标签行（--ds-lh-sm）：放进 Field 时提示落在标签行右端，13 号字与 15 号标签对基线（DESIGN.md §3.2.3）
            className={cn("pointer-events-none absolute bottom-full mb-2 flex items-center gap-1 text-xs leading-(--ds-lh-sm) whitespace-nowrap text-fg-muted", edge === "max" ? "right-0" : "left-0")}
            initial={hintInstant ? false : { opacity: 0 }}
            animate={{ opacity: 1, transition: SPRINGS.fast }}
            exit={{ opacity: 0, transition: hintInstant ? { duration: 0 } : EXIT.fast }}
          >
            {/* 13 号字配 14 号图标（DESIGN.md §4.5）；打字超限是出错，图标随框描红 */}
            <CircleAlert className={cn("size-3.5", over ? "text-danger" : "text-warning")} aria-hidden />
            {hint}
          </motion.span>
        ) : null}
      </AnimatePresence>
      <span role="status" className="sr-only">
        {hint}
      </span>
      {name ? <input type="hidden" name={name} value={format(committed)} /> : null}
    </div>
  )
}

export { NumberField }
