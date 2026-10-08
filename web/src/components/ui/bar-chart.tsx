import * as React from "react"
import { RadioGroup as RadioPrimitive } from "radix-ui"

import { ChartFigure, ChartKey, ChartReadout, ChartStatus, useChartWidth, useDim, useFadeIn, useMorph, useRefMap, useScrub } from "@/components/ui/chart"
import { ChartTable } from "@/components/ui/chart-table"
import { ChartCategoryAxis, ChartGridLines, ChartPlot, ChartTicks, crisp, GUTTER, paintTicks, TOP, yScale } from "@/components/ui/chart-axis"
import { BAR, formatColumn, formatTick as defaultTick, lerp, niceScale } from "@/components/ui/chart-scale"

/**
 * 柱状图：一个量在一个个时段里的大小（每天的活跃时长、每月的订单）。上方是读数（静止时是平均、扫读时是当前柱），
 * base 可给浮动起点；受控 selectedKey + onSelectedKeyChange 开启整格单选，Radix 管方向键与焦点。showValues 在柱上写数。
 * 柱子默认从 0 长出，可以有负数（净增）；zero=false 只取非零端点量程，越界基线截在边缘并标出断口，轴下写「截断」。
 * 一条虚线标出平均，数写在右侧值轴槽里（DESIGN.md §9.9）。
 * - 柱宽 = 每格的 64%，封顶 24：宽容器里多出来的是间距，不是胖柱子。柱顶圆角 4（柱比 4 矮时跟着变小），贴着 0 的那头是直角。
 * - 颜色：静止时墨色 50%；扫读时当前柱墨色、其余 16%（颜色即时换，不过渡：同列表悬停，§5.1 高频指针）。
 * - 热区是整格（柱子之间的空隙也算），指针在格里任何地方都读这一格。
 * - 读数的数字：换范围时按位滚到新的平均；扫读时直接换（悬停预览这类高频切换不滚）。
 * - 单根柱的状态（status：失败、超额）：只这根换成状态色（danger / warning），柱顶外 4 再加一个 4 的同色圆点（转灰度、色弱时靠形状认出来）；
 *   扫读时它照样跟着「当前墨色、其余变淡」走，圆点留着。读数下面一行图例写出状态名和根数（statusLabels，默认「异常」「注意」），
 *   读屏的 aria-valuetext、隐藏表格、摘要都带上状态名。状态色只表达含义（DESIGN.md §9.9），不拿来区分系列。
 *
 * 动效（DESIGN.md §5.1、§5.2；谁引起 → 用哪条 → 减少动态时）：
 * - 换范围、数据刷新（指针或系统）→ 按 key 对上：留下的柱滑到新位置、变成新宽度；新来的从 0 长出；走掉的缩回 0 再移除；
 *   量程、格线、平均线同拍，smooth（不过冲）；中途再换从当前样子接着走 → 键盘引起、减少动态时直接到位。
 * - 指针扫过、键盘走点 → 柱子换色即时，读数直接换；第一次出现不长柱子（§5.1 滚动进入只给展示组件），加载完成只淡入 200。
 */

type BarStatus = "danger" | "warning"
type BarChartDatum = { key: string; label: string; axisLabel?: string; value: number | null; base?: number; status?: BarStatus }
type Bar = { x: number; w: number; v: number; base: number }
type State = { min: number; max: number; avg: number; ticks: Record<string, number>; bars: Record<string, Bar> }

const MAX_BAR = 24
const STATUS_COLOR: Record<BarStatus, string> = { danger: "var(--color-danger)", warning: "var(--color-warning)" }
const STATUS_LABEL: Record<BarStatus, string> = { danger: "异常", warning: "注意" }
const RADIUS = 4 // 与 --ds-r-mark 同值（SVG 路径要数字）
const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : NaN)

