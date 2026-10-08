import { nextFrame } from "@/components/ui/frame"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { DUR, EASE_OUT, SPRINGS } from "@/components/ui/ease"

/**
 * 加载中：时长未知的短等待，颜色跟随 currentColor。超过几秒的任务用 Progress 或骨架屏。
 * 尺寸 12 / 16 / 20，分别配 13 / 15 / 17 的文字；线宽 1.5，与图标一致。
 * status：结果就在同一个位置出现（uiarc 的 morph-loader）——成功时转圈停下、底圈合成一整圈、圈里画出 ✓；失败画出 ✕。
 * 形状区分成功和失败，不只靠颜色；尺寸固定，换状态不挪布局。回到 loading 就收起记号、接着转。
 *
 * 动效（DESIGN.md §5.1 时间 / 系统）：
 * - 常驻（时间驱动）→ 匀速：整圈旋转，0.8 秒一圈 linear（它是状态，不是动作，不要缓动）。
 * - delay（毫秒，系统）→ 区块级加载传 400：400ms 内完成的操作不闪出加载圈；到点后 200ms ease-out 淡入（延迟期间占位但不可见）。按钮内用默认 0，立刻出现。
 * - 出结果（系统）→ 转圈原地停住（不回正、不跳），弧 150 淡出、底圈 200 淡入成实线；记号从起笔画到收笔，整枚从 0.9 弹到 1，都是 snappy（小东西换状态）。
 *   回到 loading → 记号 150 淡出、弧淡入，接着从停的角度转。第一次渲染就是结果的不播。
 * - 减少动态效果 → 不转，改成 2 秒一次的慢速透明度呼吸，对称缓入缓出（它本身是状态，不能完全静止）；出结果直接换成记号，不画、不弹。
 */
const KEYFRAMES = "@keyframes ds-spin{to{transform:rotate(1turn)}}@keyframes ds-breathe{50%{opacity:.35}}"

const spinnerVariants = cva("shrink-0", {
  variants: {
    size: { sm: "size-3", md: "size-4", lg: "size-5" },
  },
  defaultVariants: { size: "md" },
})

type Status = "loading" | "success" | "error"

/** 记号：✓ 两笔（短 → 长）、✕ 两笔；都画在 r = 6.25 的圈里 */
const MARKS: Record<Exclude<Status, "loading">, string> = {
  success: "M5.25 8.25 L7.25 10.25 L10.75 6",
  error: "M6 6 L10 10 M10 6 L6 10",
}
const TONE: Record<Exclude<Status, "loading">, string> = { success: "text-success", error: "text-danger" }

function Spinner({
  className,
  size,
  label = "加载中",
  successLabel = "已完成",
  errorLabel = "失败",
  status = "loading",
  tone = true,
  decorative = false,
  delay = 0,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof spinnerVariants> & {
    label?: string
    successLabel?: string
    errorLabel?: string
    /** loading 转圈；success 收成 ✓；error 收成 ✕ */
    status?: Status
    /** 成功用 success 色、失败用 danger 色；false 时跟随文字颜色 */
    tone?: boolean
    /** 放在自己会念状态的控件里（按钮）：去掉 role=status 和读屏文字，免得念两遍 */
    decorative?: boolean
    delay?: number
  }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = React.useState(delay <= 0)
  React.useEffect(() => {
    if (delay <= 0) return
    const t = window.setTimeout(() => setShown(true), delay)
    return () => window.clearTimeout(t)
  }, [delay])
  const done = status !== "loading"
  // 第一次渲染就是结果：直接画好，不播
  const [initialStatus] = React.useState(status)
  const still = Boolean(reduce) || status === initialStatus
  const text = status === "success" ? successLabel : status === "error" ? errorLabel : label
  // 出结果时整枚从 0.9 弹到 1（snappy，带一点回弹）；不重新挂载，转的那一层和弧的淡出照常
  const svg = React.useRef<SVGSVGElement>(null)
  React.useLayoutEffect(() => {
    if (!done || still || !svg.current) return
    const el = svg.current
    el.style.transform = "scale(0.9)"
    return nextFrame(() => {
      const run = animate(el, { scale: [0.9, 1] }, SPRINGS.snappy)
      return () => run.stop()
    })
  }, [status, done, still])
  return (
    <span
      role={decorative ? undefined : "status"}
      aria-hidden={decorative || undefined}
      data-slot="spinner"
      data-status={status}
      data-state={shown ? "visible" : "waiting"}
      className={cn("inline-flex transition-opacity duration-(--ds-dur-base) ease-ds", !shown && "invisible opacity-0", done && tone && TONE[status], className)}
      {...props}
    >
      <style href="ds-spinner" precedence="default">
        {KEYFRAMES}
      </style>
      <svg ref={svg} viewBox="0 0 16 16" fill="none" aria-hidden className={spinnerVariants({ size })}>
        {/* 转的那一层：出结果时原地停住（暂停动画，不回正） */}
        <g
          className={cn(
            "origin-center animate-[ds-spin_0.8s_linear_infinite] motion-reduce:animate-[ds-breathe_2s_cubic-bezier(0.4,0,0.6,1)_infinite]",
            done && "[animation-play-state:paused] motion-reduce:animate-none"
          )}
        >
          <circle
            cx="8"
            cy="8"
            r="6.25"
            stroke="currentColor"
            strokeWidth="1.5"
            className={cn("transition-[stroke-opacity] duration-(--ds-dur-base) ease-ds", reduce && "transition-none")}
            strokeOpacity={done ? 1 : 0.2}
          />
          <path
            d="M14.25 8A6.25 6.25 0 0 0 8 1.75"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className={cn("transition-opacity duration-(--ds-dur-base) ease-ds", done && "opacity-0 duration-(--ds-dur-fast)", reduce && "transition-none")}
          />
        </g>
        <AnimatePresence initial={false}>
          {done ? (
            <motion.path
              key={status}
              d={MARKS[status]}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={still ? false : { pathLength: 0, opacity: 1 }}
              animate={{ pathLength: 1, opacity: 1, transition: SPRINGS.snappy }}
              exit={{ opacity: 0, transition: reduce ? { duration: 0 } : { duration: DUR.fast, ease: EASE_OUT } }}
            />
          ) : null}
        </AnimatePresence>
      </svg>
      {decorative ? null : <span className="sr-only">{text}</span>}
    </span>
  )
}

export { Spinner, spinnerVariants }
