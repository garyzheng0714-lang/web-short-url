import { nextFrame, useSizeCache } from "@/components/ui/frame"
import { useInvariant } from "@/components/ui/invariant"

import * as React from "react"
import { animate, useMotionValue, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { SPRINGS } from "@/components/ui/ease"
import type { Active } from "@/components/ui/chart"

/**
 * 图表的坐标与光标（和 chart 一起装）：绘图区的版式、横向格线、右侧值轴、底部日期轴、十字线 + 圆点 + 提示卡。
 * - 版式：绘图区 | 右侧值轴槽 48；下面一行日期轴 28。值轴放右边：图的左缘和上面的标题、读数是同一条内容线（DESIGN.md §0.6），
 *   最新的点挨着刻度。绘图区顶上留 12 给最上面那行刻度字。
 * - 格线：1px 实线 line，基线 line-strong；没有竖格线。刻度字 13、注释墨、等宽数字，垂直居中在格线上，左对齐在槽里离图 8。
 * - 标签轴：互不相压；日期（多于 12 个，或 kind="date"）再加每 72px 至多一个；从最新一个往回数，首尾两个总在，首尾的标签不出绘图区的两边：
 *   最后一个右对齐到绘图区右缘，不伸进值轴槽（伸进去会压在最底下那行刻度字「0」下面，2026-10-04 复查）。
 * - 提示卡：白底浮层（bg-card + shadow-popover，圆角 popover），离十字线 8（§9.2 浮层与触发元素距离），竖向中线对着当前点（§0.3），
 *   放不下就换到左边；日期一行、每个系列一行（色键 · 名字 · 右对齐的数，数是墨色 500）。aria-hidden：值由绘图区的 aria-valuetext 念。
 *
 * 动效（DESIGN.md §5.1、§5.2）：
 * - 指针扫过（直接操作）→ 十字线、圆点、提示卡跟手走 follow（0.125s / 0.14），同一条弹簧、同拍；换边时提示卡的偏移也走 follow；
 *   一步跨过 200px 以上（指针甩过半张图）改走 smooth（§5.2 大位移）。
 *   刚进入绘图区时直接出现在当前点（不从上一次的位置滑过来）；提示卡淡入 200 / 淡出 150，十字线与圆点即时。
 * - 键盘走点 → 0ms：位置、透明度全部直接到位（§5.1）。
 * - 数据形变期间 → 圆点每一帧重新落在线上（chart 的 paint 调 sync），不另起动画。
 * - 减少动态时 → 位置直接到位，只留提示卡的淡入淡出。
 */

const GUTTER = 48
const TOP = 12
const AXIS = 28
const GAP = 8

/** 绘图区 + 右侧值轴槽 + 底部日期轴的版式；plot 收 ref 与扫读的事件 */
function ChartPlot({
  height,
  plotRef,
  plotProps,
  gutter,
  gutterWidth = GUTTER,
  axis,
  className,
  children,
}: {
  height: number
  plotRef: React.Ref<HTMLDivElement>
  plotProps?: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>
  gutter?: React.ReactNode
  /** 右侧槽的宽：值轴 48；河流图放层名时更宽 */
  gutterWidth?: number
  axis?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    // 焦点环（focus-ring-zone）画在整块版式上：只围绘图区时，离边 6 的环正好从右侧刻度字、底部日期字中间穿过
    <div data-slot="chart-plot-area" className="grid min-w-0 rounded-sm has-[>[data-slot=chart-plot]:focus-visible]:focus-ring-zone" style={{ gridTemplateColumns: `minmax(0,1fr) ${gutterWidth}px`, gridTemplateRows: `${height}px ${axis ? AXIS : 0}px` }}>
      <div
        ref={plotRef}
        data-slot="chart-plot"
        className={cn(
          "relative z-10 col-start-1 row-start-1 min-w-0 touch-pan-y outline-none select-none [-webkit-tap-highlight-color:transparent]",
          className
        )}
        {...plotProps}
      >
        {children}
      </div>
      <div aria-hidden data-slot="chart-gutter" className="relative col-start-2 row-start-1">
        {gutter}
      </div>
      {axis ? (
        <div aria-hidden data-slot="chart-axis" className="relative col-start-1 row-start-2 min-w-0">
          {axis}
        </div>
      ) : null}
    </div>
  )
}

/** 值 → 绘图区里的 y（像素，落在半像素上，1px 线不发虚） */
const yScale = (min: number, max: number, height: number) => (v: number) => TOP + (1 - (v - min) / (max - min || 1)) * (height - TOP)
const crisp = (y: number) => Math.round(y) + 0.5

/** 横向格线（SVG 里的一组 line）：key 是刻度值；位置、透明度由 paintTicks 写。strong 那一根（0，量程不含 0 时是最底下那根）深一档 */
function ChartGridLines({ keys, bind, strong = 0 }: { keys: string[]; bind: (key: string) => (el: SVGLineElement | null) => void; strong?: number }) {
  return (
    <g data-slot="chart-grid">
      {keys.map((k) => (
        <line key={k} ref={bind(k)} x1={0} x2="100%" y1={0} y2={0} className={Number(k) === strong ? "stroke-line-strong" : "stroke-line"} strokeWidth={1} shapeRendering="crispEdges" />
      ))}
    </g>
  )
}

/** 右侧值轴的刻度字 */
function ChartTicks({ keys, bind, format }: { keys: string[]; bind: (key: string) => (el: HTMLSpanElement | null) => void; format: (v: number) => string }) {
  return keys.map((k) => (
    <span key={k} ref={bind(k)} data-slot="chart-tick" data-value={k} className="absolute top-0 left-2 text-xs leading-none whitespace-nowrap text-fg-muted tabular-nums">
      {format(Number(k))}
    </span>
  ))
}

/** 形变的每一帧：格线与刻度字按此刻的量程放到位，透明度跟着淡入淡出；落到绘图区外的直接藏起来 */
function paintTicks(
  ticks: Record<string, number>,
  scale: { min: number; max: number; height: number },
  lines: Map<string, SVGLineElement>,
  labels: Map<string, HTMLSpanElement>,
  hide?: (y: number) => boolean
) {
  const y = yScale(scale.min, scale.max, scale.height)
  for (const [k, opacity] of Object.entries(ticks)) {
    const at = crisp(y(Number(k)))
    const out = at < TOP - 1 || at > scale.height + 1
    const line = lines.get(k)
    if (line) {
      line.setAttribute("transform", `translate(0 ${at})`)
      line.style.opacity = out ? "0" : String(opacity)
    }
    const label = labels.get(k)
    if (label) {
      label.style.transform = `translateY(${at}px) translateY(-50%)`
      label.style.opacity = out || hide?.(at) ? "0" : String(opacity)
    }
  }
}

/**
 * 底部标签轴。只要求标签互不相压（左右至少隔 GAP）；kind="date" 时再加「每 72px 至多一个」（DESIGN.md §4.6 只管日期标签）。
 * 不传 kind：超过 12 个标签按日期抽稀（30 天、一年的天），12 个以内（周几、瀑布的类目、数值刻度、时段）照类目放全，放不下才抽。
 * 抽稀从最新一个往回数，首尾两个总在（起点和「现在」一起才看得出窗口多长）：第一个和它右边那个相压时，让出的是右边那个。
 */
function ChartCategoryAxis({ labels, x, width, kind }: { labels: (string | undefined)[]; x: (i: number) => number; width: number; kind?: "date" | "category" }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const marked = labels.flatMap((l, i) => (l ? [i] : []))
  const date = (kind ?? (marked.length > 12 ? "date" : "category")) === "date"
  React.useEffect(() => {
    const elements = [...(ref.current?.children ?? [])] as HTMLElement[]
    const layout = elements.map((el) => {
      const w = el.getBoundingClientRect().width
      return { el, w, left: Math.max(0, Math.min(Number(el.dataset.x) - w / 2, width - w)) }
    })
    const n = layout.length
    const fits = (a: number, b: number) => Math.max(layout[a].left + layout[a].w + GAP, date ? layout[a].left + 72 : 0) <= layout[b].left
    const pick = (stride: number) => {
      const shown: number[] = []
      for (let i = n - 1; i >= 0; i -= stride) shown.unshift(i)
      if (shown[0] !== 0) {
        if (shown.length > 1 && shown[0] !== n - 1 && !fits(0, shown[0])) shown.shift()
        shown.unshift(0)
      }
      return shown
    }
    let shown = n ? [n - 1] : []
    for (let stride = 1; stride < Math.max(2, n); stride++) {
      const s = pick(stride)
      if (s.every((i, k) => k === 0 || fits(s[k - 1], i))) {
        shown = s
        break
      }
    }
    const keep = new Set(shown)
    layout.forEach(({ el, left }, i) => {
      el.style.left = `${left}px`
      el.style.visibility = keep.has(i) ? "" : "hidden"
    })
  }, [labels, width, x, date])
  if (!width) return null
  return (
    <div ref={ref} className="absolute inset-0">
      {marked.map((i) => (
        <span key={`${i}-${labels[i]}`} data-x={x(i)} data-slot="chart-axis-label" className="absolute top-2 text-xs leading-none whitespace-nowrap text-fg-muted tabular-nums">
          {labels[i]}
        </span>
      ))}
    </div>
  )
}

/**
 * 十字线 + 圆点 + 提示卡。x / y 是目标位置（当前点的像素）；dotsAt(px) 给出十字线在 px 时每个圆点的 y（圆点永远落在线上）。
 * syncRef：图表在数据形变的每一帧调它，圆点跟着线走。
 */
function ChartCursor({
  active,
  x,
  y,
  width,
  height,
  line = true,
  dots = [],
  dotsAt,
  syncRef,
  onMove,
  placeTip,
  children,
}: {
  active: Active
  x: number
  y: number
  width: number
  height: number
  line?: boolean
  dots?: { key: string; color: string }[]
  dotsAt?: (px: number) => number[]
  syncRef?: React.RefObject<(() => void) | null>
  /** 十字线每动一下（px），收起时 null：迷你图用它裁出游标之前的亮线 */
  onMove?: (px: number | null) => void
  /** 自己定提示卡的位置（雷达图放在度量名外侧）：收到提示卡的宽高，返回左上角；不传时在 x 的右边 / 左边、竖向对着 y */
  placeTip?: (w: number, h: number) => { x: number; y: number }
  children?: React.ReactNode
}) {
  const reduce = useReducedMotion()
  const cx = useMotionValue(x)
  const ty = useMotionValue(y)
  const offset = useMotionValue(GAP)
  const crossRef = React.useRef<HTMLDivElement>(null)
  const tipRef = React.useRef<HTMLDivElement>(null)
  // 提示卡第一次打开时内容还没排好（量到的高只有十几 px）：尺寸一变就按新尺寸重新夹边，不等指针再动（2026-10-06：首帧伸出绘图区底边 53–128px）
  const placeRef = React.useRef<() => void>(() => {})
  const fail = useInvariant("ChartCursor")
  const tipSize = useSizeCache(tipRef, (size) => {
    placeRef.current()
    // 不变量：提示卡放得下时，竖向必须整张落在绘图区里（DESIGN.md §4.3 浮层不越界）
    const tip = tipRef.current
    const { height } = latest.current
    const top = tip ? new DOMMatrixReadOnly(getComputedStyle(tip).transform).m42 : 0
    if (shown.current && size.height <= height && top + size.height > height + 0.5)
      fail(`提示卡（高 ${size.height.toFixed(0)}）伸出绘图区底边 ${(top + size.height - height).toFixed(0)}px`)
  })
  const dotRefs = React.useRef<(HTMLSpanElement | null)[]>([])
  const shown = React.useRef(false)
  const runs = React.useRef<{ stop: () => void }[]>([])
  const latest = React.useRef({ width, height, dotsAt, onMove, boxed: Boolean(placeTip) })
  latest.current = { width, height, dotsAt, onMove, boxed: Boolean(placeTip) }

  const place = React.useCallback(() => {
    const { width, height, dotsAt, onMove } = latest.current
    const px = cx.get()
    onMove?.(shown.current ? px : null)
    if (crossRef.current) crossRef.current.style.transform = `translateX(${Math.round(px) - 0.5}px)`
    const ys = dotsAt?.(px) ?? []
    dotRefs.current.forEach((dot, i) => {
      if (!dot) return
      const dy = ys[i]
      dot.style.visibility = Number.isFinite(dy) ? "" : "hidden"
      dot.style.transform = `translate(${px - 4}px, ${(dy || 0) - 4}px)`
    })
    const tip = tipRef.current
    if (tip) {
      const w = tipSize.current.width || tip.offsetWidth
      const h = tipSize.current.height || tip.offsetHeight
      const boxed = latest.current.boxed
      const left = Math.min(Math.max(px + offset.get(), 0), Math.max(0, width - w))
      const top = Math.min(Math.max(ty.get() - (boxed ? 0 : h / 2), 0), Math.max(0, height - h))
      tip.style.transform = `translate(${left}px, ${top}px)`
    }
  }, [cx, ty, offset, tipSize])
  placeRef.current = place

  React.useEffect(() => {
    const offs = [cx.on("change", place), ty.on("change", place), offset.on("change", place)]
    if (syncRef) syncRef.current = place
    return () => {
      offs.forEach((off) => off())
      if (syncRef) syncRef.current = null
    }
  }, [cx, ty, offset, place, syncRef])

  const index = active?.index ?? null
  React.useLayoutEffect(() => {
    runs.current.forEach((r) => r.stop())
    runs.current = []
    if (index === null) {
      shown.current = false
      latest.current.onMove?.(null)
      return
    }
    const w = tipRef.current?.offsetWidth ?? 0
    const h = tipRef.current?.offsetHeight ?? 0
    // 这里已经量过一次（换点时内容刚换好），顺手刷新缓存：place() 夹边用的是此刻的尺寸，不是上一次的
    if (tipRef.current) tipSize.current = { width: w, height: h }
    const box = placeTip?.(w, h)
    const side = box ? 0 : x + GAP + w <= width ? GAP : -GAP - w
    const tx = box ? box.x : x
    const tyTo = box ? box.y : y
    const jump = !shown.current || active?.keyboard || reduce
    shown.current = true
    if (jump) {
      cx.jump(tx)
      ty.jump(tyTo)
      offset.jump(side)
      place()
      return
    }
    // 一次跨过 200px 以上（指针甩过半张图）改用 smooth（§5.2：大位移只能用它）
    const spring = Math.abs(tx - cx.get()) > 200 ? SPRINGS.smooth : SPRINGS.follow
    return nextFrame(() => {
      runs.current = [animate(cx, tx, spring), animate(ty, tyTo, spring), animate(offset, side, spring)]
      place()
    })

  }, [index, x, y, width, height, active?.keyboard, reduce, cx, ty, offset, place, tipSize])
  React.useEffect(() => () => runs.current.forEach((r) => r.stop()), [])

  const open = index !== null
  // 提示卡常驻（淡出期间留着上一次的内容）；children 是 undefined 时这张图没有提示卡
  const content = React.useRef<React.ReactNode>(null)
  if (children) content.current = children
  return (
    <div aria-hidden data-slot="chart-cursor" data-open={open || undefined} className="pointer-events-none absolute inset-0 z-20">
      {line ? <div ref={crossRef} data-slot="chart-crosshair" className={cn("absolute inset-y-0 left-0 w-px bg-chart-cursor", !open && "invisible")} /> : null}
      {dots.map((d, i) => (
        <span
          key={d.key}
          ref={(el) => {
            dotRefs.current[i] = el
          }}
          data-slot="chart-dot"
          className={cn("absolute top-0 left-0 size-2 rounded-full", !open && "invisible")}
          style={{ background: d.color, boxShadow: "0 0 0 2px var(--chart-surface)" }}
        />
      ))}
      {children !== undefined ? (
        <div
          ref={tipRef}
          data-slot="chart-tooltip"
          className={cn(
            "absolute top-0 left-0 z-20 grid min-w-36 gap-1 rounded-popover bg-card px-3 py-2 shadow-popover",
            "transition-opacity ease-ds",
            open ? "opacity-100 duration-(--ds-dur-base)" : "opacity-0 duration-(--ds-dur-fast)",
            active?.keyboard && "transition-none"
          )}
        >
          {content.current}
        </div>
      ) : null}
    </div>
  )
}

/** 提示卡里的一行：色键 · 名字（次级墨）· 数（墨色 500，右对齐） */
function ChartTooltipRow({ name, value, children }: { name: React.ReactNode; value: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      {children}
      <span className="min-w-0 flex-1 truncate text-fg-muted">{name}</span>
      <span className="ml-2 font-medium whitespace-nowrap text-fg tabular-nums">{value}</span>
    </div>
  )
}

export { AXIS, ChartCategoryAxis, ChartCursor, ChartGridLines, ChartPlot, ChartTicks, ChartTooltipRow, crisp, GUTTER, paintTicks, TOP, yScale }
