import { nextFrame } from "@/components/ui/frame"

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react"

import { cn } from "@/lib/utils"
import { sameBox, useInvariant } from "@/components/ui/invariant"
import { DUR, EASE_OUT, FROM_FIRST_FRAME, MORPH, SPRINGS } from "@/components/ui/ease"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { useEdges } from "@/components/ui/stretch"

/**
 * 同形变换的面（ConfirmMorph、ActionMorph、MorphNav、ShareSheet 共用）：触发器占位始终不变，外框从触发器长成面板、再原路缩回。
 * 外框用 FLIP：实际尺寸一次写入，逐帧只写 transform；圆角反算抵消缩放，保持物理尺寸。内容不缩放，用 clip-path 裁在外框里。
 *
 * 动效（DESIGN.md §5.2 morph、§5.3 原路返回）：
 * - 打开、换面（指针点击 / 系统换步骤）→ 外框两条边各走一条弹簧：前沿 MORPH.lead（snappy）、后沿 MORPH.trail（smooth），
 *   任一边走超过 200px 两边都用 smooth（stretch.ts）；圆角跟后沿同一刻起步、同一条 MORPH.trail。
 *   内容 200ms ease-out 淡入，同时被外框裁住：外框长到哪，内容露到哪，不会伸出外框。触发器立刻隐去。
 * - 关闭（指针点击、点外面、系统）→ 原路返回：内容 150ms 淡出（同时仍被外框裁住），外框同一刻起步缩回触发器，
 *   走动的边用打开时同一条弹簧（≤200px snappy，否则 smooth），离开不比进入慢；
 *   外框离终点不到全程 5%（1–8px）时触发器 200ms 淡入，阴影从浮起换回凸起。缩回途中再点触发器，外框从当前位置、当前速度掉头。
 * - 键盘（Enter / 空格打开、Esc 关闭）→ 0ms，直接到位。
 * - 减少动态 → 外框、圆角直接到位；只留透明度：内容 200ms 淡入，触发器 200ms 淡入。
 * 关闭途中内容保持最后一刻的样子、整块 inert；ResizeObserver 只量当前目标，不逐帧读布局。
 *
 * 盖住整行：祖先上有 [data-morph-row] 时，打开的面板铺满那一行（行的边框盒四边各外放 --ds-pad-popover），内容竖直居中。
 * 面板比触发器宽、会压到同一行的字时用它——只盖一部分，标题和说明会被切成半截（2026-10-06 confirm-morph 390 宽）。
 * 尺寸一律用布局尺寸（offset*、ResizeObserver），不用 getBoundingClientRect：放在 CSS zoom 缩小的舞台里，后者是缩放后的尺寸，
 * 两种尺寸一比就不一样大（2026-10-06 布局页拨到 1280 时整页崩溃）。
 */
type MorphSurfaceProps = {
  open: boolean
  trigger: ReactNode
  children: ReactNode
  face?: string
  width?: number
  align?: "start" | "center" | "end"
  side?: "top" | "bottom"
  circle?: boolean
  className?: string
  panelClassName?: string
}

// 开合、换面都和挂载内容同一刻起步：从第一帧开始计时（ui/ease 的 FROM_FIRST_FRAME），挂载的长任务不算进动画
const FADE_IN = { duration: DUR.base, ease: EASE_OUT, ...FROM_FIRST_FRAME } as const
const FADE_OUT = { duration: DUR.fast, ease: EASE_OUT, ...FROM_FIRST_FRAME } as const

