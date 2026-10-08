"use client"


import { nextFrame } from "@/components/ui/frame"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react"
import { Undo2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SPRINGS } from "@/components/ui/ease"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { useInvariant } from "@/components/ui/invariant"
import { MorphSurface } from "@/components/ui/morph-surface"
import { Spinner } from "@/components/ui/spinner"

/**
 * 原位确认（DESIGN.md K1、§4.3、§5.3）：发布、转交、关闭这类不可逆、后果一句说得清、又不是删除的动作——
 * 入口 → 问一句 → 处理中 → 结果 / 撤销，同一位置、同一张面。删除用 HoldToConfirm（长按确认），label 里出现「删除」即违反不变量。
 * 先聚焦取消，失败保持问题与重试入口；倒计时在悬停、聚焦和后台暂停，不擅自关闭正在使用的面。
 * - 入口是 ghost 按钮：icon 可选（发布配 Send 这类动作图标）；问题面的确认按钮默认主按钮，tone="danger" 时红实底（降低安全性的动作，如关闭两步验证）。
 *
 * 动效：
 * - 展开、换面、收起（指针点击 / 系统换步骤）→ MorphSurface：外框两条边走同一档弹簧、内容淡入淡出，原路缩回（档位与时长见 morph-surface.tsx）。
 * - 结果面的对勾（系统给出结果）→ 笔画从起笔画到收笔，SPRINGS.fast（0.08s、不回弹）；键盘确认、减少动态时直接是整笔。
 * - 处理中：按下的确认按钮被换掉，焦点交给整块（tabIndex −1），Tab 接着往后走，不从页首重来。
 * - 撤销倒计时线（时间）→ 匀速：resetAfter 毫秒内 linear 从满收到 0，悬停、聚焦、页面后台时停住（DESIGN.md §5.1 时间）。
 *   减少动态时线不缩短，整条线随剩余时间变淡（只留明暗）。
 * - 键盘（Enter 打开、Esc 收起）→ 0ms。
 */
/** 成功的对勾从起笔画到收笔（SPRINGS.fast）；键盘确认、减少动态时直接是整笔 */
function DrawnCheck({ instant }: { instant: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-4 shrink-0 text-success">
      <motion.path d="M4 12l5 5L20 6" initial={{ pathLength: instant ? 1 : 0 }} animate={{ pathLength: 1 }} transition={SPRINGS.fast} />
    </svg>
  )
}

type ConfirmMorphProps = {
  /** 入口按钮的文字，写动作本身（「发布」「转交」）；不能是删除 */
  label: string
  /** 入口按钮里文字前的图标（lucide） */
  icon?: ReactNode
  /** 问题面里确认按钮的文字，默认和 label 一样（「移除」就写「移除」） */
  confirmLabel?: string
  /** 问题面的一句话，写清后果（「发给全体成员？」） */
  prompt: string
  pendingLabel?: string
  successLabel?: string
  onConfirm: () => void | Promise<unknown>
  onUndo?: () => void | Promise<unknown>
  resetAfter?: number
  disabled?: boolean
  /** danger：确认按钮红实底（降低安全性、停用一类）；默认主按钮 */
  tone?: "default" | "danger"
}

