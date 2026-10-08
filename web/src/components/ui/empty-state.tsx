import * as React from "react"
import { animate, AnimatePresence, motion, useIsPresent, useMotionValue, useReducedMotion } from "motion/react"

import { nextFrame } from "@/components/ui/frame"
import { cn } from "@/lib/utils"
import { EXIT, FROM_FIRST_FRAME, SPRINGS } from "@/components/ui/ease"
import { fromKeyboard } from "@/components/ui/hotkeys"

/**
 * 空状态（DESIGN.md §4.3「空」、§6 文案）：一句标题说清是什么空 + 一句引导指出下一步 + 至多一个动作。不画插图、不套卡片。
 * - 标题写状态（「还没有项目」「没有找到「季度复盘」」）；引导写下一步能做什么（「新建一个项目，把任务和成员放进来」），不解释为什么、不写理念。
 * - 图标 20 → 12 → 标题 15 / 500 → 4 → 引导 15 次级灰（最宽 288）→ 16 → 动作。
 * size="lg"：整屏只有它和一个输入框的开场（助手对话的新对话）——标题 24 / 600 是这一屏的重心，上下不留 48 的空，
 *   和下面的输入框一起由外层放在竖向中线（ChatThread 助手模式空会话时这样排）。
 * 一直挂着、只换 props 就能在几种状态之间变（空 → 已创建、无结果 → 换了搜索词）：标题是文字时，标题变了整块原位换字。
 *
 * 动效（DESIGN.md §4.2；谁引起 → 用哪条 → 减少动态时）：
 * - 出现（系统：列表变空、搜索无结果，挂载时）→ 没有平面上的起点，只淡入：整块 fast（80ms，@starting-style，只播一次）
 *   → 减少动态时同样只是这一下淡入。
 * - 换状态（指针点了按钮、系统给出结果，标题变了）→ 新内容从 blur 4 淡入（fast）、旧内容淡出并变糊（EXIT.fast），叠在原位；
 *   整块高度跟着新内容走 moderate（下面的东西一起让位，不跳）→ 减少动态时只淡入淡出，高度直接到位。
 * - 键盘引起的换状态（打字搜索、回车）→ 0ms，直接换。
 * 焦点：按了旧内容里的按钮（焦点在里面）而换了状态时，焦点交给新内容的第一个按钮；旧内容淡出期间对读屏隐藏、不能点。
 */
type Mode = "key" | "reduce" | "full"
const SWAP = {
  hidden: (mode: Mode) => (mode === "full" ? { willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 0, filter: "blur(4px)" } : { opacity: 0 }),
  // 模糊是 filter 字串，弹簧推不动：透明度走 fast 弹簧，模糊走同长（0.08s）的 easeOut 过渡
  shown: (mode: Mode) => ({ willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 1, filter: "blur(0px)", transition: mode === "key" ? { duration: 0 } : { ...SPRINGS.fast, filter: { type: "tween", duration: 0.08, ease: "easeOut" } } }),
  gone: (mode: Mode) =>
    mode === "key" ? { opacity: 0, transition: { duration: 0 } } : { willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 0, filter: mode === "full" ? "blur(4px)" : "blur(0px)", transition: EXIT.fast },
}

/** 一份内容：正在离开的那份对读屏隐藏、不能点。ref 要接着传给 motion：popLayout 靠它把离开的那份移出排版 */
function Face({ mode, children, ref }: { mode: Mode; children: React.ReactNode; ref?: React.Ref<HTMLDivElement> }) {
  const present = useIsPresent()
  return (
    <motion.div
      ref={ref}
      className="grid justify-items-center gap-1"
      aria-hidden={!present || undefined}
      inert={!present}
      variants={SWAP}
      custom={mode}
      initial={mode === "key" ? false : "hidden"}
      animate="shown"
      exit="gone"
    >
      {children}
    </motion.div>
  )
}

function EmptyState({
  icon,
  title,
  description,
  action,
  size = "default",
  className,
}: {
  icon?: React.ReactNode
  title: React.ReactNode
  action?: React.ReactNode
  /** 一句指出下一步的引导（「新建一个项目，把任务和成员放进来」） */
  description?: React.ReactNode
  /** lg：整屏的开场标题（24 / 600），不带上下 48 的留白 */
  size?: "default" | "lg"
  className?: string
}) {
  const reduce = useReducedMotion()
  const mode: Mode = fromKeyboard() ? "key" : reduce ? "reduce" : "full"
  const still = mode !== "full"
  const inner = React.useRef<HTMLDivElement>(null)
  const height = useMotionValue<number | "auto">("auto")
  const [clip, setClip] = React.useState(false)
  // 高度跟着内容走：第一次量到直接用；之后内容变了（换状态）走 moderate，键盘与减少动态直接到位
  const latest = React.useRef(still)
  latest.current = still
  React.useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    let first = true
    let run: { stop: () => void } | null = null
    let cancel: (() => void) | undefined
    // borderBoxSize：带小数、不受外面缩放影响（offsetHeight 会取整，差出 1px）
    const ro = new ResizeObserver(([entry]) => {
      cancel?.()
      const to = entry.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight
      const from = height.get()
      run?.stop()
      if (first || latest.current || typeof from !== "number" || Math.abs(from - to) < 0.5) {
        first = false
        return height.set(to)
      }
      setClip(true)
      cancel = nextFrame(() => { run = animate(height, to, { ...SPRINGS.moderate, ...FROM_FIRST_FRAME, onComplete: () => setClip(false) }) })
    })
    ro.observe(el)
    return () => (cancel?.(), ro.disconnect(), run?.stop())
  }, [height])

  const key = typeof title === "string" ? title : "content"
  // 焦点在旧内容里（刚按了它的按钮）：换状态后交给新内容的第一个按钮，不掉到页面开头
  const root = React.useRef<HTMLDivElement>(null)
  const hadFocus = React.useRef(false)
  React.useLayoutEffect(() => {
    const active = document.activeElement
    if (!hadFocus.current || (active && inner.current?.contains(active) && !active.closest("[inert]"))) return
    inner.current?.querySelector<HTMLElement>(':scope > :not([inert]) :is(button, a[href], input, [tabindex]:not([tabindex="-1"]))')?.focus()
  }, [key])
  return (
    <motion.div
      ref={root}
      data-slot="empty-state"
      onFocus={() => (hadFocus.current = true)}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) hadFocus.current = false
      }}
      style={{ contain: "layout", height }}
      className={cn("transition-opacity duration-(--ds-dur-fast) ease-ds starting:opacity-0", clip && "overflow-hidden")}
    >
      {/* className 落在这一层：调上下留白时高度照样量得准 */}
      <div ref={inner} data-size={size} className={cn("relative grid justify-items-center px-6 text-center text-sm", size === "lg" ? "py-0" : "py-12", className)}>
        <AnimatePresence mode="popLayout" initial={false} custom={mode}>
          <Face key={key} mode={mode}>
            {icon ? <div className="mb-2 text-fg-muted [&_svg]:size-5">{icon}</div> : null}
            <p className={cn("text-fg", size === "lg" ? "text-xl font-semibold" : "font-medium")}>{title}</p>
            {description ? <p className="max-w-72 text-fg-muted">{description}</p> : null}
            {action ? <div className="mt-3">{action}</div> : null}
          </Face>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

export { EmptyState }
