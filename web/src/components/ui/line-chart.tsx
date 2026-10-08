"use client"

import * as React from "react"
import { area as d3area, line as d3line } from "d3-shape"

import { cn } from "@/lib/utils"
import { ChartFigure, ChartKey, ChartLegend, ChartStatus, useChartWidth, useDim, useFadeIn, useMorph, useRefMap, useScrub } from "@/components/ui/chart"
import { ChartTable } from "@/components/ui/chart-table"
import { alignShapes, formatNumber, formatTick as defaultTick, lerp, niceScale, seriesColor, shapeOf, valueAt, type Shape } from "@/components/ui/chart-scale"
import { ChartCategoryAxis, ChartCursor, ChartGridLines, ChartPlot, ChartTicks, ChartTooltipRow, crisp, paintTicks, TOP, yScale } from "@/components/ui/chart-axis"
import { fromKeyboard } from "@/components/ui/hotkeys"

/**
 * 折线图：一到三个量随时间怎么变（访问量、收入、耗时）。多系列共用一根值轴；十字线 + 提示卡读一天的全部系列；图例开关系列；
 * 图上方已有读数跟着十字线换（onActiveChange）时写 tooltip={false}：提示卡和读数是同一件事，只留一处，十字线与圆点照常。
 * 换范围（7 天 → 30 天）时线从屏幕上的形状形变到新形状。大数字读数不在图里：用 onActiveChange 放在图上方（见示例）。
 * - 线宽 2，圆头圆角；默认不铺淡底（2026-10-05：灰雾像山水画），系列写 area 才铺一层强调蓝淡底；dashed 的系列是 4 / 4 虚线（「上期」「目标」），图例色键同样是虚线。
 * - 颜色：第一个系列墨色，之后墨色递减；tone="accent" 给唯一要强调的系列。不要传具体色值。
 * - interval 用 data.values 的上下界画6%墨色范围带，量程包括两界，缺失处断开；读屏表格列上下界，不增加系列。
 * - 平滑曲线是单调三次（不越过数据点）；缺失值（null）处断开，不当成 0。
 * - 加载、空、出错见 chart 底座：有旧图时加载只把旧图变淡。
 * - 参考线（references：阈值、目标、预算、提醒金额）：1px 虚线 2 / 3、fg-muted，横贯绘图区；数写在右侧值轴槽里（500），离它不到 14 的刻度字让位；
 *   名字写在线的左端上方（和图的左缘同一条内容线），字带一圈底色描边：数据线穿过名字时断开，字不被划掉。量程把参考线算进去，线永远在图里。传了 onValueChange 的参考线能拖：
 *   槽里的数变成一颗凸起的把手（role="slider"），指针按住上下拖、键盘 ↑↓ 一步、PageUp / PageDown 十步、Home / End 到两端；拖动中量程冻住，
 *   松手后量程再按新值重算。读屏：隐藏的一句列出全部参考线，把手念「名字 数值」。
 *
 * 动效（DESIGN.md §5.1、§5.2；谁引起 → 用哪条 → 减少动态时）：
 * - 换范围、数据刷新（指针或系统）→ 线、淡底、量程、格线同拍形变，smooth；中途再换从当前形状接着走 → 键盘引起、减少动态时直接到位。
 * - 图例关掉一个系列（指针）→ 它压回基线并淡出，其余的线随新量程形变，smooth；打开时从基线升起 → 键盘 0ms。
 * - 指针扫过 → 十字线、圆点、提示卡 follow 跟手；键盘 ←→ 走点 0ms。第一次出现不画线（§5.1 滚动进入只给展示组件）。
 * - 参考线换值：使用方改了数（指针点了别的预设、系统）→ 跟量程同一条 smooth 形变；拖把手（指针直接操作）→ 1:1 跟手（量程冻住，不形变）；
 *   松手后量程重算 → smooth；键盘改值 → 0ms。把手按下：阴影压平 100、松手弹回 150（颜色档）。减少动态时都直接到位。
 */

type LineChartDatum = { key: string; label: string; axisLabel?: string; values: Record<string, number | null | undefined> }
type LineChartSeries = { key: string; label: string; dashed?: boolean; area?: boolean; tone?: "accent" }
/** 参考线：阈值、目标、预算。传 onValueChange 就能拖（min / max 默认是此刻的量程，step 默认 1） */
type LineChartReference = { key: string; label: string; value: number; onValueChange?: (value: number) => void; min?: number; max?: number; step?: number }

