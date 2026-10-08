"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { animate, AnimatePresence, motion, useMotionValue, useMotionValueEvent, useReducedMotion, type AnimationPlaybackControls, type HTMLMotionProps } from "motion/react"

import { cn } from "@/lib/utils"
import { useDensity } from "@/components/ui/density"
import { EXIT, FROM_FIRST_FRAME, SPRINGS } from "@/components/ui/ease"
import { nextFrame, useSizeCache } from "@/components/ui/frame"
import { fromKeyboard } from "@/components/ui/hotkeys"

/**
 * 标签：分类为灰色文字；编号为细描边等宽字；chip 是中性灰底的小标签（「Beta」「Updates」、文章标签）。
 * 状态（neutral / success / warning / danger）有两种画法，状态色都只在一处（DESIGN.md §4.1）：
 * - 点（默认）：「圆点 + fg 文字」，颜色只在圆点上（neutral 的点是 fg-subtle）。
 * - solid：浅色底 = 状态色 15% 与所在面的混色，字仍是 fg——一种状态色在浅色、深色主题都对，不另设一套色。neutral 的 solid 是中性灰底。
 * 有底或有框的（code、chip、solid）两档高（跟区域密度走，size 可以钉死）：默认 24（左右 8、图标到字 6）、紧凑 20（左右 6、间距 4）；
 * 无底的文字与圆点标签高就是一行字（20）。字号都是 13（DESIGN.md §3.1 字号刻度）。
 *
 * 动效（只在 TagGroup 里，DESIGN.md §4.2）：
 * - 加入（指针勾选或系统写入）→ 新标签 scale .9 → 1 与后面标签的让位走同一条 moderate（布局补位，落点不过冲）；
 *   透明度晚 50ms 用 fast 淡入，先让邻居挪开一点再显出来 → 减少动态时不缩放、不位移，只淡入。
 * - 移除 → 原地 EXIT.fast 缩到 .9 并淡出，同时弹出文档流，后面的标签 moderate 补位，不凭空消失 → 减少动态时只淡出，补位直接到位。
 * - 键盘触发（例如在输入框里回车加标签、Backspace 删标签）→ 0ms。
 * 位置以这一组为参照（layoutRoot），整组被外面挤动时不动。
 *
 * 换字（单独用或在组里都有；「待审批」→「已通过」，按文字与元素类型比较，换 variant 不算）：
 * - 系统或指针引起 → 外框宽度 moderate 变到新宽度（变宽变窄同一档，中途再换从当前宽度、当前速度接着走）；
 *   新字 80ms 淡入、旧字 60ms 淡出（fast 档与它的退场），同时从 blur 4px 清晰 / 变糊，叠在同一格里；旧字对读屏隐藏，只念新字。
 * - 键盘引起 → 0ms，直接换。减少动态时只淡入淡出，宽度直接到位。字体加载、容器变化这类被动的变化不动画（只在换字那一刻量一次）。
 * 可以带一个图标（lucide，14：随 13 号字，DESIGN.md §4.5）放在文字前面，和状态圆点一样只表达已经写在文字里的状态。
 */
/**
 * TagGroup 里此刻有哪些标签（key 连成的串）；不在组里是 null。
 * 标签的 layoutDependency 用它：只有增删时才量位置。否则退场的标签卸载时 AnimatePresence 重渲染一次，
 * 正在让位的邻居被重新量一遍，弹簧从错的位置重来，一帧跳 9px（2026-10-01 实测，加入后 150ms 内取消）。
 */
const TagGroupContext = React.createContext<string | null>(null)

const INSTANT = { duration: 0 } as const
// 透明度晚 50ms：先让后面的标签挪开一点，新标签再显出来，不和邻居叠在一起
const ENTER = { ...SPRINGS.moderate, opacity: { ...SPRINGS.fast, delay: 0.05 }, layout: SPRINGS.moderate } as const
const GENTLE = { ...SPRINGS.fast, scale: INSTANT, layout: INSTANT } as const
const LEAVE = { opacity: 0, scale: 0.9, transition: EXIT.fast } as const
/** 换字的交叉淡化（WAAPI，秒）：出现走 fast 全长，消失走 fast 的退场（DESIGN.md §4.2 图标互换同一套） */
const SWAP_IN = 0.08
const SWAP_OUT = EXIT.fast.duration

