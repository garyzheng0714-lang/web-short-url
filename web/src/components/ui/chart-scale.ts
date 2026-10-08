import { nice, ticks } from "d3-array"

/**
 * 图表的数字、颜色、刻度与线形（纯函数，和 chart 一起装；视觉规则草案 docs/研究/图表.md）。
 * - 数字：读数与提示 10 万以下千分位（9,312），以上万 / 亿（12.35 万：数字与万、亿之间一个半角空格，DESIGN.md §6）；刻度万 / 亿、至多一位小数；
 *   百分比固定一位小数（58.0%、13.4%：同组字宽不跳）；负号一律是减号「−」（U+2212，和数字等宽等高，不是连字符）。
 *   并排的一组数（漏斗各级、小多图、表格一列）用 formatColumn(values)：按这一组的最大值统一单位与小数位（DESIGN.md §4.6），不逐个切换。
 * - 颜色：第一个系列墨色，之后墨色递减；accent 至多给一个系列；字永远是墨色三档，系列色只在线、柱、色键上。
 *   柱：静止时墨色 50%（对白底约 3.3:1，过图形 3:1），扫读时当前柱墨色、其余 16%。
 * - 刻度：整步长（1 / 2 / 5 × 10ⁿ），至多 rows 行；计数类从 0 起。
 * - 线形：单调三次曲线取样（不越过数据点），每个数据点本身一定在取样里（峰值画在真实高度）。
 */

const grouped = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 })
const compact = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 })
const compactFine = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 })
const percent = new Intl.NumberFormat("zh-CN", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 })

// Intl 的 zh-CN 紧凑写法是「12.35万」：数字紧贴汉字，按中文排版补一个半角空格
const spaced = (s: string) => s.replace(/(\d)([万亿])/, "$1 $2")
// Intl 的负号是 ASCII 连字符：短、偏高，像分隔符；换成排版用的减号
const minus = (s: string) => s.replace(/^-/, "\u2212")
/** 读数、提示、表格：10 万以下千分位，以上万 / 亿（两位小数） */
const formatNumber = (v: number) => minus(Math.abs(v) >= 1e5 ? spaced(compactFine.format(v)) : grouped.format(v))
/** 刻度：万 / 亿，至多一位小数 */
const formatTick = (v: number) => minus(spaced(compact.format(v)))
/** 0.184 → 18.4%（固定一位小数） */
const formatPercent = (v: number) => minus(percent.format(v))

/**
 * 数字接单位：以「万 / 亿」结尾、单位是汉字时，量级和单位连成一个词，去掉单位前的空格（12.35 万人，不是 12.35 万 人）；
 * 单位是西文（GB、ms）照中西文之间留空格（18.4 万 GB）；其余照原样拼（9,312 人、120 ms）。提示、图例、读屏句、隐藏表格里「数 + 单位」一律用它。
 */
const joinScale = (scale: string, unit: string) => (/^\s*[\u3400-\u9fff]/.test(unit) ? `${scale}${unit.trimStart()}` : `${scale}${unit}`)
const withUnit = (text: string, unit = "") => (/[万亿]$/.test(text) ? joinScale(text, unit) : `${text}${unit}`)

/**
 * 大数字 + 小字单位（读数、环形图圆心）：以「万 / 亿」结尾时把万、亿挪进后面的小字单位（4,164 + 「万次」），
 * 量级和单位不拆成一大一小。返回 [大字, 小字]。
 */
function splitScale(text: string, unit = ""): [string, string] {
  const m = /^(.*\d)\s?([万亿])$/.exec(text)
  return m ? [m[1], joinScale(m[2], unit)] : [text, unit]
}

/**
 * 一组并排的数（漏斗各级、小多图、表格一列）共用的格式：按绝对值最大的那个定单位（10 万起万、1 亿起亿），
 * 小数位取这一组里需要的最多位（万 / 亿至多 2 位，个位至多 1 位），每个数都用同样的位数：10.00 万、6.12 万，不会一个「10 万」一个「61,170」。
 */
