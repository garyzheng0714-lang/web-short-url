type Pt = { x: number; y: number }
type Track = {
  /** SVG path 的 d */
  d: string
  /** 全长（px） */
  length: number
  /** 弧长比例 u（0–1）处的点 */
  at: (u: number) => Pt
  /** 从 u0 到 u1 的一小段（拖尾），折线 d */
  slice: (u0: number, u1: number, steps?: number) => string
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** 一段时间 [a, b] 里的进度：之前 0、之后 1 */
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))

/** 对称缓入缓出（三次） */
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)

function fromPoints(points: Pt[], d: string): Track {
  const cum = [0]
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
  const length = cum[cum.length - 1] || 1
  const at = (u: number) => {
    const s = clamp01(u) * length
    let lo = 0
    let hi = cum.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (cum[mid] < s) lo = mid
      else hi = mid
    }
    const k = (s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo])
    return { x: points[lo].x + (points[hi].x - points[lo].x) * k, y: points[lo].y + (points[hi].y - points[lo].y) * k }
  }
  const slice = (u0: number, u1: number, steps = 8) => {
    const a = clamp01(Math.min(u0, u1))
    const b = clamp01(Math.max(u0, u1))
    return Array.from({ length: steps + 1 }, (_, i) => {
      const p = at(a + ((b - a) * i) / steps)
      return `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`
    }).join("")
  }
  return { d, length, at, slice }
}

/** 三次贝塞尔：a 起点、b c 控制点、e 终点；samples 段折线逼近算弧长 */
function cubicTrack(a: Pt, b: Pt, c: Pt, e: Pt, samples = 48): Track {
  const pts = Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples
    const m = 1 - t
    return {
      x: m * m * m * a.x + 3 * m * m * t * b.x + 3 * m * t * t * c.x + t * t * t * e.x,
      y: m * m * m * a.y + 3 * m * m * t * b.y + 3 * m * t * t * c.y + t * t * t * e.y,
    }
  })
  return fromPoints(pts, `M${a.x} ${a.y}C${b.x} ${b.y} ${c.x} ${c.y} ${e.x} ${e.y}`)
}

/** 水平方向出、水平方向进的 S 形连线（左右排的节点之间） */
const sCurve = (a: Pt, e: Pt) => cubicTrack(a, { x: (a.x + e.x) / 2, y: a.y }, { x: (a.x + e.x) / 2, y: e.y }, e)
/** 竖直方向出、竖直方向进的 S 形连线（上下排的节点之间） */
const vCurve = (a: Pt, e: Pt) => cubicTrack(a, { x: a.x, y: (a.y + e.y) / 2 }, { x: e.x, y: (a.y + e.y) / 2 }, e)

/** 折线 */
function lineTrack(points: Pt[]): Track {
  return fromPoints(points, points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(""))
}

/**
 * 逐帧写 DOM 时只写变了的值（属性或 style）：同一个元素同一个键上次写过同样的值就跳过，一帧几十个元素也不白白触发样式计算。
 * 键以 "style." 开头写 style，其余写属性；value 为 null 时移除属性。
 */
function cachedWriter() {
  const last = new WeakMap<Element, Map<string, string | null>>()
  return (el: Element | null | undefined, key: string, value: string | null) => {
    if (!el) return
    let m = last.get(el)
    if (!m) last.set(el, (m = new Map()))
    if (m.get(key) === value) return
    m.set(key, value)
    if (key.startsWith("style.")) (el as HTMLElement).style.setProperty(key.slice(6), value)
    else if (value === null) el.removeAttribute(key)
    else el.setAttribute(key, value)
  }
}

export { cachedWriter, cubicTrack, easeInOut, lineTrack, sCurve, span, vCurve, type Pt, type Track }