/** 会增删的一组标签：子项带稳定 key。默认横排、可换行、间距 12。 */
function TagGroup({ className, children, ...props }: React.ComponentProps<"div">) {
  const items = React.Children.toArray(children)
  const members = items.map((child) => (React.isValidElement(child) ? String(child.key) : "")).join("|")
  return (
    <motion.div
      layout
      layoutRoot
      data-slot="tag-group"
      className={cn("relative flex flex-wrap items-center gap-3", className)}
      {...(props as HTMLMotionProps<"div">)}
    >
      <TagGroupContext.Provider value={members}>
        <AnimatePresence initial={false} mode="popLayout">
          {items}
        </AnimatePresence>
      </TagGroupContext.Provider>
    </motion.div>
  )
}
// 行内排版（表格单元格、正文）里按基线对齐时，13px 的字压在 15px 的基线上，整块比同行文字低 2.5px（2026-10-01 实测）；
// 顶端贴父级字面顶，标签落在 24 的行里居中。flex / grid 里不受影响。
const tagVariants = cva("relative inline-flex shrink-0 items-center align-text-top text-xs whitespace-nowrap [contain:layout] data-morphing:overflow-clip [&_svg]:size-3.5 [&_svg]:shrink-0", {
  variants: {
    variant: {
      text: "text-fg-muted",
      code: "rounded-sm font-mono text-fg-muted shadow-[inset_0_0_0_1px_var(--ds-line-strong)]",
      chip: "rounded-sm bg-active text-fg-muted",
      neutral: "text-fg",
      success: "text-fg",
      warning: "text-fg",
      danger: "text-fg",
    },
    size: {
      md: "gap-1.5",
      sm: "gap-1",
    },
  },
  defaultVariants: { variant: "text", size: "md" },
})
/** 有底或有框的变体（code、chip、solid）：高 24 · 紧凑 20，左右 8 · 6。无底的（文字、圆点）高就是一行字（20），不多占看不见的边 */
const PAD = { md: "h-6 px-2", sm: "h-5 px-1.5" } as const

/** solid：状态色 15% 与所在面的混色；neutral 用中性灰底。字一律 fg */
const TONE = {
  neutral: null,
  success: "var(--ds-success)",
  warning: "var(--ds-warning)",
  danger: "var(--ds-danger)",
} as const

const DOT = {
  neutral: "bg-fg-subtle",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
} as const

/** 文案的身份：文字 + 元素类型（lucide 图标各有名字）。只有它变了才算换字 */
function labelKey(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(labelKey).join("")
  if (!React.isValidElement(node)) return ""
  const type = node.type as string | { displayName?: string; name?: string }
  const name = typeof type === "string" ? type : (type.displayName ?? type.name ?? "")
  return `<${name}>${labelKey((node.props as { children?: React.ReactNode }).children)}`
}

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)" // ease-ds，WAAPI 用
type Label = { key: string; node: React.ReactNode; out: React.ReactNode; from: number | null; fade: boolean; id: number }

/**
 * 换字：记下旧字和换之前的外框宽度（morph 的起点），在提交帧钉住起点，下一帧开始宽度弹簧与模糊交叉。
 * 键盘引起的直接换：不留旧字、不量宽度。
 */
