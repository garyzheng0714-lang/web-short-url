"use client"

import * as React from "react"
import { arc as d3arc } from "d3-shape"

import { cn } from "@/lib/utils"
import { ChartFigure, ChartHeading, ChartKey, ChartStatus, RollingValue, useChartWidth, useDim, useFadeIn, useFitText, useMorph, useRefMap, useScrub } from "@/components/ui/chart"
import { ChartTable } from "@/components/ui/chart-table"
import { apportion, foldParts, formatNumber, lerp, partFill, splitScale, type Part, withUnit } from "@/components/ui/chart-scale"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { usePressScale } from "@/components/ui/stretch"

/**
 * 环形图：一个整体分成几份（流量来源、费用构成、存储按类型），合计和其中一份最要紧。中间是读数（合计 → 指到的那一份的值与占比），
 * 旁边（容器 ≥ 460）或下面是图例：色键 · 名字 · 值 · 占比，每行是开关按钮（隐藏 / 显示这一份）。
 * - 图名和范围切换（action）是图例上面的一行（ChartHeading），名字和图例的色键在同一条列线上；容器 < 460 时这一行在环的上面。
 * - 颜色：前三份墨色三档，第四份起不造颜色——超过 4 份时最小的几份并成「其他」（chart-bar-dim），成员写在图例、表格里（DESIGN.md §9.9）。
 * - 段与段之间 2px 底色缝（两边平行，内外一样宽），段的四角圆角 4（--ds-r-mark）；只剩一段时缝合上，是一整圈。
 * - 整圈按角度命中：缝隙也算前后的段，环心是「合计」。指到一份：它墨色、其余降到 16%（即时换色，同柱状图）。
 * - 占比用最大余数法分到 0.1%，相加一定是 100%。
 *
 * 动效（DESIGN.md §5.1、§5.2；谁引起 → 用哪条 → 减少动态时）：
 * - 换数据集、数据刷新（指针或系统）→ 每一份的起止角从屏幕上此刻的位置走到新位置，smooth（不过冲）；按 key 对上，新来的从相邻的缝里长出、
 *   走掉的缩回缝里；中途再换从当前角度接着走 → 键盘引起、减少动态时直接到位。
 * - 图例关掉一份（指针）→ 它缩成 0、其余补位，同上；合计按位滚 → 键盘 0ms。按压 0.97、颜色 150。
 * - 指针扫过、键盘走段 → 换色即时，中间的读数直接换（不滚）；第一次出现不扫开（§5.1），加载完成只淡入 200。
 */

type DonutChartDatum = { key: string; label: string; value: number }
type Arc = { a0: number; a1: number }
type State = { order: string[]; arcs: Record<string, Arc> }

const GAP = 2
const RADIUS = 4 // 与 --ds-r-mark 同值（SVG 路径要数字）
const TAU = Math.PI * 2
/** 环心大数字的三档（text-2xl / xl / lg，像素与类一一对应） */
const CENTER_SIZES = [30, 24, 20]
const CENTER_TEXT = ["text-2xl", "text-xl", "text-lg"]

/** 按顺序把可见的份额排成一圈（以「圈」为单位，0 在正上方、顺时针）；隐藏的份额宽度为 0，留在原来的位置 */
function layout(parts: Part[], hidden: Set<string>): State {
  const total = parts.reduce((a, p) => a + (hidden.has(p.key) ? 0 : Math.max(0, p.value)), 0)
  let at = 0
  const arcs: Record<string, Arc> = {}
  for (const p of parts) {
    const w = total > 0 && !hidden.has(p.key) ? Math.max(0, p.value) / total : 0
    arcs[p.key] = { a0: at, a1: at + w }
    at += w
  }
  return { order: parts.map((p) => p.key), arcs }
}