function MorphSurface({ open, trigger, children, face = "panel", width = 320, align = "end", side = "bottom", circle = false, className, panelClassName }: MorphSurfaceProps) {
  const root = useRef<HTMLDivElement>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const first = useRef(true)
  // 内容的目标框（相对外框的坐标），clip-path 用它把内容裁在当前外框里
  const box = useRef({ x: 0, y: 0, w: 1, h: 1 })
  // 关闭途中保留最后一刻的内容：使用方此时已按关闭状态渲染（例如原位确认回到 idle），不能拿新内容淡出
  const last = useRef(children)
  if (open) last.current = children
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [cap, setCap] = useState(width)
  // fading：内容在淡出（仍挂着）；settled：外框已回到触发器，触发器可以出现
  const [fading, setFading] = useState(false)
  const [settled, setSettled] = useState(true)
  // 收着、外框也已回到触发器：这时触发器自己变尺寸（字体加载、文案变化）不是一次开合，外框直接跟上，不播动画
  const atRest = useRef(true)
  const horizontal = useEdges({ left: 0, right: 1 })
  const vertical = useEdges({ left: 0, right: 1 })
  const radius = useMotionValue(0)
  const contentOpacity = useMotionValue(1)
  const triggerOpacity = useMotionValue(1)
  const reduced = useReducedMotion()
  const fail = useInvariant("MorphSurface")
  const transform = useTransform([horizontal.left, horizontal.right, vertical.left, vertical.right], ([l, r, t, b]) =>
    `translate(${l}px, ${t}px) scale(${Math.max(0.001, (Number(r) - Number(l)) / size.width)}, ${Math.max(0.001, (Number(b) - Number(t)) / size.height)})`)
  const borderRadius = useTransform([radius, horizontal.width, vertical.width], ([r, w, h]) =>
    `${Number(r) * size.width / Math.max(1, Number(w))}px / ${Number(r) * size.height / Math.max(1, Number(h))}px`)
  const clipPath = useTransform([horizontal.left, horizontal.right, vertical.left, vertical.right, radius], ([l, r, t, b, rr]) => {
    const { x, y, w, h } = box.current
    return `inset(${Number(t) - y}px ${x + w - Number(r)}px ${y + h - Number(b)}px ${Number(l) - x}px round ${Number(rr)}px)`
  })

  // 开合：内容淡入淡出、触发器显隐。键盘一律 0ms。
  // 只认 open 真的变了：开发模式 StrictMode 挂载时会把 effect 重跑一遍，不能把重跑当成一次关闭
  const prevOpen = useRef(open)
  const prevFace = useRef(face)
  useLayoutEffect(() => {
    if (prevOpen.current === open) {
      // 一挂载就是打开的：触发器直接藏起，不播动画
      if (open && first.current) { triggerOpacity.set(0); setSettled(false) }
      return
    }
    prevOpen.current = open
    atRest.current = false
    const instant = fromKeyboard()
    if (open) {
      setFading(false)
      setSettled(false)
      triggerOpacity.set(0)
      if (instant) return void contentOpacity.set(1)
      contentOpacity.set(0)
      return nextFrame(() => {
        const fade = animate(contentOpacity, 1, FADE_IN)
        return () => fade.stop()
      })
    }
    if (instant || reduced) {
      setFading(false)
      return
    }
    setFading(true)
    return nextFrame(() => {
      const fade = animate(contentOpacity, 0, { ...FADE_OUT, onComplete: () => setFading(false) })
      return () => fade.stop()
    })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // 换面：新内容 200ms 淡入（键盘 0ms）
  useLayoutEffect(() => {
    if (prevFace.current === face) return
    prevFace.current = face
    if (!open) return
    if (fromKeyboard()) return void contentOpacity.set(1)
    contentOpacity.set(0)
    return nextFrame(() => {
      const fade = animate(contentOpacity, 1, FADE_IN)
      return () => fade.stop()
    })
  }, [face]) // eslint-disable-line react-hooks/exhaustive-deps

  // 触发器在外框到位时才出现
  useEffect(() => {
    if (!settled || open) return
    if (first.current || fromKeyboard()) triggerOpacity.set(1)
    else {
      return nextFrame(() => {
        const fade = animate(triggerOpacity, 1, FADE_IN)
        return () => fade.stop()
      })
    }
  }, [settled, open, triggerOpacity])

  useLayoutEffect(() => {
    const source = anchor.current
    const content = open ? panel.current : source
    if (!source || !content || !root.current) return
    const boundary = root.current.closest<HTMLElement>("[data-morph-boundary]")
    const row = root.current.closest<HTMLElement>("[data-morph-row]")
    // 收着时面板不存在，不读边界；打开时仍在绘制前按原来的上限排好。
    const fit = () => { if (open) setCap(Math.min(width, boundary?.clientWidth ?? window.innerWidth - 32)) }
    fit()
    let frame = 0
    let cancelRadius: (() => void) | undefined
    let measured: { w: number; h: number; r: number } | undefined
    const measure = (entry?: ResizeObserverEntry) => {
      // observer 已拿到布局结果，不再用 offset 读取触发同步布局；取整与 offsetWidth / Height 一致。
      const bounds = entry?.borderBoxSize[0]
      const w = bounds ? Math.round(bounds.inlineSize) : content.offsetWidth
      const h = bounds ? Math.round(bounds.blockSize) : content.offsetHeight
      if (!w || !h) return
      const r = open ? parseFloat(getComputedStyle(content).borderTopLeftRadius) : circle ? h / 2 : parseFloat(getComputedStyle(source.firstElementChild ?? source).borderTopLeftRadius)
      if (measured && measured.w === w && measured.h === h && Object.is(measured.r, r)) return
      measured = { w, h, r }
      // 盖住整行：面板的框就是行的框，换算成相对外框锚点（place）的坐标
      const cover = open && row ? rowBox(row, root.current!, align, side) : null
      const x = cover ? cover.x : align === "end" ? -w : align === "center" ? -w / 2 : 0
      const y = cover ? cover.y : side === "top" ? -h : 0
      const immediate = first.current || Boolean(reduced) || fromKeyboard() || (!open && atRest.current)
      if (open) box.current = { x, y, w, h }
      setSize((size) => size.width === w && size.height === h ? size : { width: w, height: h })
      if (open || immediate) {
        horizontal.moveTo({ left: x, right: x + w }, { instant: immediate, ...FROM_FIRST_FRAME })
        vertical.moveTo({ left: y, right: y + h }, { instant: immediate, ...FROM_FIRST_FRAME })
      } else {
        // 缩回是打开的倒放：走动的那条边用打开时同一条弹簧（≤200px 前沿 snappy，否则 smooth），
        // 不让 useEdges 把它当后沿走 smooth——离开不比进入慢（DESIGN.md §5.1）
        for (const [edges, from, to] of [[horizontal, x, x + w], [vertical, y, y + h]] as const) {
          const large = Math.max(Math.abs(edges.left.get() - from), Math.abs(edges.right.get() - to)) > 200
          edges.moveTo({ left: from, right: to }, { spring: large ? SPRINGS.smooth : MORPH.lead, ...FROM_FIRST_FRAME })
        }
      }
      // 圆角是外框的一部分，跟后沿同一刻起步、同一条弹簧
      cancelRadius?.()
      if (immediate) radius.jump(Number.isFinite(r) ? r : 0)
      else cancelRadius = nextFrame(() => { animate(radius, Number.isFinite(r) ? r : 0, { ...MORPH.trail, ...FROM_FIRST_FRAME }) })
      first.current = false
      // 不变量：收着时外框就是触发器本身那么大。外层多出来的一截（行内元素的基线空隙）会让外框比按钮高 6px，
      // 悬停灰底只铺到按钮、外框底下露一条白（2026-10-05 用户截图「移除」按钮）
      if (!open && source.firstElementChild instanceof HTMLElement) {
        const t = source.firstElementChild
        const problem = sameBox(["外框", "触发器"], { width: w, height: h }, { width: t.offsetWidth, height: t.offsetHeight })
        if (problem) fail(problem)
      }
      if (open) return
      // 缩回触发器：每条边离终点都不到全程的 5%（1–8px）就算到位——smooth 的长尾最后十几像素要爬 300ms，
      // 等它爬完，触发器会晚出现一截；剩下几像素被 200ms 的淡入盖住
      cancelAnimationFrame(frame)
      const edges = ([[horizontal.left, x], [horizontal.right, x + w], [vertical.left, y], [vertical.right, y + h]] as const)
        .map(([v, to]) => [v, to, Math.min(8, Math.max(1, Math.abs(v.get() - to) * 0.05))] as const)
      const wait = () => {
        if (edges.some(([v, to, near]) => Math.abs(v.get() - to) > near)) frame = requestAnimationFrame(wait)
        else { atRest.current = true; setSettled(true) }
      }
      wait()
    }
    measure()
    const observer = new ResizeObserver(([entry]) => measure(entry))
    observer.observe(content)
    const bounds = new ResizeObserver(() => { fit(); if (open && row) { measured = undefined; measure() } })
    if (boundary) bounds.observe(boundary)
    if (open && row && row !== boundary) bounds.observe(row)
    window.addEventListener("resize", fit)
    return () => { cancelRadius?.(); cancelAnimationFrame(frame); observer.disconnect(); bounds.disconnect(); window.removeEventListener("resize", fit) }
    // moveTo 按当前 MotionValue 取速度；依赖目标状态而不是每次 render 的函数引用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, face, width, cap, align, side, circle, reduced])

  const shown = open || fading
  const place = { left: align === "end" ? "100%" : align === "center" ? "50%" : 0, top: side === "top" ? "100%" : 0 } as const
  // 盖住整行时面板的位置与尺寸由行决定（见文件头），在绘制前由 measure 写进 cover
  const [cover, setCover] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const row = open ? root.current?.closest<HTMLElement>("[data-morph-row]") : null
    if (!row || !root.current) return
    const sync = () => { const b = rowBox(row, root.current!, align, side); setCover((c) => c && c.left === b.left && c.top === b.top && c.width === b.w && c.height === b.h ? c : { left: b.left, top: b.top, width: b.w, height: b.h }) }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(row)
    return () => ro.disconnect()
  }, [open, align, side])
  return (
    <div ref={root} data-slot="morph-surface" data-state={open ? "open" : "closed"} className={cn("relative isolate inline-grid align-top", shown && "z-20", className)}>
      <motion.div
        aria-hidden data-slot="morph-surface-shape"
        className={cn("pointer-events-none absolute origin-top-left bg-card", open || !settled ? "shadow-popover" : "shadow-raised")}
        style={{ ...place, width: size.width, height: size.height, transform, borderRadius }}
      />
      {/* flex：触发器多是 inline-flex 的按钮，块级外层会在它下面留出行内基线空隙，外框就比按钮高一截。
          根节点 align-top 同理：它自己是 inline-grid，放进块级容器也会带上行盒下沿（2026-10-06 分享面外层 42、按钮 36） */}
      <motion.div ref={anchor} inert={open} className="relative flex" style={{ opacity: triggerOpacity }}>{trigger}</motion.div>
      {shown && (
        <motion.div
          ref={panel} data-slot="morph-surface-face" data-space data-inset inert={!open}
          className={cn("absolute rounded-card text-fg outline-none", cover && "grid content-center", !open && "pointer-events-none", panelClassName)}
          style={cover
            ? { opacity: contentOpacity, clipPath, left: cover.left, top: cover.top, width: cover.width, height: cover.height }
            : { opacity: contentOpacity, clipPath, width: cap, [align === "end" ? "right" : "left"]: align === "center" ? "50%" : 0, [side === "top" ? "bottom" : "top"]: 0, marginLeft: align === "center" ? -cap / 2 : undefined }}
        >{open ? children : last.current}</motion.div>
      )}
    </div>
  )
}

/** 行相对外框根节点的布局框（不受 CSS zoom 影响），以及相对外框锚点（place）的坐标 */
function rowBox(row: HTMLElement, root: HTMLElement, align: MorphSurfaceProps["align"], side: MorphSurfaceProps["side"]) {
  const zoom = root.getBoundingClientRect().width / (root.offsetWidth || 1) || 1
  const a = row.getBoundingClientRect()
  const b = root.getBoundingClientRect()
  // 往外放 --ds-pad-popover（6）：面板是圆角的，正好贴着行框时，行首、行尾的字会从四个圆角里露出一点
  const out = parseFloat(getComputedStyle(root).getPropertyValue("--ds-pad-popover")) || 6
  const left = Math.round((a.left - b.left) / zoom - out)
  const top = Math.round((a.top - b.top) / zoom - out)
  const w = row.offsetWidth + out * 2
  const h = row.offsetHeight + out * 2
  const px = align === "end" ? root.offsetWidth : align === "center" ? root.offsetWidth / 2 : 0
  const py = side === "top" ? root.offsetHeight : 0
  return { left, top, w, h, x: left - px, y: top - py }
}

export { MorphSurface, type MorphSurfaceProps }