function useSwap(children: React.ReactNode, root: React.RefObject<HTMLElement | null>) {
  const reduce = useReducedMotion()
  const cached = useSizeCache(root)
  const key = labelKey(children)
  const [label, setLabel] = React.useState<Label>({ key, node: children, out: null, from: null, fade: false, id: 0 })
  if (label.key !== key) {
    const instant = fromKeyboard()
    // 换之前的宽度：读取 ResizeObserver 缓存，不在 render 强制排版
    const from = !instant && !reduce && cached.current.width > 0 ? cached.current.width : null
    setLabel({ key, node: children, out: instant ? null : label.node, from, fade: !instant, id: label.id + 1 })
  }
  const live = React.useRef<HTMLSpanElement>(null)
  const gone = React.useRef<HTMLSpanElement>(null)
  const width = useMotionValue(0)
  const morph = React.useRef<AnimationPlaybackControls | null>(null)
  useMotionValueEvent(width, "change", (v) => {
    if (root.current?.hasAttribute("data-morphing")) root.current.style.width = `${v}px`
  })
  React.useLayoutEffect(() => {
    const el = root.current
    if (!label.id || !el) return
    const settle = () => {
      el.style.width = ""
      el.removeAttribute("data-morphing")
    }
    let target: number | null = null
    if (label.from === null) {
      morph.current?.stop()
      settle()
    } else {
      el.style.width = ""
      const to = parseFloat(getComputedStyle(el).width)
      const from = morph.current && width.isAnimating() ? width.get() : label.from
      if (Math.abs(to - from) > 0.5) {
        if (!width.isAnimating()) width.jump(from)
        el.setAttribute("data-morphing", "")
        el.style.width = `${width.get()}px`
        // 变宽变窄同一档（moderate）；animate 接着当前速度走
        target = to
      } else if (!width.isAnimating()) settle()
    }
    const enter = live.current
    enter?.getAnimations().forEach((a) => a.cancel())
    if (enter) { enter.style.opacity = ""; enter.style.willChange = "" }
    if (!label.fade || !enter) return
    const blur = reduce ? "blur(0px)" : "blur(4px)"
    enter.style.opacity = "0"
    enter.style.willChange = "opacity, filter"
    if (gone.current) gone.current.style.willChange = "opacity, filter"
    return nextFrame(() => {
      if (target !== null) morph.current = animate(width, target, { ...SPRINGS.moderate, ...FROM_FIRST_FRAME, onComplete: settle })
      enter.style.opacity = ""
      const shown = enter.animate([{ opacity: 0, filter: blur }, { opacity: 1, filter: "blur(0px)" }], { duration: SWAP_IN * 1000, easing: EASE })
      gone.current?.animate([{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: blur }], { duration: SWAP_OUT * 1000, easing: EASE, fill: "forwards" })
      const id = label.id
      shown.finished.then(
        () => { enter.style.willChange = ""; if (gone.current) gone.current.style.willChange = ""; setLabel((l) => (l.id === id ? { ...l, out: null, fade: false } : l)) },
        () => {}
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label.id])
  React.useEffect(() => () => morph.current?.stop(), [])
  return { label, live, gone }
}

function Tag({
  className,
  variant,
  size: sizeProp,
  solid = false,
  children,
  ref,
  ...props
}: React.ComponentProps<"span"> &
  Omit<VariantProps<typeof tagVariants>, "size"> & {
    /** md（24）· sm（20）；不写时跟所在区域的密度（Density） */
    size?: "md" | "sm"
    /** 状态标签画成浅色底（状态色 15% 混色），不画圆点 */
    solid?: boolean
  }) {
  const density = useDensity()
  const size = sizeProp ?? (density === "compact" ? "sm" : "md")
  const members = React.useContext(TagGroupContext)
  const reduce = useReducedMotion()
  const root = React.useRef<HTMLSpanElement | null>(null)
  const { label, live, gone } = useSwap(children, root)
  const refs = (node: HTMLSpanElement | null) => {
    root.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) ref.current = node
  }
  const status = variant && variant in DOT ? (variant as keyof typeof DOT) : null
  const filled = solid && status !== null
  const dot = status && !filled ? DOT[status] : null
  const tone = filled ? TONE[status!] : null
  // 有底或有框的才要左右内边距：code、chip、solid
  const padded = variant === "code" || variant === "chip" || filled
  const look = cn(
    tagVariants({ variant, size }),
    padded ? PAD[size] : "h-5",
    filled && "rounded-sm",
    filled && (tone ? "[--tag-fill:color-mix(in_srgb,var(--tag-tone)_15%,var(--ds-surface,var(--ds-canvas)))] bg-(--tag-fill)" : "bg-active"),
    className
  )
  const toneStyle = tone ? ({ "--tag-tone": tone } as React.CSSProperties) : undefined
  const swapping = label.out != null || label.fade
  const inner = (
    <>
      {dot ? <span aria-hidden data-slot="tag-dot" className={cn("size-1.5 shrink-0 rounded-full", dot)} /> : null}
      {/* 平时不占盒子（display: contents）；换字时成为一格，旧字叠在它上面淡出。旧字是新字的兄弟，不跟着新字的透明度从 0 开始 */}
      <span data-slot="tag-label-box" className={swapping ? "relative inline-flex items-center" : "contents"}>
        <span ref={live} data-slot="tag-label" className={swapping ? "inline-flex items-center gap-1" : "contents"}>
          {children}
        </span>
        {label.out != null ? (
          <span key={label.id} ref={gone} aria-hidden data-slot="tag-label-out" className="pointer-events-none absolute top-0 left-0 inline-flex h-full items-center gap-1">
            {label.out}
          </span>
        ) : null}
      </span>
    </>
  )
  if (members === null) {
    return (
      <span ref={refs} data-slot="tag" data-solid={filled || undefined} className={look} {...props} style={{ ...toneStyle, ...props.style }}>
        {inner}
      </span>
    )
  }
  const keyboard = fromKeyboard()
  return (
    <motion.span
      ref={refs}
      data-slot="tag"
      layout="position"
      layoutDependency={members}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={keyboard ? { opacity: 0, transition: INSTANT } : reduce ? { opacity: 0, transition: EXIT.fast } : LEAVE}
      transition={keyboard ? INSTANT : reduce ? GENTLE : ENTER}
      data-solid={filled || undefined}
      className={look}
      {...(props as HTMLMotionProps<"span">)}
      style={{ ...toneStyle, ...(props.style as HTMLMotionProps<"span">["style"]) }}
    >
      {inner}
    </motion.span>
  )
}

export { Tag, TagGroup, tagVariants }