function ConfirmMorph({ label, icon, confirmLabel = label, prompt, pendingLabel = `正在${label}`, successLabel = `已${label}`, onConfirm, onUndo, resetAfter = 5000, disabled = false, tone = "default" }: ConfirmMorphProps) {
  const fail = useInvariant("ConfirmMorph")
  useEffect(() => {
    if (/删除/.test(label + confirmLabel)) fail(`「${label}」是删除：删除用 HoldToConfirm（长按确认，DESIGN.md K1），原位确认只给发布、转交这类动作`)
  }, [label, confirmLabel, fail])
  const [state, setState] = useState<"idle" | "confirm" | "pending" | "done">("idle")
  const [error, setError] = useState("")
  const [pauses, setPauses] = useState({ pointer: false, focus: false, hidden: false })
  const paused = pauses.pointer || pauses.focus || pauses.hidden
  const [undoing, setUndoing] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  const busy = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const undo = useRef<HTMLButtonElement>(null)
  const progress = useMotionValue(1)
  const reduced = useReducedMotion()
  const scaleX = useTransform(progress, v => `scaleX(${v})`)
  const previous = useRef(state)
  const restoreFocus = useRef(true), keyboardResult = useRef(false)
  const open = state !== "idle"
  // 这一轮的文案在离开入口时定下：确认后使用方常把入口换成下一步（「发布」→「撤回」），结果面不能跟着变成「已撤回」
  const cycle = useRef({ confirmLabel, pendingLabel, successLabel })
  if (state === "idle") cycle.current = { confirmLabel, pendingLabel, successLabel }
  const round = cycle.current
  const pendingText = undoing ? "正在撤销" : round.pendingLabel
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (state === "confirm") cancel.current?.focus({ preventScroll: true })
    // 处理中：刚按下的确认按钮被换掉了，焦点交给整块，不掉到页首
    if (state === "pending" && (document.activeElement === document.body || root.current?.contains(document.activeElement))) root.current?.focus({ preventScroll: true })
    if (state === "done" && keyboardResult.current) undo.current?.focus({ preventScroll: true })
    if (state === "idle" && previous.current !== "idle" && restoreFocus.current) trigger.current?.focus({ preventScroll: true })
    // 只有焦点停在面里的按钮上才算「正在用」：处理中由组件自己把焦点交给整块，那不是用户在看，倒计时照走
    setPauses(p => ({ ...p, focus: Boolean(root.current?.contains(document.activeElement) && document.activeElement !== root.current) }))
    previous.current = state
  }, [state])
  useEffect(() => {
    const visibility = () => setPauses(p => ({ ...p, hidden: document.hidden }))
    visibility()
    document.addEventListener("visibilitychange", visibility)
    return () => document.removeEventListener("visibilitychange", visibility)
  }, [])
  useEffect(() => {
    if (state !== "done" || paused || resetAfter <= 0) return
    return nextFrame(() => {
      const timer = animate(progress, 0, { duration: resetAfter / 1000 * progress.get(), ease: "linear", onComplete: () => { restoreFocus.current = false; setState("idle") } })
      return () => timer.stop()
    })
  }, [state, paused, resetAfter, progress])
  const close = (restore = true) => { if (busy.current) return; restoreFocus.current = restore; setState("idle"); setError("") }
  useEffect(() => {
    if (state !== "confirm") return
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) close(false) }
    document.addEventListener("pointerdown", outside)
    return () => document.removeEventListener("pointerdown", outside)
  }, [state])
  const run = async (revert = false) => {
    if (busy.current) return
    keyboardResult.current = fromKeyboard(); restoreFocus.current = true; setUndoing(revert)
    busy.current = true
    setState("pending"); setError("")
    try {
      await (revert ? onUndo?.() : onConfirm())
      if (!alive.current) return
      progress.set(1)
      setState(revert ? "idle" : "done")
      if (revert) trigger.current?.focus({ preventScroll: true })
    } catch {
      if (alive.current) { setError(revert ? "撤销失败，请重试" : `${round.confirmLabel}失败，请重试`); setState(revert ? "done" : "confirm") }
    } finally { busy.current = false }
  }
  return (
    <div ref={root} data-slot="confirm-morph" data-state={state} tabIndex={-1} className="outline-none"
      onPointerEnter={() => setPauses(p => ({ ...p, pointer: true }))} onPointerLeave={() => setPauses(p => ({ ...p, pointer: false }))}
      onFocusCapture={e => setPauses(p => ({ ...p, focus: e.target !== e.currentTarget }))} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) setPauses(p => ({ ...p, focus: false })) }}
      onKeyDown={e => { if (e.key === "Escape" && !busy.current) { e.stopPropagation(); close() } }}>
      <MorphSurface open={open} face={state} width={state === "confirm" ? 320 : 208} panelClassName="overflow-hidden rounded-control"
        trigger={<Button ref={trigger} variant="ghost" disabled={disabled} onClick={() => { setError(""); setState("confirm") }}>{icon}{label}</Button>}>
        <div role={state === "confirm" ? "group" : undefined} aria-label={state === "confirm" ? prompt : undefined}
          aria-busy={state === "pending" || undefined} className="grid gap-part p-part">
          {/* 面和入口一样高（p-part + sm 按钮 = h-md）：只向左长，不盖住上下行；按钮圆角 = 面圆角 − p-part，同心 */}
          {state === "confirm" ? (
            <div className="flex items-center gap-part">
              <span className="min-w-0 flex-1 truncate ps-(--ds-pad-x-sm) text-sm">{prompt}</span>
              <Button ref={cancel} size="sm" variant="ghost" className="rounded-control-in" onClick={() => close()}>取消</Button>
              <Button size="sm" variant={tone === "danger" ? "danger-confirm" : "primary"} className="rounded-control-in" onClick={() => void run()}>{round.confirmLabel}</Button>
            </div>
          ) : state === "pending" ? (
            <div className="flex h-(--ds-h-sm) items-center justify-center gap-part text-sm"><Spinner delay={400} />{pendingText}</div>
          ) : (
            <div className="flex items-center gap-item ps-(--ds-pad-x-sm)">
              <DrawnCheck instant={keyboardResult.current || Boolean(reduced)} />
              <span className="min-w-0 flex-1 truncate text-sm">{round.successLabel}</span>
              <Button ref={undo} size="sm" variant="ghost" className="rounded-control-in" onClick={() => onUndo ? void run(true) : close()}>{onUndo ? <><Undo2 aria-hidden />撤销</> : "完成"}</Button>
            </div>
          )}
          {/* 必要提示：异步操作已经失败，保留当前状态并给出重试入口。 */}
          {error && <p role="alert" className="px-(--ds-pad-x-sm) pb-part text-xs text-fg">{error}</p>}
        </div>
        {state === "done" && resetAfter > 0 && <motion.span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-fg-subtle/30" style={reduced ? { opacity: progress } : { transform: scaleX }} />}
      </MorphSurface>
      <span role="status" className="sr-only">{state === "done" ? round.successLabel : state === "pending" ? pendingText : error}</span>
    </div>
  )
}

export { ConfirmMorph, type ConfirmMorphProps }
