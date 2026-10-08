type DataGridColumnType = "text" | "number" | "currency" | "percent" | "select"
type DataGridColumn = {
  key: string
  label: string
  type?: DataGridColumnType
  /** 像素；不写按类型给（文字 160、数 112、选项 128） */
  width?: number
  /** 固定在左边，横向滚动时不动 */
  pinned?: boolean
  /** 默认 true；算出来的、锁住的列写 false */
  editable?: boolean
  /** 选项列的可选值（输入、粘贴都按它校验） */
  options?: string[]
  /** 数字、金额、百分比的小数位，默认 0（百分比 1） */
  decimals?: number
}
type DataGridRow = { id: string } & Record<string, unknown>
type Cell = { row: number; col: number }
type Range = { r0: number; c0: number; r1: number; c1: number }
type Change = { id: string; key: string; before: unknown; after: unknown }
type SortState = { key: string; dir: "asc" | "desc" } | null

const NUMERIC = new Set<DataGridColumnType>(["number", "currency", "percent"])
const isNumeric = (c: DataGridColumn) => NUMERIC.has(c.type ?? "text")
const widthOf = (c: DataGridColumn) => c.width ?? (isNumeric(c) ? 112 : c.type === "select" ? 128 : 160)
const collator = new Intl.Collator("zh-CN", { numeric: true })

function formatCell(c: DataGridColumn, v: unknown) {
  if (v === null || v === undefined || v === "") return ""
  if (!isNumeric(c) || typeof v !== "number") return String(v)
  const d = c.decimals ?? (c.type === "percent" ? 1 : 0)
  const s = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v)
  return c.type === "currency" ? `¥${s}` : c.type === "percent" ? `${s}%` : s
}

/** 输入、粘贴的字 → 这一列的值；解析不了返回 { ok: false }。空字符串是清空（null） */
function parseCell(c: DataGridColumn, text: string): { ok: true; value: unknown } | { ok: false } {
  const t = text.trim()
  if (t === "") return { ok: true, value: null }
  if (isNumeric(c)) {
    const n = Number(t.replace(/[¥￥$,，\s]/g, "").replace(/%$/, ""))
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false }
  }
  if (c.type === "select" && c.options && !c.options.includes(t)) return { ok: false }
  return { ok: true, value: t }
}

/** 列号 → 字母（0 → A，26 → AA） */
const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + colName(i % 26))
const norm = (a: Cell, b: Cell): Range => ({ r0: Math.min(a.row, b.row), r1: Math.max(a.row, b.row), c0: Math.min(a.col, b.col), c1: Math.max(a.col, b.col) })
const address = (r: Range) => {
  const a = `${colName(r.c0)}${r.r0 + 1}`
  return r.r0 === r.r1 && r.c0 === r.c1 ? a : `${a}:${colName(r.c1)}${r.r1 + 1}`
}
const inRange = (r: Range | null, row: number, col: number) => Boolean(r) && row >= r!.r0 && row <= r!.r1 && col >= r!.c0 && col <= r!.c1

/** 选区 → 剪贴板：TSV（数是原始数，表格软件读成数）+ HTML 表格（显示的写法） */
function toClipboard(rows: DataGridRow[], cols: DataGridColumn[], r: Range) {
  const lines: string[] = []
  const html: string[] = []
  for (let i = r.r0; i <= r.r1; i++) {
    const cells = cols.slice(r.c0, r.c1 + 1).map((c) => rows[i]?.[c.key])
    lines.push(cells.map((v) => (v === null || v === undefined ? "" : String(v).replace(/[\t\n]/g, " "))).join("\t"))
    html.push(`<tr>${cols.slice(r.c0, r.c1 + 1).map((c, k) => `<td>${formatCell(c, cells[k]).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</td>`).join("")}</tr>`)
  }
  return { text: lines.join("\n"), html: `<table>${html.join("")}</table>` }
}

/** 剪贴板里的 TSV → 二维表（认引号包住的格子，格子里可以有换行和 Tab） */
function parseTsv(text: string) {
  const out: string[][] = [[]]
  let cell = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === "") quoted = true
    else if (ch === "\t") out[out.length - 1].push(cell), (cell = "")
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      out[out.length - 1].push(cell)
      cell = ""
      out.push([])
    } else cell += ch
  }
  out[out.length - 1].push(cell)
  while (out.length > 1 && out[out.length - 1].length === 1 && out[out.length - 1][0] === "") out.pop()
  return out
}

/** 排序：只在点表头时排一次（编辑不重排），返回 id 的顺序 */
function sortIds(rows: DataGridRow[], cols: DataGridColumn[], sort: SortState) {
  const ids = rows.map((r) => r.id)
  if (!sort) return ids
  const col = cols.find((c) => c.key === sort.key)
  if (!col) return ids
  const sign = sort.dir === "asc" ? 1 : -1
  const at = new Map(rows.map((r, i) => [r.id, i]))
  return [...rows]
    .sort((a, b) => {
      const x = a[sort.key]
      const y = b[sort.key]
      const ex = x === null || x === undefined || x === ""
      const ey = y === null || y === undefined || y === ""
      if (ex || ey) return ex === ey ? at.get(a.id)! - at.get(b.id)! : ex ? 1 : -1
      const d = isNumeric(col) ? Number(x) - Number(y) : collator.compare(String(x), String(y))
      return d ? d * sign : at.get(a.id)! - at.get(b.id)!
    })
    .map((r) => r.id)
}

/** 把一组改动用到行上（撤销时 back = true：用 before） */
function applyChanges(rows: DataGridRow[], changes: Change[], back = false) {
  const byId = new Map<string, Change[]>()
  for (const c of changes) byId.set(c.id, [...(byId.get(c.id) ?? []), c])
  return rows.map((r) => {
    const cs = byId.get(r.id)
    if (!cs) return r
    const next = { ...r }
    for (const c of back ? [...cs].reverse() : cs) next[c.key] = back ? c.before : c.after
    return next
  })
}

export { address, applyChanges, colName, formatCell, inRange, isNumeric, norm, parseCell, parseTsv, sortIds, toClipboard, widthOf }
export type { Cell, Change, DataGridColumn, DataGridColumnType, DataGridRow, Range, SortState }