function formatColumn(values: number[]) {
  const finite = values.filter(Number.isFinite)
  const max = Math.max(0, ...finite.map(Math.abs))
  const [div, unit, most] = max >= 1e8 ? [1e8, " 亿", 2] : max >= 1e5 ? [1e4, " 万", 2] : [1, "", 1]
  const need = (v: number) => {
    for (let d = 0; d < most; d++) if (Math.abs(Math.round((v / div) * 10 ** d) - (v / div) * 10 ** d) < 1e-6) return d
    return most
  }
  const digits = Math.max(0, ...finite.map(need))
  const f = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return (v: number) => minus(f.format(v / div)) + unit
}

/** 系列色：墨色 100% / 66% / 48%，第四个起不再造颜色（超过 3 条请拆成几张小图）；tone="accent" 给唯一要强调的那条 */
// 系列色、柱色都是设计变量（ds-tokens.css 的 --ds-chart-*，DESIGN.md §9.9）
const INK = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)"]
const seriesColor = (index: number, tone?: "accent") => (tone === "accent" ? "var(--color-accent)" : INK[Math.min(index, INK.length - 1)])

/** 整步长的量程：至多 rows 行；zero 时包含 0（计数、金额）。lo = hi 时上下各让一步，不除零 */
function niceScale(lo: number, hi: number, rows = 4, zero = true) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1, ticks: [0, 1] }
  if (zero) [lo, hi] = [Math.min(0, lo), Math.max(0, hi)]
  if (lo === hi) [lo, hi] = lo === 0 ? [0, 1] : [lo - Math.abs(lo) / 2, hi + Math.abs(hi) / 2]
  for (let count = rows; count >= 1; count--) {
    const [min, max] = nice(lo, hi, count)
    const t = ticks(min, max, count)
    if (t.length - 1 <= rows) return { min, max, ticks: t }
  }
  return { min: lo, max: hi, ticks: [lo, hi] }
}

/**
 * 一条线的形状：在 0–1 的 x 上取样（均匀 160 段 + 每个数据点本身，峰值一定画在真实高度上），缺失值是 NaN（断开）。
 * smooth 用单调三次曲线（与 d3 的 curveMonotoneX 同一组切线，Steffen 1990）：曲线不会越过相邻两个数据点，正数不会画到 0 下面。
 */
type Shape = { xs: number[]; ys: number[] }
const GRID = Array.from({ length: 161 }, (_, i) => i / 160)

function shapeOf(values: number[], smooth = true): Shape {
  const n = values.length
  if (n === 0) return { xs: [], ys: [] }
  if (n === 1) return { xs: [0, 1], ys: [values[0], values[0]] }
  const px = values.map((_, i) => i / (n - 1))
  const slope = (i: number) => (values[i + 1] - values[i]) * (n - 1)
  const tangent = values.map((_, i) => {
    if (i === 0 || i === n - 1) return NaN
    const s0 = slope(i - 1), s1 = slope(i)
    return (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.25 * Math.abs(s0 + s1)) || 0
  })
  tangent[0] = n > 2 ? (3 * slope(0) - tangent[1]) / 2 : slope(0)
  tangent[n - 1] = n > 2 ? (3 * slope(n - 2) - tangent[n - 2]) / 2 : slope(0)
  const xs = [...new Set([...GRID, ...px])].sort((a, b) => a - b)
  const ys = xs.map((x) => {
    const i = Math.min(n - 2, Math.floor(x * (n - 1)))
    const u = x * (n - 1) - i, y0 = values[i], y1 = values[i + 1]
    if (!smooth || u === 0 || u === 1) return u === 1 ? y1 : u === 0 ? y0 : y0 + (y1 - y0) * u
    const h = 1 / (n - 1), u2 = u * u, u3 = u2 * u
    const y = (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * h * tangent[i] + (3 * u2 - 2 * u3) * y1 + (u3 - u2) * h * tangent[i + 1]
    return Math.min(Math.max(y, Math.min(y0, y1)), Math.max(y0, y1))
  })
  return { xs, ys }
}

/** 形状在 x 处的值（取样点之间直线插值） */
function valueAt({ xs, ys }: Shape, x: number) {
  if (!xs.length) return NaN
  let lo = 0, hi = xs.length - 1
  if (x <= xs[0]) return ys[0]
  if (x >= xs[hi]) return ys[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] < x) lo = mid
    else hi = mid
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo] || 1)
  return ys[lo] + (ys[hi] - ys[lo]) * t
}