/** 线型：dashed 的系列（上期、目标）4 / 4；第三个系列默认 6 / 3——它的墨色只有 48%，再靠形状区分（DESIGN.md §9.9） */
const dashOf = (s: LineChartSeries, i: number) => (s.dashed ? "4 4" : i === 2 && s.tone !== "accent" ? "6 3" : undefined)

type State = { min: number; max: number; ticks: Record<string, number>; lines: Record<string, Shape & { o: number }>; refs: Record<string, number> }
type Scale = { min: number; max: number; ticks: number[] }

const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : NaN)

function LineChart({
  data,
  series,
  label,
  unit = "",
  height = 224,
  format = formatNumber,
  formatTick = defaultTick,
  hiddenSeries,
  defaultHiddenSeries = [],
  onHiddenSeriesChange,
  onActiveChange,
  loading = false,
  error,
  onRetry,
  emptyLabel = "这段时间没有数据",
  legend,
  categoryLabel = "日期",
  curve = "smooth",
  zero = true,
  surface,
  references = [],
  interval,
  tooltip = true,
  className,
}: {
  data: LineChartDatum[]
  series: LineChartSeries[]
  label: string
  unit?: string
  height?: number
  format?: (value: number) => string
  formatTick?: (value: number) => string
  hiddenSeries?: string[]
  defaultHiddenSeries?: string[]
  onHiddenSeriesChange?: (hidden: string[]) => void
  onActiveChange?: (index: number | null, datum: LineChartDatum | null) => void
  loading?: boolean
  error?: React.ReactNode
  onRetry?: () => void
  emptyLabel?: string
  legend?: boolean
  categoryLabel?: string
  curve?: "smooth" | "linear"
  zero?: boolean
  surface?: "canvas" | "card"
  /** 两个 data.values key 构成范围带，不占用系列数；缺失处断开。 */
  interval?: { lowerKey: string; upperKey: string; label: string }
  references?: LineChartReference[]
  /** false：不出提示卡（读数已在图上方跟着 onActiveChange 换），十字线与圆点照常 */
  tooltip?: boolean
  className?: string
}) {
  const [innerHidden, setInnerHidden] = React.useState(defaultHiddenSeries)
  const hidden = hiddenSeries ?? innerHidden
  const setHidden = (next: string[]) => {
    if (hiddenSeries === undefined) setInnerHidden(next)
    onHiddenSeriesChange?.(next)
  }
  const [plotRef, width] = useChartWidth<HTMLDivElement>()
  const n = data.length
  const empty = n === 0
  const rows = Math.max(2, Math.min(4, Math.floor((height - TOP) / 48)))
  const colors = series.map((s, i) => seriesColor(i, s.tone))
  const visible = series.filter((s) => !hidden.includes(s.key))

  // 拖参考线的把手时量程冻住（线跟着手，不跟着量程跑）；松手后解冻，量程按新值重算
  const [frozen, setFrozen] = React.useState<Scale | null>(null)
  const dragging = React.useRef(false)
  const refsKey = references.map((r) => `${r.key}:${r.value}`).join("|")
  const target = React.useMemo<State>(() => {
    const all = [...visible.flatMap((s) => data.map((d) => num(d.values[s.key]))), ...(interval ? data.flatMap(d => [num(d.values[interval.lowerKey]), num(d.values[interval.upperKey])]) : []), ...(data.length ? references.map((r) => r.value) : [])].filter(Number.isFinite)
    const scale = frozen ?? niceScale(Math.min(...all), Math.max(...all), rows, zero)
    const lines: State["lines"] = {}
    for (const s of series) {
      const shape = shapeOf(data.map((d) => num(d.values[s.key])), curve === "smooth")
      const off = hidden.includes(s.key)
      lines[s.key] = { xs: shape.xs, ys: off ? shape.ys.map(() => scale.min) : shape.ys, o: off ? 0 : 1 }
    }
    if (interval) for (const key of [interval.lowerKey, interval.upperKey]) lines[key] = { ...shapeOf(data.map(d => num(d.values[key])), curve === "smooth"), o: 1 }
    const ticks = empty ? { [String(scale.min)]: 1 } : Object.fromEntries(scale.ticks.map((t) => [String(t), 1]))
    const refs = Object.fromEntries(references.map((r) => [r.key, r.value]))
    return { min: scale.min, max: scale.max, ticks, lines, refs }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, series, hidden.join("|"), curve, zero, rows, refsKey, frozen, interval?.lowerKey, interval?.upperKey])

  const [lineEls, bindLine] = useRefMap<SVGPathElement>()
  const [areaEls, bindArea] = useRefMap<SVGPathElement>()
  const [gridEls, bindGrid] = useRefMap<SVGLineElement>()
  const [tickEls, bindTick] = useRefMap<HTMLSpanElement>()
  const [refLines, bindRefLine] = useRefMap<SVGLineElement>()
  const [refMarks, bindRefMark] = useRefMap<HTMLElement>()
  const intervalEl = React.useRef<SVGPathElement>(null)
  const syncCursor = React.useRef<(() => void) | null>(null)

  const paint = (s: State) => {
    if (!width) return
    const y = yScale(s.min, s.max, height)
    for (const [key, l] of Object.entries(s.lines)) {
      const pts = l.xs.map((x, i) => [x * width, y(l.ys[i])] as [number, number])
      const ok = (p: [number, number]) => Number.isFinite(p[1])
      const path = lineEls.current.get(key)
      if (path) {
        path.setAttribute("d", d3line().defined(ok)(pts) ?? "")
        path.style.opacity = String(l.o)
      }
      const fill = areaEls.current.get(key)
      if (fill) {
        // 淡底朝 0 铺：量程跨过 0（有负值）时铺到 0 那根线，不铺到图底；不含 0 时铺到离 0 最近的边
        fill.setAttribute("d", d3area().defined(ok).y0(y(Math.min(Math.max(0, s.min), s.max)))(pts) ?? "")
        fill.style.opacity = String(l.o)
      }
    }
    if (interval) {
      const lo = s.lines[interval.lowerKey], hi = s.lines[interval.upperKey]
      const points: [number, number, number][] = lo && hi ? lo.xs.map((x, i) => [x * width, y(lo.ys[i]), y(valueAt(hi, x))]) : []
      intervalEl.current?.setAttribute("d", d3area<[number, number, number]>().defined(p => Number.isFinite(p[1]) && Number.isFinite(p[2])).x(p => p[0]).y0(p => p[1]).y1(p => p[2])(points) ?? "")
    }
    // 参考线：线、槽里的数（或把手）、左端的名字；离参考线不到 14 的刻度字让位
    const refYs: number[] = []
    for (const [key, v] of Object.entries(s.refs)) {
      const at = crisp(y(v))
      const ok = Number.isFinite(at) && !empty
      if (ok) refYs.push(at)
      refLines.current.get(key)?.setAttribute("transform", `translate(0 ${ok ? at : -10})`)
      for (const part of ["value", "name"]) {
        const el = refMarks.current.get(`${part}:${key}`)
        if (!el) continue
        el.style.visibility = ok ? "" : "hidden"
        el.style.transform = part === "value" ? `translateY(${at}px) translateY(-50%)` : `translateY(${at - 4}px) translateY(-100%)`
      }
    }
    paintTicks(s.ticks, { min: s.min, max: s.max, height }, gridEls.current, tickEls.current, (at) => empty || refYs.some((ry) => Math.abs(at - ry) < 14))
    syncCursor.current?.()
  }

  const mix = (from: State, to: State) => {
    const has = (s: State) => Object.values(s.lines).some((l) => l.xs.length)
    if (!has(from) || !has(to)) return null
    const pairs = Object.entries(to.lines).map(([key, l]) => {
      const f = from.lines[key] ?? { xs: [], ys: [], o: 0 }
      return [key, alignShapes(f, l, [from.min, to.min]), f.o, l.o] as const
    })
    const tickKeys = [...new Set([...Object.keys(from.ticks), ...Object.keys(to.ticks)])]
    // 在屏幕坐标插值：千万次换成百席时，原始值与量程同时插值会把变化挤到最后一帧。
    const mixValue = (a: number, b: number, t: number) => {
      const lo = lerp(from.min, to.min, t), hi = lerp(from.max, to.max, t)
      return lo + lerp((a - from.min) / (from.max - from.min || 1), (b - to.min) / (to.max - to.min || 1), t) * (hi - lo)
    }
    return (t: number): State => ({
      min: lerp(from.min, to.min, t),
      max: lerp(from.max, to.max, t),
      ticks: Object.fromEntries(tickKeys.map((k) => [k, lerp(from.ticks[k] ?? 0, to.ticks[k] ?? 0, t)])),
      lines: Object.fromEntries(pairs.map(([key, a, fo, to]) => [key, { xs: a.xs, ys: a.from.map((v, i) => mixValue(v, a.to[i], t)), o: lerp(fo, to, t) }])),
      refs: Object.fromEntries(Object.entries(to.refs).map(([key, v]) => [key, mixValue(from.refs[key] ?? v, v, t)])),
    })
  }
  // 拖把手时直接到位（跟手 1:1）；键盘引起的同样 0ms
  const morph = useMorph(target, mix, paint, (s) => Object.keys(s.ticks), () => dragging.current || fromKeyboard())
  React.useLayoutEffect(() => morph.repaint(), [morph.repaint, morph.keys, width, height])

  const xOf = (i: number) => (n === 1 ? width / 2 : (i / Math.max(1, n - 1)) * width)
  const pick = (px: number) => (n <= 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round((px / (width || 1)) * (n - 1)))))
  const scrub = useScrub(n, pick, (i) => onActiveChange?.(i, i === null ? null : data[i]))
  const active = scrub.active
  const at = active ? data[active.index] : null
  const y = yScale(target.min, target.max, height)
  const tops = at ? visible.map((s) => y(num(at.values[s.key]))).filter(Number.isFinite) : []
  const tipY = tops.length ? Math.min(...tops) : height / 2
  const value = (s: LineChartSeries, d: LineChartDatum) => {
    const v = num(d.values[s.key])
    return Number.isFinite(v) ? `${format(v)}${unit}` : "—"
  }
  const readAll = (d: LineChartDatum) => `${d.label}：${visible.map((s) => `${s.label} ${value(s, d)}`).join("，")}`
  const fade = useFadeIn<SVGSVGElement>(!empty)
  const dim = useDim(loading && !empty)
  const refText = (r: LineChartReference) => `${r.label} ${format(r.value)}${unit}`
  const draggable = references.filter((r) => r.onValueChange)

  return (
    <ChartFigure label={label} surface={surface} busy={loading} data-slot="line-chart" className={className}>
      {/* 区间带是图例里的一个说明项：排在系列后面、同一行（不单独占一行）；色块和图上的带同色同透明度 */}
      {(legend ?? series.length > 1) || interval ? (
        <ChartLegend
          items={(legend ?? series.length > 1) ? series.map((s, i) => ({ key: s.key, label: s.label, color: colors[i], dashed: Boolean(dashOf(s, i)) })) : []}
          hidden={hidden}
          onHiddenChange={setHidden}
          extra={interval ? <><span aria-hidden data-slot="chart-interval-key" className="h-3 w-4 bg-chart-1" style={{ opacity: "var(--ds-chart-area)" }} />{interval.label}</> : undefined}
        />
      ) : null}
      {/* 外面一层 relative：能拖的参考线把手叠在值轴槽的位置上 */}
      <div className="relative min-w-0">
        <ChartPlot
          height={height}
          plotRef={plotRef}
          plotProps={{
            ...scrub.props,
            "aria-label": label,
            "aria-valuetext": empty ? emptyLabel : at ? readAll(at) : `最新 ${readAll(data[n - 1])}`,
          }}
          gutter={
            <>
              <ChartTicks keys={morph.keys} bind={bindTick} format={formatTick} />
              {references
                .filter((r) => !r.onValueChange)
                .map((r) => (
                  <span key={r.key} ref={bindRefMark(`value:${r.key}`)} data-slot="chart-reference" data-key={r.key} className="absolute top-0 left-2 text-xs leading-none font-medium whitespace-nowrap text-fg-muted tabular-nums">
                    {formatTick(r.value)}
                  </span>
                ))}
            </>
          }
          axis={<ChartCategoryAxis labels={data.map((d) => d.axisLabel ?? d.label)} x={xOf} width={width} />}
        >
          <svg ref={fade} aria-hidden className={`absolute inset-0 size-full overflow-visible ${error ? "invisible" : ""} ${dim}`}>
            <ChartGridLines keys={morph.keys} bind={bindGrid} strong={target.min <= 0 && target.max >= 0 ? 0 : target.min} />
            {interval ? <path ref={intervalEl} data-slot="chart-interval" className="fill-chart-1" style={{ fillOpacity: "var(--ds-chart-area)" }} /> : null}
            {references.map((r) => (
              <line key={r.key} ref={bindRefLine(r.key)} data-slot="chart-reference-line" data-key={r.key} x1={0} x2="100%" y1={0} y2={0} strokeDasharray="2 3" strokeWidth={1} shapeRendering="crispEdges" className="stroke-fg-muted" />
            ))}
            {series.map((s, i) => (
              <g key={s.key} data-series={s.key}>
                {s.area ? <path ref={bindArea(s.key)} data-slot="chart-area" style={{ fill: colors[i], fillOpacity: "var(--ds-chart-area)" }} /> : null}
                <path
                  ref={bindLine(s.key)}
                  data-slot="chart-line"
                  fill="none"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={dashOf(s, i)}
                  style={{ stroke: colors[i] }}
                />
              </g>
            ))}
          </svg>
          {!error
            ? references.map((r) => (
                <span key={r.key} aria-hidden ref={bindRefMark(`name:${r.key}`)} data-slot="chart-reference-label" data-key={r.key} className="pointer-events-none absolute top-0 left-0 text-xs leading-none whitespace-nowrap text-fg-muted [paint-order:stroke_fill] [-webkit-text-stroke:4px_var(--chart-surface)]">
                  {r.label}
                </span>
              ))
            : null}
          {!empty && !error ? (
            <ChartCursor
              active={active}
              x={active ? xOf(active.index) : 0}
              y={tipY}
              width={width}
              height={height}
              dots={visible.map((s) => ({ key: s.key, color: colors[series.indexOf(s)] }))}
              dotsAt={(px) => {
                const s = morph.shown.current
                const ys = yScale(s.min, s.max, height)
                // 系列替换时，新 Cursor props 可能先于旧形变完成回调生效；尚未进入 shown 的系列暂时隐藏圆点。
                return visible.map((v) => s.lines[v.key] ? ys(valueAt(s.lines[v.key], width ? px / width : 0)) : NaN)
              }}
              syncRef={syncCursor}
            >
              {!tooltip ? undefined : at ? (
                <>
                  <span className="text-xs text-fg-muted tabular-nums">{at.label}</span>
                  {visible.map((s) => (
                    <ChartTooltipRow key={s.key} name={s.label} value={value(s, at)}>
                      <ChartKey color={colors[series.indexOf(s)]} dashed={Boolean(dashOf(s, series.indexOf(s)))} />
                    </ChartTooltipRow>
                  ))}
                </>
              ) : null}
            </ChartCursor>
          ) : null}
          <ChartStatus loading={loading} empty={empty} error={error} emptyLabel={emptyLabel} onRetry={onRetry} />
        </ChartPlot>
        {draggable.length && !error && !empty ? (
          <ReferenceHandles
            references={draggable}
            bind={bindRefMark}
            scale={() => morph.shown.current}
            height={height}
            format={formatTick}
            valueText={refText}
            onDrag={(on) => {
              dragging.current = on
              setFrozen(on ? { min: target.min, max: target.max, ticks: Object.keys(target.ticks).map(Number) } : null)
            }}
          />
        ) : null}
      </div>
      {references.length ? <p className="sr-only">{`参考线：${references.map(refText).join("，")}`}</p> : null}
      <ChartTable caption={label} head={[categoryLabel, ...series.map((s) => s.label), ...(interval ? [`${interval.label}下界`, `${interval.label}上界`] : [])]} rows={data.map((d) => [d.label, ...series.map((s) => value(s, d)), ...(interval ? [interval.lowerKey, interval.upperKey].map(key => Number.isFinite(num(d.values[key])) ? `${format(num(d.values[key]))}${unit}` : "—") : [])])} />
      <span className="sr-only" aria-live="polite">
        {loading ? "正在加载" : ""}
      </span>
    </ChartFigure>
  )
}