/** 一根柱：从 zero 长到 end（像素），远离 0 的那头两个圆角 */
function barPath(cx: number, w: number, zero: number, end: number) {
  const h = Math.abs(end - zero)
  if (!(w > 0) || !Number.isFinite(h) || h < 0.01) return ""
  const x0 = cx - w / 2
  const x1 = cx + w / 2
  const r = Math.min(RADIUS, w / 2, h)
  const s = end < zero ? 1 : -1
  return `M${x0},${zero}V${end + s * r}Q${x0},${end} ${x0 + r},${end}H${x1 - r}Q${x1},${end} ${x1},${end + s * r}V${zero}Z`
}

function BarChart({
  data,
  label,
  period,
  unit = "",
  height = 192,
  zero = true,
  format: formatProp,
  formatTick = defaultTick,
  average = true,
  averageLabel = "日均",
  readout = true,
  action,
  onActiveChange,
  selectedKey,
  onSelectedKeyChange,
  showValues = false,
  loading = false,
  error,
  onRetry,
  emptyLabel = "这段时间没有数据",
  categoryLabel = "日期",
  statusLabels,
  surface,
  className,
}: {
  data: BarChartDatum[]
  label: string
  period?: string
  unit?: string
  height?: number
  /** false：量程围住非零端点，省略的基线用断口和轴标签标明。 */
  zero?: boolean
  /** 不传时按这一组柱的最大值统一单位与小数位（formatColumn），柱上的数、读数、表格一个格式。 */
  format?: (value: number) => string
  formatTick?: (value: number) => string
  average?: boolean
  averageLabel?: string
  readout?: boolean
  /** 范围切换（7 天 / 30 天）：放在读数行右端，不在图上方另起一行。 */
  action?: React.ReactNode
  onActiveChange?: (index: number | null, datum: BarChartDatum | null) => void
  /** base 是浮动柱起点，value 是变化量；选中保留到下一次选择。 */
  selectedKey?: string
  onSelectedKeyChange?: (key: string) => void
  showValues?: boolean
  loading?: boolean
  error?: React.ReactNode
  onRetry?: () => void
  emptyLabel?: string
  categoryLabel?: string
  /** 状态在图例、读屏里怎么说，例如 { danger: "有失败" } */
  statusLabels?: Partial<Record<BarStatus, string>>
  surface?: "canvas" | "card"
  className?: string
}) {
  const [plotRef, width] = useChartWidth<HTMLDivElement>()
  const n = data.length
  const empty = n === 0
  const rows = Math.max(2, Math.min(4, Math.floor((height - TOP) / 48)))
  const format = React.useMemo(() => formatProp ?? formatColumn(data.map((d) => num(d.value))), [formatProp, data])

  const target = React.useMemo<State>(() => {
    const vals = data.map((d) => num(d.value))
    const finite = vals.filter(Number.isFinite)
    const ends = data.flatMap((d, i) => Number.isFinite(vals[i]) ? [...(zero || d.base ? [d.base ?? 0] : []), (d.base ?? 0) + vals[i]] : [])
    const lo = Math.min(...ends), hi = Math.max(...ends), pad = zero ? 0 : (hi - lo) * 0.1
    const scale = niceScale(lo - pad, hi + pad, rows, zero)
    const avg = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : NaN
    const bars = Object.fromEntries(data.map((d, i) => [d.key, { x: (i + 0.5) / n, w: 1 / n, v: Number.isFinite(vals[i]) ? vals[i] : 0, base: d.base ?? 0 }]))
    const ticks = empty ? { "0": 1 } : Object.fromEntries(scale.ticks.map((t) => [String(t), 1]))
    return { min: scale.min, max: scale.max, avg, ticks, bars }
  }, [data, n, empty, rows, zero])

  const [barEls, bindBar] = useRefMap<SVGPathElement>()
  const [gridEls, bindGrid] = useRefMap<SVGLineElement>()
  const [tickEls, bindTick] = useRefMap<HTMLSpanElement>()
  const [markEls, bindMark] = useRefMap<SVGCircleElement>()
  const [valueEls, bindValue] = useRefMap<HTMLSpanElement>()
  const [breakEls, bindBreak] = useRefMap<SVGPathElement>()
  const avgLine = React.useRef<SVGLineElement>(null)
  const avgText = React.useRef<HTMLSpanElement>(null)

  const paint = (s: State) => {
    if (!width) return
    const y = yScale(s.min, s.max, height)
    const inside = (v: number) => Math.max(s.min, Math.min(s.max, v))
    for (const [k, bar] of Object.entries(s.bars)) {
      const w = Math.min(MAX_BAR, 0.64 * bar.w * width), cx = bar.x * width
      barEls.current.get(k)?.setAttribute("d", barPath(cx, w, y(inside(bar.base)), y(inside(bar.base + bar.v))))
      const cut = !zero && (bar.base < s.min || bar.base > s.max)
      const edge = bar.base < s.min ? height - 6 : TOP + 6
      breakEls.current.get(k)?.setAttribute("d", cut ? `M${cx-w/2},${edge+2}L${cx+w/2},${edge-2}` : "")
      const text = valueEls.current.get(k)
      if (text) text.style.transform = `translate(${bar.x * width}px, ${y(Math.max(bar.base, bar.base + bar.v)) - 8}px) translate(-50%, -100%)`
      // 状态圆点：柱顶外 4（负数柱在柱底外），圆心再让出半径 2
      const mark = markEls.current.get(k)
      if (mark) {
        const end = y(bar.base + bar.v)
        mark.setAttribute("cx", String(bar.x * width))
        mark.setAttribute("cy", String(end <= y(bar.base) ? end - 6 : end + 6))
      }
    }
    const ay = crisp(y(s.avg))
    const showAvg = average && Number.isFinite(ay)
    avgLine.current?.setAttribute("transform", `translate(0 ${showAvg ? ay : -10})`)
    if (avgText.current) avgText.current.style.transform = `translateY(${showAvg ? ay : -10}px) translateY(-50%)`
    // 平均的数和刻度字挨得太近（< 14）时，让刻度字让位
    paintTicks(s.ticks, { min: s.min, max: s.max, height }, gridEls.current, tickEls.current, (at) => empty || (showAvg && Math.abs(at - ay) < 14))
  }
  const mix = (from: State, to: State) => {
    const has = (s: State) => Object.keys(s.bars).length > 0
    if (!has(from) || !has(to)) return null
    const keys = [...new Set([...Object.keys(from.bars), ...Object.keys(to.bars)])]
    const pairs = keys.map((k) => {
      const t = to.bars[k]
      const f = from.bars[k]
      return [k, f ?? { ...t, v: 0 }, t ?? { ...f, v: 0 }] as const
    })
    const tickKeys = [...new Set([...Object.keys(from.ticks), ...Object.keys(to.ticks)])]
    return (t: number): State => ({
      min: lerp(from.min, to.min, t),
      max: lerp(from.max, to.max, t),
      avg: lerp(from.avg, to.avg, t),
      ticks: Object.fromEntries(tickKeys.map((k) => [k, lerp(from.ticks[k] ?? 0, to.ticks[k] ?? 0, t)])),
      bars: Object.fromEntries(pairs.map(([k, a, b]) => [k, { x: lerp(a.x, b.x, t), w: lerp(a.w, b.w, t), v: lerp(a.v, b.v, t), base: lerp(a.base, b.base, t) }])),
    })
  }
  const morph = useMorph(target, mix, paint, (s) => [...Object.keys(s.ticks).map((k) => `t:${k}`), ...Object.keys(s.bars).map((k) => `b:${k}`)])
  React.useLayoutEffect(() => morph.repaint(), [morph.repaint, morph.keys, width, height])
  const tickKeys = morph.keys.filter((k) => k.startsWith("t:")).map((k) => k.slice(2))
  const barKeys = morph.keys.filter((k) => k.startsWith("b:")).map((k) => k.slice(2))

  // 读数：换范围（数据变了）时按位滚；扫读带来的换数直接换
  const [still, setStill] = React.useState(true)
  const [prevData, setPrevData] = React.useState(data)
  if (prevData !== data) {
    setPrevData(data)
    setStill(false)
  }
  const pick = (px: number) => Math.min(n - 1, Math.max(0, Math.floor((px / (width || 1)) * n)))
  const scrub = useScrub(n, pick, (i) => {
    setStill(true)
    onActiveChange?.(i, i === null ? null : data[i])
  })
  const selectable = Boolean(onSelectedKeyChange)
  const selected = data.findIndex(d => d.key === selectedKey)
  const active = scrub.active ?? (selected >= 0 ? { index: selected } : null)
  const at = active ? data[active.index] : null
  const indexOf = new Map(data.map((d, i) => [d.key, i]))
  const statusOf = new Map(data.flatMap((d) => (d.status ? [[d.key, d.status] as const] : [])))
  const nameOf = (st: BarStatus) => statusLabels?.[st] ?? STATUS_LABEL[st]
  // 有状态的柱：静止时状态色；扫读时当前柱照样墨色，其余（含它）变淡——状态柱的淡是状态色压到 35%，圆点留着
  const fill = (k: string) => {
    const st = statusOf.get(k)
    if (!active) return st ? STATUS_COLOR[st] : BAR.rest
    if (indexOf.get(k) === active.index) return BAR.active
    return st ? STATUS_COLOR[st] : BAR.dim
  }
  // 量级并进单位：「12.40 万分钟」不是「12.40 万 分钟」（同 ChartReadout）
  const show = (v: number | null) => (Number.isFinite(num(v)) ? `${format(v as number)}${unit}`.replace(/([万亿]) /, "$1") : "—")
  const withStatus = (d: BarChartDatum) => (d.status ? `${show(d.value)}，${nameOf(d.status)}` : show(d.value))
  const statusCount = (["danger", "warning"] as const).map((st) => [st, data.filter((d) => d.status === st).length] as const).filter(([, c]) => c > 0)
  const avgText2 = Number.isFinite(target.avg) ? show(target.avg) : "—"
  const finite = data.filter((d) => Number.isFinite(num(d.value)))
  const hi = finite.reduce<BarChartDatum | null>((m, d) => (!m || (d.value as number) > (m.value as number) ? d : m), null)
  const lo = finite.reduce<BarChartDatum | null>((m, d) => (!m || (d.value as number) < (m.value as number) ? d : m), null)
  const summary = hi && lo ? `${averageLabel} ${avgText2}，最高 ${hi.label} ${show(hi.value)}，最低 ${lo.label} ${show(lo.value)}${statusCount.map(([st, c]) => `，${c} 个${nameOf(st)}`).join("")}` : emptyLabel
  const fade = useFadeIn<SVGSVGElement>(!empty)
  const dim = useDim(loading && !empty)
  // 换范围后礼貌地念一句新的平均（第一次渲染不念）
  const [said, setSaid] = React.useState("")
  const first = React.useRef(true)
  React.useEffect(() => {
    if (first.current) return void (first.current = false)
    setSaid(empty ? emptyLabel : `${period ?? label}，${averageLabel} ${avgText2}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  return (
    <ChartFigure label={label} surface={surface} busy={loading} data-slot="bar-chart" className={className}>
      {readout ? (
        <ChartReadout
          label={at ? at.label : averageLabel}
          value={at ? num(at.value) : Number.isFinite(target.avg) ? target.avg : null}
          format={format}
          unit={unit}
          sub={at ? `${averageLabel} ${avgText2}` : period}
          still={still}
          action={action}
        />
      ) : null}
      {statusCount.length ? (
        <div data-slot="chart-status-legend" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
          {statusCount.map(([st, c]) => (
            <span key={st} data-status={st} className="inline-flex items-center gap-1.5 tabular-nums">
              <ChartKey color={STATUS_COLOR[st]} bar />
              {`${nameOf(st)} ${c}`}
            </span>
          ))}
        </div>
      ) : null}
      <div className={showValues ? "-m-1 min-w-0 overflow-x-auto p-1 pt-4" : "-m-1 min-w-0 overflow-x-auto p-1"}>
        <div className={selectable ? "pointer-coarse:min-w-(--chart-select-width)" : undefined} style={{ "--chart-select-width": `calc(${n} * var(--ds-h-md) + ${GUTTER}px)` } as React.CSSProperties}>
      <ChartPlot
        height={height}
        plotRef={plotRef}
        plotProps={{ ...scrub.props, ...(selectable ? { role: undefined, tabIndex: undefined, onKeyDown: undefined } : {}), "aria-label": label, "aria-valuetext": at ? `${at.label}：${withStatus(at)}` : summary }}
        gutter={
          <>
            <ChartTicks keys={tickKeys} bind={bindTick} format={formatTick} />
            {average && !empty ? (
              <span ref={avgText} data-slot="chart-average" className="absolute top-0 left-2 text-xs leading-none font-medium whitespace-nowrap text-fg-muted tabular-nums">
                {Number.isFinite(target.avg) ? formatTick(Math.round(target.avg)) : ""}
              </span>
            ) : null}
          </>
        }
        axis={<ChartCategoryAxis labels={data.map((d) => d.axisLabel ?? d.label)} x={(i) => ((i + 0.5) / n) * width} width={width} />}
      >
        <svg ref={fade} aria-hidden className={`absolute inset-0 size-full overflow-visible ${error ? "invisible" : ""} ${dim}`}>
          <ChartGridLines keys={tickKeys} bind={bindGrid} strong={0} />
          {barKeys.map((k) => (
            <path
              key={k}
              ref={bindBar(k)}
              data-slot="chart-bar"
              data-key={k}
              data-status={statusOf.get(k)}
              data-selected={k === selectedKey ? "" : undefined}
              data-active={active && indexOf.get(k) === active.index ? "" : undefined}
              style={{ fill: fill(k), fillOpacity: active && statusOf.has(k) && indexOf.get(k) !== active.index ? 0.35 : undefined }}
            />
          ))}
          {barKeys.filter((k) => statusOf.has(k)).map((k) => (
            <circle key={k} ref={bindMark(k)} data-slot="chart-bar-mark" data-key={k} r={2} style={{ fill: STATUS_COLOR[statusOf.get(k)!] }} />
          ))}
          {!zero ? barKeys.map(k => <path key={k} ref={bindBreak(k)} data-slot="chart-bar-break" data-key={k} fill="none" stroke="var(--chart-surface)" strokeWidth={3} />) : null}
          {average && !empty ? <line ref={avgLine} data-slot="chart-average-line" x1={0} x2="100%" y1={0} y2={0} strokeDasharray="2 3" strokeWidth={1} shapeRendering="crispEdges" className="stroke-fg-muted" /> : null}
        </svg>
        <ChartStatus loading={loading} empty={empty} error={error} emptyLabel={emptyLabel} onRetry={onRetry} />
        {/* 显示时继承父级 visibility，禁止隐藏示例里的读数穿透。 */}
        {showValues ? data.map(d => <span key={d.key} ref={bindValue(d.key)} data-slot="chart-bar-value" aria-hidden style={{ visibility: width / n >= 72 || selectedKey === d.key ? undefined : "hidden" }} className="pointer-events-none absolute top-0 left-0 text-xs tabular-nums text-fg-muted whitespace-nowrap">{show(d.value)}</span>) : null}
        {selectable ? <RadioPrimitive.Root value={selectedKey} onValueChange={onSelectedKeyChange} aria-label={label} orientation="horizontal" className="absolute inset-0 flex">
          {data.map(d => <RadioPrimitive.Item key={d.key} value={d.key} data-slot="chart-bar-select" data-value={d.key} aria-label={`${d.label}：${withStatus(d)}`} className="my-1 min-w-0 flex-1 rounded-control outline-none focus-visible:focus-ring" />)}
        </RadioPrimitive.Root> : null}
      </ChartPlot>
        </div>
      </div>
      <ChartTable caption={period ? `${label}，${period}` : label} head={[categoryLabel, label]} rows={data.map((d) => [d.label, withStatus(d)])} />
      {!zero && !empty && (target.min > 0 || target.max < 0) ? <span className="sr-only">值轴已截断，从 {formatTick(target.min)} 到 {formatTick(target.max)}；柱长不代表与零的距离</span> : null}
      <span className="sr-only" aria-live="polite">
        {loading ? "正在加载" : said}
      </span>
    </ChartFigure>
  )
}

export { BarChart }
export type { BarChartDatum, BarStatus }