/** 一边没有的 key：在另一边紧挨着它前一个还在的份额的终点处，宽度为 0（新来的从缝里长出，走掉的缩回缝里） */
function seat(state: State, order: string[], key: string) {
  const i = order.indexOf(key)
  for (let j = i - 1; j >= 0; j--) {
    const prev = state.arcs[order[j]]
    if (prev) return { a0: prev.a1, a1: prev.a1 }
  }
  return { a0: 0, a1: 0 }
}

function LegendRow({
  part,
  color,
  shown,
  active,
  share,
  value,
  onToggle,
  onPreview,
}: {
  part: Part
  color: string
  shown: boolean
  active: boolean
  share: string
  value: string
  onToggle: () => void
  onPreview: (on: boolean) => void
}) {
  const { node, press, release } = usePressScale<HTMLButtonElement>(0.97)
  return (
    <button
      ref={node}
      type="button"
      aria-pressed={shown}
      aria-label={`${part.label}${part.members ? `（${part.members.join("、")}）` : ""}，${value}，${share}`}
      data-slot="donut-legend-item"
      data-key={part.key}
      data-active={active || undefined}
      onClick={onToggle}
      onPointerDown={press}
      onPointerUp={release}
      onPointerLeave={(e) => {
        release()
        if (e.pointerType !== "touch") onPreview(false)
      }}
      onPointerCancel={release}
      onPointerEnter={(e) => e.pointerType !== "touch" && onPreview(true)}
      onFocus={() => onPreview(true)}
      onBlur={() => onPreview(false)}
      className={cn(
        "group/legend flex min-h-(--ds-h-md) w-full min-w-0 items-center gap-3 rounded-sm px-2 py-1 text-left text-sm outline-none select-none",
        "transition-colors duration-(--ds-dur-fast) ease-ds hover:bg-hover data-[active]:bg-hover focus-visible:focus-ring-out focus-visible:transition-none"
      )}
    >
      <span className={cn("inline-flex transition-opacity duration-(--ds-dur-fast) ease-ds group-focus-visible/legend:transition-none", !shown && "opacity-30")}>
        <ChartKey color={color} bar />
      </span>
      <span className="grid min-w-0 flex-1">
        <span data-slot="donut-legend-name" className={cn("truncate", shown ? "text-fg" : "text-fg-muted")}>{part.label}</span>
        {part.members ? <span data-slot="donut-legend-members" className="text-xs text-pretty text-fg-muted">{part.members.join("、")}</span> : null}
      </span>
      <span className="text-fg-muted tabular-nums">{value}</span>
      <span className={cn("w-14 text-right font-medium tabular-nums", shown ? "text-fg" : "text-fg-muted")}>{share}</span>
    </button>
  )
}

