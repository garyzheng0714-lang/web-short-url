import * as React from "react"
import { motion, useReducedMotion } from "motion/react"
import { CircleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SPRINGS } from "@/components/ui/ease"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { Spinner } from "@/components/ui/spinner"

/**
 * 动作按钮：提交一次异步动作（保存、发布、提交），结果就写在按钮自己身上（DESIGN.md §4.1、§4.3）。
 * 空闲（图标 + 动作）→ 处理中（转圈 + 进行时）→ 成功（✓ + 结果）或失败（ⓘ + 失败）→ resetAfter 毫秒后自己回到空闲。
 * - 处理中：aria-busy + aria-disabled（不用 disabled，键盘焦点留在按钮上），再点、再按回车都吞掉，不重复提交。
 * - 失败不假装成功、不悄悄复位：原位显示失败，错误交给 onActionError；过一会儿同样复位，期间再点就是重试。
 * - 成功、失败时再点：清掉复位计时，重新提交。卸载后 promise 才结束：不再改状态、不再起计时器。
 * - 读屏：按钮的名字始终是 label（aria-label）；处理中、结果由页面里一个 role="status" 念出。
 *
 * 动效（交给 Button 的「换文案」；DESIGN.md §5.2 morph）：
 * - 每次换状态（谁引起：点击，以及之后系统给出结果）→ 外框宽度 morph：变宽 snappy、变窄 smooth，中途再换从当前宽度、当前速度接着走；
 *   新的图标与文字 200ms 淡入、旧的 150ms 淡出，同时 blur 4px 交叉。✓ 的笔画从起笔画到收笔（snappy）。
 * - 转圈（时间）→ 匀速一圈 0.8s（Spinner）。
 * - 键盘（Enter / 空格）触发 → 宽度、文字、✓ 都 0ms 直接换。
 * - 减少动态 → 宽度直接到位，文字与图标只淡入淡出，✓ 不画；转圈改成明暗呼吸（Spinner）。
 * - 按压同 Button；处理中（aria-disabled）不缩放。
 */
type ActionState = "idle" | "pending" | "success" | "error"

type ActionButtonProps = Omit<React.ComponentProps<typeof Button>, "children" | "onClick" | "loading" | "asChild"> & {
  /** 动作，例如「保存修改」；也是按钮的无障碍名称 */
  label: string
  /** 空闲时文字前的图标 */
  icon?: React.ReactNode
  pendingLabel?: string
  successLabel?: string
  errorLabel?: string
  /** 返回 Promise：处理中直到它结束；拒绝时显示失败 */
  onAction: () => void | Promise<unknown>
  onActionError?: (error: unknown) => void
  /** 成功或失败停留的毫秒数；0 为不自动复位 */
  resetAfter?: number
}

/** ✓ 一笔画出；键盘或减少动态时直接是整笔（Button 在键盘时不做交叉，这里也不画） */
function DrawnCheck() {
  const reduce = useReducedMotion()
  const [draw] = React.useState(() => !fromKeyboard())
  return (
    // 线宽与 lucide 同为 1.5px（DESIGN.md §4.5）：24 视框画在 16 上是 2.25，sm 的 14 上是 2.57，lg 的 20 上是 1.8。
    // 不加 class lucide：non-scaling-stroke 会改动 pathLength 的虚线换算
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="in-data-[size=sm]:[stroke-width:2.57] in-data-[size=lg]:[stroke-width:1.8]">
      <motion.path d="M4 12l5 5L20 6" initial={{ pathLength: draw && !reduce ? 0 : 1 }} animate={{ pathLength: 1 }} transition={SPRINGS.snappy} />
    </svg>
  )
}

function ActionButton({
  label,
  icon,
  pendingLabel = "处理中",
  successLabel = "已完成",
  errorLabel = "失败",
  onAction,
  onActionError,
  resetAfter = 2400,
  className,
  ...props
}: ActionButtonProps) {
  const [state, setState] = React.useState<ActionState>("idle")
  const busy = React.useRef(false)
  const alive = React.useRef(true)
  const timer = React.useRef(0)
  React.useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      window.clearTimeout(timer.current)
    }
  }, [])

  const settle = (next: "success" | "error") => {
    setState(next)
    if (resetAfter > 0) timer.current = window.setTimeout(() => setState("idle"), resetAfter)
  }
  const run = async () => {
    if (busy.current) return
    busy.current = true
    window.clearTimeout(timer.current)
    setState("pending")
    try {
      await onAction()
      if (alive.current) settle("success")
    } catch (error) {
      if (alive.current) settle("error")
      onActionError?.(error)
    } finally {
      busy.current = false
    }
  }

  const pending = state === "pending"
  const face =
    state === "pending" ? (
      <>
        <Spinner aria-hidden />
        {pendingLabel}
      </>
    ) : state === "success" ? (
      <>
        <DrawnCheck />
        {successLabel}
      </>
    ) : state === "error" ? (
      <>
        <CircleAlert aria-hidden className="text-danger" />
        {errorLabel}
      </>
    ) : (
      <>
        {icon}
        {label}
      </>
    )

  return (
    <>
      <Button
        data-slot="action-button"
        data-action-state={state}
        {...props}
        className={className}
        aria-label={label}
        aria-busy={pending || undefined}
        aria-disabled={pending || props["aria-disabled"] || undefined}
        onClick={(e) => {
          // 处理中：吞掉点击与表单提交（回车、空格也会合成点击），焦点留在按钮上
          if (pending) return e.preventDefault()
          void run()
        }}
      >
        {face}
      </Button>
      {/* 读屏念处理中与结果；放在按钮外面：按钮的子元素对读屏是展示用的 */}
      <span role="status" className="sr-only">
        {pending ? pendingLabel : state === "success" ? successLabel : state === "error" ? errorLabel : ""}
      </span>
    </>
  )
}

export { ActionButton, type ActionButtonProps }
