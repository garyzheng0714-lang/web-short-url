"use client"

import * as React from "react"
import { area as d3area, line as d3line } from "d3-shape"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import { useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { ChartFigure, ChartStatus, RollingValue, useChartWidth, useDim, useFadeIn, useMorph, useScrub } from "@/components/ui/chart"
import { ChartCursor } from "@/components/ui/chart-axis"
import { alignShapes, formatNumber, formatPercent, lerp, shapeOf, valueAt, type Shape } from "@/components/ui/chart-scale"
import { fromKeyboard } from "@/components/ui/hotkeys"

/**
 * 迷你图：一行小趋势——名字 · 读数 · 变化，下面一条没有坐标轴的线；按住或悬停拖着读历史值。放在卡片、指标、表格行里。
 * - 读数行：名字、数、单位、变化按基线排成一行（滚动的数位垫着看不见的同样文字，基线才对得上）；单位和数同字号、次级墨。
 * - 线宽 1.5（同图标），chart-1 强调蓝；可选淡底读 chart-area；末点一个 6 的实心点。量程是数据的最小到最大（只看形状，不从 0 起）。
 * - 按真实像素画（不拉伸）：四周留 4，末点不会被裁一半、也不会被压成椭圆。
 * - 扫读：游标之前的线用 chart-1、之后用 chart-trail；读数换成那个点，变化的位置换成那个点的名字（labels）；离开、抬手回到最新。
 * - 焦点用区的环（focus-ring-zone，外侧离边 6，同 ChartPlot）：游标竖线贯穿绘图区上下，内侧环会被它盖住。
 * - 变化的箭头 14（13 号字配 14，DESIGN.md §4.5）。
 * - interactive={false}：没有 Tab 停靠、不响应指针（密的表格里用，几十行不会多出几十个停靠点）；readout={false} 只剩线。
 * - 变化 change 是小数（0.072 = 上升 7.2%），upIsGood=false 时上升是坏事；颜色只在方向箭头上，文字灰阶，读屏念「上升 / 下降」。
 *
 * 动效（DESIGN.md §5.1、§5.2；谁引起 → 用哪条 → 减少动态时）：
 * - 数据变了（指针点了范围、系统刷新）→ 线从当前形状形变到新形状，smooth；读数按位滚到新的最新值 → 键盘引起、减少动态时直接到位。
 * - 指针扫过 → 游标的竖线与圆点 follow 跟手，亮线的裁切边同拍；读数直接换数字 → 键盘走点 0ms。第一次出现不画线。
 */

type State = { min: number; max: number; shape: Shape }
const PAD = 4
const DIM = "var(--ds-chart-trail)"

function Sparkline({
  data,
  label,
  labels,
  format = formatNumber,
  unit = "",
  change,
  upIsGood = true,
  changeLabel = "较期初",
  readout = true,
  interactive = true,
  height = 40,
  area = true,
  loading = false,
  error,
  onRetry,
  emptyLabel = "暂无数据",
  onActiveChange,
  surface,
  className,
}: {
  data: number[]
  label: string
  labels?: string[]
  format?: (value: number) => string
  unit?: string
  change?: number
  upIsGood?: boolean
  changeLabel?: string
  readout?: boolean
  interactive?: boolean
  height?: number
  area?: boolean
  loading?: boolean
  error?: React.ReactNode
  onRetry?: () => void
  emptyLabel?: string
  onActiveChange?: (index: number | null) => void
  surface?: "canvas" | "card"
  className?: string
}) {
  const [plotRef, width] = useChartWidth<HTMLDivElement>()
  const n = data.length
  const empty = n === 0
  const id = React.useId()
  const reduce = useReducedMotion()

  const target = React.useMemo<State>(() => {
    const finite = data.filter(Number.isFinite)
    let [min, max] = [Math.min(...finite), Math.max(...finite)]
    if (!finite.length) [min, max] = [0, 1]
    else if (min === max) [min, max] = [min - 1, max + 1]
    return { min, max, shape: shapeOf(data) }
  }, [data])

  const lines = React.useRef<{ base: SVGPathElement | null; bright: SVGPathElement | null; fill: SVGPathElement | null; clip: SVGRectElement | null; end: SVGCircleElement | null }>({ base: null, bright: null, fill: null, clip: null, end: null })
  const inner = Math.max(0, width - 2 * PAD)
  const yOf = (s: State) => (v: number) => PAD + (1 - (v - s.min) / (s.max - s.min || 1)) * (height - 2 * PAD)
  const syncCursor = React.useRef<(() => void) | null>(null)
  const paint = (s: State) => {
    if (!width) return
    const y = yOf(s)
    const pts = s.shape.xs.map((x, i) => [PAD + x * inner, y(s.shape.ys[i])] as [number, number])
    const ok = (p: [number, number]) => Number.isFinite(p[1])
    const d = d3line().defined(ok)(pts) ?? ""
    lines.current.base?.setAttribute("d", d)
    lines.current.bright?.setAttribute("d", d)
    lines.current.fill?.setAttribute("d", d3area().defined(ok).y0(height - PAD)(pts) ?? "")
    const last = pts.at(-1)
    if (lines.current.end && last) {
      lines.current.end.setAttribute("cx", String(last[0]))
      lines.current.end.setAttribute("cy", String(last[1]))
    }
    syncCursor.current?.()
  }
  const mix = (from: State, to: State) => {
    if (!from.shape.xs.length || !to.shape.xs.length) return null
    const a = alignShapes(from.shape, to.shape, [from.min, to.min])
    return (t: number): State => ({ min: lerp(from.min, to.min, t), max: lerp(from.max, to.max, t), shape: { xs: a.xs, ys: a.from.map((v, i) => lerp(v, a.to[i], t)) } })
  }
  const morph = useMorph(target, mix, paint, () => [])
  React.useLayoutEffect(() => morph.repaint(), [morph.repaint, width, height])

  const xOf = (i: number) => PAD + (n === 1 ? 0.5 : i / Math.max(1, n - 1)) * inner
  const pick = (px: number) => (n <= 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round(((px - PAD) / (inner || 1)) * (n - 1)))))
  // 读数：数据变了按位滚；扫读带来的换数直接换
  const [still, setStill] = React.useState(true)
  const [prevData, setPrevData] = React.useState(data)
  const [dir, setDir] = React.useState(1)
  if (prevData !== data) {
    setPrevData(data)
    setStill(false)
    setDir((data.at(-1) ?? 0) >= (prevData.at(-1) ?? 0) ? 1 : -1)
  }
  const scrub = useScrub(interactive ? n : 0, pick, (i) => {
    setStill(true)
    onActiveChange?.(i)
  })
  const active = interactive ? scrub.active : null
  const index = active?.index ?? n - 1
  const value = data[index]
  const text = Number.isFinite(value) ? format(value) : "—"
  const nameOf = (i: number) => labels?.[i] ?? `第 ${i + 1} 个`
  const up = (change ?? 0) >= 0
  const Arrow = up ? ArrowUpRight : ArrowDownRight
  const changeText = change === undefined ? "" : `${changeLabel}${up ? "上升" : "下降"} ${formatPercent(Math.abs(change))}`
  const summary = empty ? emptyLabel : `最新 ${nameOf(n - 1)} ${text}${unit}${changeText ? `，${changeText}` : ""}`
  const fade = useFadeIn<SVGSVGElement>(!empty)
  const dim = useDim(loading && !empty)
  const clipTo = (px: number | null) => {
    lines.current.clip?.setAttribute("width", String(px === null ? width + 2 * PAD : Math.max(0, px + PAD)))
    if (lines.current.end) lines.current.end.style.visibility = px === null ? "" : "hidden"
  }

  return (
    <ChartFigure label={interactive ? label : `${label}：${summary}`} surface={surface} busy={loading} data-slot="sparkline" className={cn("gap-2", className)}>
      {readout ? (
        <div data-slot="sparkline-readout" className="flex min-w-0 items-baseline gap-3 text-sm">
          <span className="min-w-0 flex-1 truncate text-fg-muted">{label}</span>
          {interactive ? <span className="sr-only">{active ? `${nameOf(index)} ${text}${unit}` : summary}</span> : null}
          <span aria-hidden className="whitespace-nowrap">
            <RollingValue slot="sparkline-value" text={text} dir={dir} still={still || Boolean(reduce) || fromKeyboard()} className="font-medium text-fg" />
            {unit ? <span className="ml-1 text-fg-muted">{unit}</span> : null}
          </span>
          {active ? (
            <span aria-hidden data-slot="sparkline-aside" className="text-xs whitespace-nowrap text-fg-muted tabular-nums">
              {nameOf(index)}
            </span>
          ) : change !== undefined ? (
            <span aria-hidden data-slot="sparkline-aside" className="flex items-center gap-1 self-center text-xs whitespace-nowrap text-fg-muted tabular-nums">
              <Arrow data-slot="sparkline-arrow" data-good={up === upIsGood} className={cn("size-3.5 shrink-0", up === upIsGood ? "text-success" : "text-danger")} />
              {formatPercent(Math.abs(change))}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        ref={plotRef}
        data-slot="chart-plot"
        {...(interactive ? { ...scrub.props, "aria-label": label, "aria-valuetext": active ? `${nameOf(index)}：${text}${unit}` : summary } : {})}
        className={cn("relative min-w-0 rounded-sm outline-none select-none", interactive && "touch-pan-y focus-visible:focus-ring-zone")}
        style={{ height }}
      >
        <svg ref={fade} aria-hidden className={cn("absolute inset-0 size-full overflow-visible", error && "invisible", dim)}>
          <defs>
            <clipPath id={id}>
              <rect ref={(el) => void (lines.current.clip = el)} x={-PAD} y={-PAD} height={height + 2 * PAD} width={width + 2 * PAD} />
            </clipPath>
          </defs>
          <path ref={(el) => void (lines.current.base = el)} data-slot="sparkline-base" fill="none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: DIM }} />
          <g clipPath={`url(#${id})`}>
            {area ? <path ref={(el) => void (lines.current.fill = el)} data-slot="chart-area" style={{ fill: "var(--color-chart-1)", fillOpacity: "var(--ds-chart-area)" }} /> : null}
            <path ref={(el) => void (lines.current.bright = el)} data-slot="chart-line" fill="none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--ds-chart-1)" }} />
          </g>
          {!empty ? <circle ref={(el) => void (lines.current.end = el)} data-slot="sparkline-end" r={3} style={{ fill: "var(--ds-chart-1)" }} /> : null}
        </svg>
        {interactive && !empty && !error ? (
          <ChartCursor
            active={active}
            x={active ? xOf(active.index) : 0}
            y={0}
            width={width}
            height={height}
            dots={[{ key: "v", color: "var(--ds-chart-1)" }]}
            dotsAt={(px) => {
              const s = morph.shown.current
              return [yOf(s)(valueAt(s.shape, inner ? (px - PAD) / inner : 0))]
            }}
            syncRef={syncCursor}
            onMove={clipTo}
          />
        ) : null}
        <ChartStatus loading={loading} empty={empty} error={error} emptyLabel={emptyLabel} onRetry={onRetry} />
      </div>
    </ChartFigure>
  )
}

export { Sparkline }
