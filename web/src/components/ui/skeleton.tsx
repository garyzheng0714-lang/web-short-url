"use client"

import * as React from "react"
import { animate, AnimatePresence, motion, useReducedMotion } from "motion/react"

import { nextFrame, useSizeCache } from "@/components/ui/frame"
import { cn } from "@/lib/utils"
import { DUR, EASE_OUT, SPRINGS } from "@/components/ui/ease"

/**
 * 骨架屏：只在首次加载时出现；刷新时保留旧内容，不闪回骨架。
 * 文字条高 12（14 号字）或 8（12 号字），默认圆角 rounded-sm；图片、头像按内容自己的圆角。
 * SkeletonFrame：加载中显示占位（role=status + aria-busy），加载完原位换成内容；占位照真实布局摆，换的时候外框高度跟到内容的高度。
 * 不传 placeholder 时是「逐块长成」：内容里每一块用 SkeletonBlock 包住，加载中各自是一块同尺寸的骨架，加载完按阅读顺序一块接一块
 * 原位长成真实内容（uiarc 的 skeleton-morph）。内容在加载完之前不渲染，读屏不会读到半截。
 *
 * 动效（DESIGN.md §5.1 时间 / 系统）：
 * - 常驻（时间驱动）→ 透明度呼吸 1 → 0.5 → 1，1.5 秒一周期，对称缓入缓出（它是状态，不是动作；不用 shimmer 扫光，太吵）。
 *   同一屏的骨架共用同一个周期，一起呼吸。减少动态效果时静止。
 * - 加载完（系统，SkeletonFrame）→ 占位 150 淡出、内容 200 淡入（不位移），同时外框高度从占位高度 smooth 到内容高度，落定后撤掉内联高度
 *   → 减少动态时只淡入淡出、高度直接到位。一开始就加载完的直接显示内容，不播。
 * - 逐块长成（系统，SkeletonBlock）→ 第 n 块晚 n × 50ms（--ds-stagger，阅读顺序）：骨架框从自己的尺寸 smooth 撑到内容量出来的尺寸，
 *   同时 200ms 淡出（绝对定位、不推挤别的内容的单块，裁定 9 允许动宽高）；内容在它下面 200ms 淡入、blur 4px → 清晰。块原位变，不飞过布局。
 *   回到加载（loading 又变 true）→ 直接换回骨架，不播。减少动态 → 骨架 150 淡出、内容 200 淡入，不拉伸、不模糊、不错落。
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-sm bg-active [animation-duration:1.5s] motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  )
}

function SkeletonFrame({
  loading,
  placeholder,
  label = "正在加载",
  className,
  children,
}: {
  /** 为 true 时显示占位 */
  loading: boolean
  /** 照内容真实布局摆好的骨架；不传就是「逐块长成」：内容里的 SkeletonBlock 各自是骨架 */
  placeholder?: React.ReactNode
  /** 加载中读屏念的名字 */
  label?: string
  className?: string
  children?: React.ReactNode
}) {
  const reduce = useReducedMotion()
  const frame = React.useRef<HTMLDivElement>(null)
  const inner = React.useRef<HTMLDivElement>(null)
  // 内容高度：平时（窗口变宽、字体到了）只记下来；loading 一变，在提交后、绘制前把外框钉在旧高度，再 smooth 到新内容的高度
  const last = React.useRef(0)
  React.useEffect(() => {
    const node = inner.current
    if (!node) return
    last.current = node.offsetHeight
    const ro = new ResizeObserver(() => {
      if (!frame.current?.style.height) last.current = node.offsetHeight
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [])
  const first = React.useRef(loading)
  React.useLayoutEffect(() => {
    const el = frame.current
    const node = inner.current
    if (first.current === loading || !el || !node) return
    first.current = loading
    const from = last.current
    const to = node.offsetHeight
    last.current = to
    if (reduce || !from || Math.abs(from - to) < 0.5) return
    el.style.overflow = "hidden"
    el.style.height = `${from}px`
    el.style.contain = "layout"
    return nextFrame(() => {
      const run = animate(el, { height: [from, to] }, SPRINGS.smooth)
      run.then(() => { el.style.removeProperty("height"); el.style.removeProperty("overflow") })
      return () => run.stop()
    })
  }, [loading, reduce])
  // 逐块长成：loading 从 true 变 false 的那一次（不是第一次渲染）才播；块从上下文里拿状态
  const [resolved, setResolved] = React.useState({ loading, id: 0 })
  if (resolved.loading !== loading) setResolved({ loading, id: loading ? resolved.id : resolved.id + 1 })
  if (placeholder === undefined) {
    return (
      <div ref={frame} data-slot="skeleton-frame" aria-busy={loading || undefined} className={className}>
        <div ref={inner} className="relative">
          {loading ? (
            <span role="status" className="sr-only">
              {label}
            </span>
          ) : null}
          <BlockContext value={{ loading, reveal: resolved.id }}>{children}</BlockContext>
        </div>
      </div>
    )
  }
  return (
    <div ref={frame} data-slot="skeleton-frame" aria-busy={loading || undefined} className={className}>
      <div ref={inner} className="relative">
        <AnimatePresence initial={false} mode="popLayout">
          {loading ? (
            <motion.div key="placeholder" role="status" aria-label={label} exit={{ opacity: 0, transition: { duration: DUR.fast, ease: EASE_OUT } }}>
              {placeholder}
            </motion.div>
          ) : (
            <motion.div key="content" data-slot="skeleton-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: DUR.base, ease: EASE_OUT }}>
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

const BlockContext = React.createContext<{ loading: boolean; reveal: number }>({ loading: false, reveal: 0 })
const EASE = "cubic-bezier(0.23, 1, 0.32, 1)"
const STAGGER = 50

type Size = number | string
const css = (v: Size | undefined) => (typeof v === "number" ? `${v}px` : v)

/**
 * 逐块长成的一块：放在不传 placeholder 的 SkeletonFrame 里。加载中是一块同尺寸的骨架（lines 给出几行文字条，最后一行短一截），
 * 加载完原位换成 children。尺寸照真实内容给：文字写 lines 和行高，头像、图片写 width / height。
 */
function SkeletonBlock({
  width = "100%",
  height,
  shape = "rect",
  lines,
  lineHeight = 24,
  className,
  children,
}: {
  /** 骨架宽：数字是 px，也可以写百分比 */
  width?: Size
  /** 骨架高：不写时文字按 lines × lineHeight，其余 12 */
  height?: Size
  /** rect：rounded-sm；circle：头像 */
  shape?: "rect" | "circle"
  /** 文字的行数：每行一根条，居中在一行高里；几行时最后一行 60% 宽 */
  lines?: number
  /** 文字的行高（px），和内容的行高一致，加载前后不跳；24 = text-sm */
  lineHeight?: number
  className?: string
  children?: React.ReactNode
}) {
  const { loading, reveal } = React.useContext(BlockContext)
  const reduce = useReducedMotion()
  const box = React.useRef<HTMLDivElement>(null)
  const cached = useSizeCache(box)
  const content = React.useRef<HTMLDivElement>(null)
  const ghost = React.useRef<HTMLDivElement>(null)
  // 长成的起点：换之前骨架框的尺寸（此刻 DOM 还是骨架）
  const [grow, setGrow] = React.useState<{ id: number; w: number; h: number } | null>(null)
  // 播完把 id 记成负数（撤掉骨架框），仍算这一次已经长过
  if (!loading && reveal && Math.abs(grow?.id ?? 0) !== reveal) {
    setGrow({ id: reveal, w: cached.current.width, h: cached.current.height })
  }
  if (loading && grow) setGrow(null)

  React.useLayoutEffect(() => {
    const c = content.current
    const g = ghost.current
    if (!grow || !c || !g) return
    const all = [...(c.closest("[data-slot=skeleton-frame]")?.querySelectorAll("[data-slot=skeleton-block]") ?? [])]
    const delay = reduce ? 0 : Math.max(0, all.indexOf(box.current as Element)) * STAGGER
    const to = { w: c.offsetWidth, h: c.offsetHeight }
    c.style.opacity = "0"
    c.style.willChange = "opacity, filter"
    g.style.transformOrigin = "top left"
    return nextFrame(() => {
      c.style.opacity = ""
    const shown = c.animate(reduce ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, filter: "blur(4px)" }, { opacity: 1, filter: "blur(0px)" }], {
      duration: DUR.base * 1000, easing: EASE, delay, fill: "backwards",
    })
    const runs: { stop: () => void }[] = [{ stop: () => shown.cancel() }]
    const fade = g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: (reduce ? DUR.fast : DUR.base) * 1000, easing: EASE, delay, fill: "both" })
    runs.push({ stop: () => fade.cancel() })
    if (!reduce) runs.push(animate(g, { scaleX: [1, to.w / Math.max(1, grow.w)], scaleY: [1, to.h / Math.max(1, grow.h)] }, { ...SPRINGS.smooth, delay: delay / 1000 }))
    fade.finished.then(() => setGrow((v) => (v?.id === grow.id ? { ...v, id: -v.id } : v)), () => {})
    shown.finished.then(() => { c.style.willChange = "" }, () => { c.style.willChange = "" })
    return () => { runs.forEach((r) => r.stop()); c.style.willChange = "" }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grow?.id])

  const rounded = shape === "circle" ? "rounded-full" : "rounded-sm"
  if (loading) {
    // 15 号字（行高 24）条高 12；13 号字（行高 20）条高 8（spec「文字条」）
    const bar = lineHeight >= 24 ? 12 : 8
    return (
      <div ref={box} data-slot="skeleton-block" aria-hidden className={cn("grid", className)} style={{ width: css(width) }}>
        {lines ? (
          Array.from({ length: lines }, (_, i) => (
            <div key={i} className="flex items-center" style={{ height: lineHeight }}>
              <Skeleton className={rounded} style={{ height: bar, width: lines > 1 && i === lines - 1 ? "60%" : "100%" }} />
            </div>
          ))
        ) : (
          <Skeleton className={rounded} style={{ height: css(height ?? 12) }} />
        )}
      </div>
    )
  }
  return (
    <div ref={box} data-slot="skeleton-block" className={cn("relative", className)}>
      {grow && grow.id > 0 ? (
        <div
          ref={ghost}
          aria-hidden
          data-slot="skeleton-ghost"
          className={cn("pointer-events-none absolute top-0 left-0 bg-active", rounded)}
          style={{ width: grow.w, height: grow.h }}
        />
      ) : null}
      <div ref={content}>{children}</div>
    </div>
  )
}

export { Skeleton, SkeletonBlock, SkeletonFrame }