/** 两个形状放到同一组 x 上（形变的起点和终点逐点对应）；一边是空的就压在 flat 上 */
function alignShapes(a: Shape, b: Shape, flat: [number, number]) {
  const xs = [...new Set([...a.xs, ...b.xs])].sort((p, q) => p - q)
  const on = (s: Shape, f: number) => (s.xs.length ? xs.map((x) => valueAt(s, x)) : xs.map(() => f))
  return { xs, from: on(a, flat[0]), to: on(b, flat[1]) }
}

const lerp = (a: number, b: number, t: number) => (Number.isNaN(a) ? b : Number.isNaN(b) ? a : a + (b - a) * t)

/** 柱：静止 · 扫读时的当前柱 · 扫读时的其余柱 */
const BAR = { rest: "var(--color-chart-bar)", active: "var(--color-chart-1)", dim: "var(--color-chart-bar-dim)" }

/**
 * 部分与整体（环形、华夫、河流、树图）的「部分」：浅蓝（chart-bar）· 两档墨色 · 「其他」（chart-bar-dim）。超过 4 部分不造颜色：foldParts 把最小的并成「其他」。
 * 部分是大面积，静止时第一份也不用 100% 实色（DESIGN.md §4.6）：accent 100% 只留给「被指着的那一份」（BAR.active），不和图例里的第一类撞色。
 * partFill：图形和图例色键都用它——没有指向时是各自的部分色，指着自己是 BAR.active，其余 BAR.dim；颜色和图例永远对得上。
 */
const PARTS = ["var(--color-chart-bar)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-bar-dim)"]
const partColor = (index: number) => PARTS[Math.min(index, PARTS.length - 1)]
const partFill = (index: number, activeIndex: number | null | undefined) =>
  activeIndex == null || activeIndex < 0 ? partColor(index) : index === activeIndex ? BAR.active : BAR.dim
const OTHER = "__other"

type Part = { key: string; label: string; value: number; members?: string[] }

/** 超过 max 个部分：留下最大的 max − 1 个（保持原来的顺序），其余并成一个「其他」放最后，成员名单写进 members */
function foldParts<T extends Part>(parts: T[], max = 4, otherLabel = "其他"): Part[] {
  if (parts.length <= max) return parts
  const keep = new Set([...parts].sort((a, b) => b.value - a.value).slice(0, max - 1).map((p) => p.key))
  const rest = parts.filter((p) => !keep.has(p.key))
  return [
    ...parts.filter((p) => keep.has(p.key)),
    { key: OTHER, label: otherLabel, value: rest.reduce((a, p) => a + p.value, 0), members: rest.map((p) => p.label) },
  ]
}

/** 按比例分整数（最大余数法）：份额相加一定等于 total（占比 100%、华夫 100 格），不会因为四舍五入多一格少一格 */
function apportion(values: number[], total = 100) {
  const sum = values.reduce((a, v) => a + Math.max(0, v), 0)
  if (!(sum > 0)) return values.map(() => 0)
  const raw = values.map((v) => (Math.max(0, v) / sum) * total)
  const out = raw.map(Math.floor)
  let left = total - out.reduce((a, v) => a + v, 0)
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0])
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k][1]]++
  return out
}

/**
 * 标签避让：ys 是每个标签想放的位置（中线），拉开到至少相隔 gap、落在 [lo, hi] 里，次序不变。
 * 挤在一起的几个标签成一组，以它们想放的位置的平均为中心整体往两边推（引线短、上下对称）；组与组碰上就合并再算；放不下时均分。
 */