/**
 * 能拖的参考线把手：叠在右侧值轴槽上（槽本身 aria-hidden，把手要能聚焦，所以放在槽外、绝对定位到同一位置）。
 * 凸起的小块（bg-card shadow-raised，按下压平）写着当前值；按住上下拖跟手，键盘 ↑↓ / PageUp / PageDown / Home / End。
 * 竖向位置由 LineChart 的 paint 每一帧写 transform（和线同拍）。
 */
function ReferenceHandles({
  references,
  bind,
  scale,
  height,
  format,
  valueText,
  onDrag,
}: {
  references: LineChartReference[]
  bind: (key: string) => (el: HTMLElement | null) => void
  scale: () => { min: number; max: number }
  height: number
  format: (v: number) => string
  valueText: (r: LineChartReference) => string
  onDrag: (on: boolean) => void
}) {
  const drag = React.useRef<number | null>(null)
  const clamp = (r: LineChartReference, v: number) => {
    const s = scale()
    const step = r.step ?? 1
    return Math.min(r.max ?? s.max, Math.max(r.min ?? s.min, Math.round(v / step) * step))
  }
  const fromY = (r: LineChartReference, py: number) => {
    const s = scale()
    return clamp(r, s.min + (1 - (py - TOP) / (height - TOP)) * (s.max - s.min))
  }
  const end = () => {
    if (drag.current === null) return
    drag.current = null
    onDrag(false)
  }
  return (
    <div data-slot="chart-reference-handles" className="pointer-events-none absolute top-0 right-0 w-12" style={{ height }}>
      {references.map((r) => (
        <span
          key={r.key}
          ref={bind(`value:${r.key}`)}
          role="slider"
          tabIndex={0}
          aria-label={r.label}
          aria-orientation="vertical"
          aria-valuenow={r.value}
          aria-valuemin={r.min ?? scale().min}
          aria-valuemax={r.max ?? scale().max}
          aria-valuetext={valueText(r)}
          data-slot="chart-reference-handle"
          data-key={r.key}
          className={cn(
            "pointer-events-auto absolute top-0 left-1 inline-flex h-5 cursor-ns-resize touch-none items-center rounded-sm bg-card px-1 text-xs leading-none font-medium whitespace-nowrap text-fg tabular-nums shadow-raised outline-none select-none",
            "active:shadow-pressed focus-visible:focus-ring",
            // 触屏热区：上下各伸出 12，凑够 44 高
            "before:absolute before:-inset-x-1 before:-inset-y-3 before:content-['']"
          )}
          onPointerDown={(e) => {
            if (drag.current !== null) return
            e.preventDefault()
            e.currentTarget.focus({ preventScroll: true })
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = e.pointerId
            onDrag(true)
          }}
          onPointerMove={(e) => {
            if (drag.current !== e.pointerId) return
            const parent = e.currentTarget.parentElement!
            const box = parent.getBoundingClientRect()
            // 屏幕像素换回布局像素（祖先有 CSS zoom 时两者不等）
            const k = parent.offsetHeight ? box.height / parent.offsetHeight : 1
            const next = fromY(r, (e.clientY - box.top) / k)
            if (next !== r.value) r.onValueChange?.(next)
          }}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={end}
          onKeyDown={(e) => {
            const step = r.step ?? 1
            const s = scale()
            const next: Record<string, number> = {
              ArrowUp: r.value + step,
              ArrowRight: r.value + step,
              ArrowDown: r.value - step,
              ArrowLeft: r.value - step,
              PageUp: r.value + step * 10,
              PageDown: r.value - step * 10,
              Home: r.min ?? s.min,
              End: r.max ?? s.max,
            }
            if (!(e.key in next)) return
            e.preventDefault()
            const v = clamp(r, next[e.key])
            if (v !== r.value) r.onValueChange?.(v)
          }}
        >
          {format(r.value)}
        </span>
      ))}
    </div>
  )
}

export { dashOf, LineChart }
export type { LineChartDatum, LineChartReference, LineChartSeries }