function DonutChart({
  data,
  label,
  period,
  unit = "",
  format = formatNumber,
  totalLabel = "合计",
  otherLabel = "其他",
  size = 208,
  thickness = 24,
  hiddenKeys,
  defaultHiddenKeys = [],
  onHiddenKeysChange,
  onActiveChange,
  legend = true,
  loading = false,
  error,
  onRetry,
  emptyLabel = "暂无数据",
  surface,
  action,
  className,
}: {
  data: DonutChartDatum[]
  label: string
  period?: string
  unit?: string
  format?: (value: number) => string
  totalLabel?: string
  otherLabel?: string
  size?: number
  thickness?: number
  hiddenKeys?: string[]
  defaultHiddenKeys?: string[]
  onHiddenKeysChange?: (hidden: string[]) => void
  onActiveChange?: (key: string | null) => void
  legend?: boolean
  loading?: boolean
  error?: React.ReactNode
  onRetry?: () => void
  emptyLabel?: string
  surface?: "canvas" | "card"
  /** 这张图的范围切换（时段、城市）：放在图名那一行右端 */
  action?: React.ReactNode
  className?: string
}) {
  const [innerHidden, setInnerHidden] = React.useState(defaultHiddenKeys)
  const hiddenList = hiddenKeys ?? innerHidden
  const parts = React.useMemo(() => foldParts(data.filter((d) => d.value > 0), 4, otherLabel), [data, otherLabel])
  const hidden = React.useMemo(() => new Set(hiddenList.filter((k) => parts.some((p) => p.key === k))), [hiddenList, parts])
  const visible = parts.filter((p) => !hidden.has(p.key))
  const empty = visible.length === 0
  const total = visible.reduce((a, p) => a + p.value, 0)
  const permille = apportion(visible.map((p) => p.value), 1000)
  const shareOf = (key: string) => {
    const i = visible.findIndex((p) => p.key === key)
    return i < 0 ? "—" : `${(permille[i] / 10).toFixed(1)}%`
  }
  const show = (v: number) => withUnit(format(v), unit)
  const [said, setSaid] = React.useState("")
  // 图例开关：至少留一份；礼貌地念一句新的合计
  const toggle = (part: Part) => {
    const shown = !hidden.has(part.key)
    if (shown && visible.length === 1) return
    const next = shown ? [...hidden, part.key] : [...hidden].filter((k) => k !== part.key)
    if (hiddenKeys === undefined) setInnerHidden(next)
    onHiddenKeysChange?.(next)
    const left = parts.filter((p) => !next.includes(p.key)).reduce((a, p) => a + p.value, 0)
    setSaid(`${shown ? "隐藏" : "显示"} ${part.label}，${totalLabel} ${show(left)}`)
  }

  const [boxRef, width] = useChartWidth<HTMLDivElement>()
  const s = Math.max(0, Math.min(width, size))
  const R = s / 2
  const r = Math.max(0, R - thickness)

  const target = React.useMemo(() => layout(parts, hidden), [parts, hidden])
  const [paths, bindPath] = useRefMap<SVGPathElement>()
  const geo = React.useRef({ R, r })
  geo.current = { R, r }
  const paint = (st: State) => {
    const { R, r } = geo.current
    const live = st.order.filter((k) => st.arcs[k].a1 - st.arcs[k].a0 > 1e-4)
    const lone = live.length === 1
    const arc = d3arc<Arc>()
      .innerRadius(r)
      .outerRadius(R)
      .startAngle((a) => a.a0 * TAU)
      .endAngle((a) => a.a1 * TAU)
      .padAngle(lone ? 0 : GAP / Math.max(1, R))
      .padRadius(R)
      .cornerRadius(lone ? 0 : RADIUS)
    for (const k of st.order) {
      const a = st.arcs[k]
      paths.current.get(k)?.setAttribute("d", R > 0 && a.a1 - a.a0 > 1e-4 ? (arc(a) ?? "") : "")
    }
  }
  const mix = (from: State, to: State) => {
    if (!from.order.length || !to.order.length) return null
    const order = [...to.order, ...from.order.filter((k) => !to.arcs[k])]
    const pairs = order.map((k) => [k, from.arcs[k] ?? seat(from, to.order, k), to.arcs[k] ?? seat(to, from.order, k)] as const)
    return (t: number): State => ({
      order,
      arcs: Object.fromEntries(pairs.map(([k, a, b]) => [k, { a0: lerp(a.a0, b.a0, t), a1: lerp(a.a1, b.a1, t) }])),
    })
  }
  const morph = useMorph(target, mix, paint, (st) => st.order)
  React.useLayoutEffect(() => morph.repaint(), [morph.repaint, morph.keys, R, r])

  // 指到哪一份：整圈按角度命中（缝隙算前后的段），环心与环外是「没有」
  // 图例行悬停预览：记 key 不记序号——点这一行把它藏起来后，序号会指到下一份上（2026-10-04 复查：环心显示成「直接访问」）
  const [preview, setPreview] = React.useState<string | null>(null)
  const pick = (x: number, y: number) => {
    const dx = x - R
    const dy = y - R
    const d = Math.hypot(dx, dy)
    if (d < r - 4 || d > R + 8) return null
    const turn = (((Math.atan2(dx, -dy) / TAU) % 1) + 1) % 1
    const i = visible.findIndex((p) => turn >= target.arcs[p.key].a0 && turn < target.arcs[p.key].a1)
    return i < 0 ? null : i
  }
  // 键盘从没指到时：→ / ↑ 从正上方顺时针第一份起，← / ↓ 从最后一份起（时间序列的「从最新起」不适用于环）
  const enter = (key: string, from: number | undefined, count: number) =>
    from !== undefined ? undefined : key === "ArrowRight" || key === "ArrowUp" ? 0 : key === "ArrowLeft" || key === "ArrowDown" ? count - 1 : undefined
  const scrub = useScrub(visible.length, pick, (i) => onActiveChange?.(i === null ? null : visible[i].key), enter)
  const previewIndex = preview === null ? -1 : visible.findIndex((v) => v.key === preview)
  const activeIndex = scrub.active?.index ?? (previewIndex >= 0 ? previewIndex : null)
  const activePart = activeIndex === null ? null : (visible[activeIndex] ?? null)
  // 环和图例的色键同一个来源（partFill，按 parts 的序号）：指着一份时图例也跟着「当前墨色、其余变淡」，永远对得上
  const activeAt = activePart ? parts.findIndex((p) => p.key === activePart.key) : null

  // 中间的读数：数据变了（换数据集、隐藏一份）按位滚；扫读带来的换数直接换
  const [still, setStill] = React.useState(true)
  const [prevTotal, setPrevTotal] = React.useState(total)
  const [dir, setDir] = React.useState(1)
  if (prevTotal !== total) {
    setPrevTotal(total)
    setStill(false)
    setDir(total >= prevTotal ? 1 : -1)
  }
  React.useEffect(() => {
    if (activePart) setStill(true)
  }, [activePart])
  const centerValue = activePart ? activePart.value : total
  // 圆心是大数字 + 小字单位：「12.35 万」的万并进单位（12.35 + 「万次」），和读数一个规矩
  const [centerText, centerUnit] = empty ? ["—", unit] : splitScale(format(centerValue), unit)
  // 环心的数放不下（小环、¥79,200 这种长数）就降一档：30 → 24 → 20；按合计算，扫读时字号不跳
  const [valueRef, valueStep] = useFitText<HTMLSpanElement>(CENTER_SIZES, 2 * r - 24, empty ? "—" : format(total))
  const summary = empty ? emptyLabel : `${totalLabel} ${show(total)}，${visible.map((p) => `${p.label} ${shareOf(p.key)}`).join("，")}`
  const fade = useFadeIn<SVGSVGElement>(!empty)
  const dim = useDim(loading && !empty)

  return (
    <ChartFigure label={period ? `${label}，${period}` : label} surface={surface} busy={loading} data-slot="donut-chart" className={className}>
      {/* 容器查询只能作用在 figure 里面：环与图例的版式放在这一层 */}
      {/* 窄：图名、环、图例从上往下；宽：环占左列整高，图名 + 图例在右列竖向居中（上下两行 1fr 撑开）。DOM 顺序就是读和 Tab 的顺序 */}
      <div data-slot="donut-body" className="grid min-w-0 items-center gap-6 @min-[460px]/chart:grid-cols-[auto_minmax(0,1fr)] @min-[460px]/chart:grid-rows-[1fr_auto_auto_1fr] @min-[460px]/chart:gap-y-0">
        <div className="min-w-0 @min-[460px]/chart:col-start-2 @min-[460px]/chart:row-start-2 @min-[460px]/chart:pb-4">
          <ChartHeading label={label} action={action} />
        </div>
        <div ref={boxRef} className="mx-auto w-full min-w-0 @min-[460px]/chart:col-start-1 @min-[460px]/chart:row-span-4 @min-[460px]/chart:row-start-1 @min-[460px]/chart:w-(--donut-size)" style={{ maxWidth: size, ["--donut-size" as string]: `${size}px` }}>
          <div
            {...scrub.props}
            aria-label={label}
            aria-valuetext={activePart ? `${activePart.label}：${show(activePart.value)}，${shareOf(activePart.key)}` : summary}
            data-slot="chart-plot"
            className="relative mx-auto touch-pan-y rounded-full outline-none select-none [-webkit-tap-highlight-color:transparent] focus-visible:focus-ring-zone"
            style={{ width: s, height: s }}
          >
            <svg ref={fade} aria-hidden className={cn("absolute inset-0 size-full overflow-visible", error && "invisible", dim)}>
              {/* 空的时候留一圈轨道：图的位置不塌 */}
              {empty ? <circle cx={R} cy={R} r={Math.max(0, R - thickness / 2)} fill="none" strokeWidth={thickness} className="stroke-line" /> : null}
              <g transform={`translate(${R} ${R})`}>
                {morph.keys.map((k) => {
                  const i = parts.findIndex((p) => p.key === k)
                  return (
                    <path
                      key={k}
                      ref={bindPath(k)}
                      data-slot="donut-segment"
                      data-key={k}
                      data-active={activePart?.key === k || undefined}
                      style={{ fill: partFill(Math.max(0, i), activeAt) }}
                    />
                  )
                })}
              </g>
            </svg>
            <div
              aria-hidden
              className={cn("pointer-events-none absolute inset-0 grid place-content-center justify-items-center gap-0.5 text-center", (error || empty) && "invisible", dim)}
            >
              <span data-slot="donut-center-label" className="max-w-28 truncate text-xs text-fg-muted">
                {activePart ? activePart.label : totalLabel}
              </span>
              <span ref={valueRef} className={cn("flex items-baseline gap-0.5 font-semibold text-fg tabular-nums", CENTER_TEXT[valueStep])}>
                <RollingValue slot="donut-center-value" text={centerText} dir={dir} still={still || Boolean(activePart) || fromKeyboard()} />
                {centerUnit ? <span className="text-sm font-normal text-fg-muted">{centerUnit}</span> : null}
              </span>
              <span data-slot="donut-center-sub" className="text-xs text-fg-muted tabular-nums">
                {activePart ? shareOf(activePart.key) : (period ?? "")}
              </span>
            </div>
            <div
              className="absolute"
              style={{
                left: R - r * 0.75,
                top: R - r * 0.5,
                width: r * 1.5,
                height: r,
              }}
            >
              <ChartStatus loading={loading} empty={empty} error={error} emptyLabel={emptyLabel} onRetry={onRetry} />
            </div>
          </div>
        </div>
        {legend && parts.length ? (
          <div role="group" aria-label="份额" data-slot="donut-legend" className="-mx-2 grid min-w-0 content-center gap-0.5 @min-[460px]/chart:col-start-2 @min-[460px]/chart:row-start-3">
            {parts.map((p, i) => {
              const shown = !hidden.has(p.key)
              return (
                <LegendRow
                  key={p.key}
                  part={p}
                  color={partFill(i, activeAt)}
                  shown={shown}
                  active={activePart?.key === p.key}
                  share={shareOf(p.key)}
                  value={show(p.value)}
                  onToggle={() => toggle(p)}
                  onPreview={(on) => setPreview(on ? p.key : null)}
                />
              )
            })}
          </div>
        ) : null}
      </div>
      <ChartTable
        caption={period ? `${label}，${period}` : label}
        head={["名称", "数值", "占比"]}
        rows={parts.map((p) => [`${p.label}${p.members ? `（${p.members.join("、")}）` : ""}`, show(p.value), hidden.has(p.key) ? "已隐藏" : shareOf(p.key)])}
      />
      <span className="sr-only" aria-live="polite">
        {loading ? "正在加载" : said}
      </span>
    </ChartFigure>
  )
}

export { DonutChart }
export type { DonutChartDatum }