function spreadLabels(ys: number[], gap: number, lo: number, hi: number) {
  const order = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const n = order.length
  if (!n) return []
  if ((n - 1) * gap > hi - lo) return ys.map((_, i) => lo + ((hi - lo) * order.findIndex((o) => o[1] === i)) / Math.max(1, n - 1))
  const want = order.map(([y]) => y)
  // 一组：从第 from 个起 count 个，第一个的中线在 top
  const place = (from: number, count: number) => {
    let mean = 0
    for (let k = from; k < from + count; k++) mean += want[k] - (k - from) * gap
    return Math.min(Math.max(mean / count, lo), hi - (count - 1) * gap)
  }
  const groups: { from: number; count: number; top: number }[] = []
  for (let k = 0; k < n; k++) {
    groups.push({ from: k, count: 1, top: place(k, 1) })
    while (groups.length > 1) {
      const [a, b] = groups.slice(-2)
      if (a.top + a.count * gap <= b.top) break
      groups.splice(-2, 2, { from: a.from, count: a.count + b.count, top: place(a.from, a.count + b.count) })
    }
  }
  const out = new Array<number>(n)
  for (const g of groups) for (let k = 0; k < g.count; k++) out[order[g.from + k][1]] = g.top + k * gap
  return out
}

/**
 * 时间轴刻度（刷子图这类长时间序列）：在 [start, end]（UTC 毫秒）里按宽度挑最细的一档——天、2 天、周（周一）、2 周、月、季度、半年、年——
 * 让刻度至多每 72px 一个；刻度落在整点上（月初、年初、周一）。不用 d3-scale 的 scaleUtc（7.9 KB 起），只要这一个函数。
 */
const DAY_MS = 86400000
type TimeTick = { t: number; label: string }
function timeTicks(start: number, end: number, width: number): TimeTick[] {
  if (!(end > start) || !(width > 0)) return []
  const room = Math.max(2, Math.floor(width / 72))
  const d = (t: number) => new Date(t)
  const day = (t: number) => `${d(t).getUTCMonth() + 1} 月 ${d(t).getUTCDate()} 日`
  const month = (t: number) => (d(t).getUTCMonth() === 0 ? `${d(t).getUTCFullYear()} 年` : `${d(t).getUTCMonth() + 1} 月`)
  const first = Math.ceil(start / DAY_MS) * DAY_MS
  // 按天：1、2 天从第一个整天起；1、2 周从第一个周一起
  for (const n of [1, 2, 7, 14]) {
    if ((end - start) / (n * DAY_MS) > room + 1) continue
    let t = n < 7 ? first : first + ((8 - d(first).getUTCDay()) % 7) * DAY_MS
    const out: TimeTick[] = []
    for (; t <= end; t += n * DAY_MS) out.push({ t, label: day(t) })
    if (out.length <= room) return out
  }
  // 按月：落在月初；季度、半年、年落在 1 / 4 / 7 / 10 月、1 / 7 月、1 月
  for (const n of [1, 3, 6, 12]) {
    const x = d(first)
    let m = x.getUTCFullYear() * 12 + x.getUTCMonth() + (x.getUTCDate() > 1 ? 1 : 0)
    m = Math.ceil(m / n) * n
    const out: TimeTick[] = []
    for (let t = Date.UTC(Math.floor(m / 12), m % 12, 1); t <= end; m += n, t = Date.UTC(Math.floor(m / 12), m % 12, 1))
      out.push({ t, label: n === 12 ? `${d(t).getUTCFullYear()} 年` : month(t) })
    if (out.length <= room) return out
  }
  return [{ t: first, label: `${d(first).getUTCFullYear()} 年` }]
}

export { alignShapes, apportion, BAR, foldParts, formatColumn, formatNumber, formatPercent, formatTick, lerp, niceScale, OTHER, partColor, partFill, PARTS, seriesColor, shapeOf, splitScale, spreadLabels, timeTicks, valueAt, withUnit }
export type { Part, Shape, TimeTick }
