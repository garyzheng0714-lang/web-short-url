import * as React from "react"
import { ArrowUp, CircleAlert } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { EXIT, SPRINGS } from "@/components/ui/ease"
import { EmptyState } from "@/components/ui/empty-state"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { SwapText } from "@/components/ui/popup"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

/**
 * 可排序数据表：建在 Table 原件上（Table 是静态排版，它是可交互的数据表）。
 * - 排序：点表头升序、再点降序；空值两个方向都排在最后；数字按数值、文字按中文拼音（Intl.Collator zh-CN，数字串按数值）；同值保持原顺序。
 * - 列宽：第一次有数据时量一次各列宽度并锁住（百分比，table-fixed），之后排序、筛掉几行、选中都不改列宽；resizable 时可以拖表头右缘
 *   或聚焦后用 ←/→ 调宽（改成像素宽，表格比容器宽时在表格里横滚），双击拖拽条恢复。
 * - 选择：行首复选框、点行空白处、Shift 点选范围（锚点是上一次点的那一行，按当前顺序算）、表头全选（部分选中为半选）；
 *   底栏「共 N 条 / 已选 N 条」与「清除选择」；Esc 清空选择（没有选择时放行给外层）。只算当前这些行里的选择。
 * - 状态：loading 且还没有行 → 占好 5 行的位置，400ms 后才出现骨架（400ms 内完成的不闪）；已有行时刷新保留旧行（aria-busy）。
 *   error → 原位一行「加载失败 + 重试」，表头不动；重试后焦点交给表格外框。没有行 → 原位放空状态（empty，默认「没有记录」）。
 * - 窄容器（< 560，容器查询）：每行折成两行（主列一行、其余列一行小字，数字列前带列名），表头换成全选 + 排序（sm，左缘落在行内容线上）。
 * 选中不改行底色，只靠复选框（同 Table）；行悬停是 Table 的跟随悬停底（骨架、空、出错行标 data-static，不登记）。
 *
 * 动效（DESIGN.md §5.1、§5.2；谁引起 → 用哪条 → 减少动态时）：
 * - 指针点表头排序 → 行换位走 Table 的 moderate（0.16s，可中途反向）；箭头换方向 fast 转 180°，新列的箭头 fast 淡入 → 减少动态时行与箭头直接到位。
 * - 键盘（Enter / 空格按表头、方向键、Esc、空格勾选）→ 0ms：行、箭头、计数、清除按钮都直接到位。
 * - 底栏计数换字 → 新旧文字 blur 4 交叉（SwapText），「清除选择」fast 淡入、EXIT.fast（0.06s）淡出 → 减少动态时只淡入淡出。
 * - 拖列宽（指针直接操作）→ 宽度 1:1 跟手，不加弹簧（是排版不是动画）；骨架是时间驱动的呼吸（Skeleton）。
 */

type SortDirection = "asc" | "desc"
type SortState = { key: string; direction: SortDirection }
type DataColumn<T> = {
  /** 列的 id，也是默认取值的字段名 */
  key: string
  label: string
  /** 默认 true */
  sortable?: boolean
  /** 右对齐、等宽数字；不写时整列都是数字（或空）就自动当数字列 */
  numeric?: boolean
  /** end：整列右对齐（行尾的操作列）；数字列自动右对齐 */
  align?: "end"
  /** 固定宽度（像素） */
  width?: number
  /** 单元格内容；不写时显示字段值，空值显示「—」 */
  render?: (row: T) => React.ReactNode
  /** 排序用的值；不写时取 row[key] */
  sortValue?: (row: T) => unknown
}

const NARROW_HEAD = "@max-[560px]/sdt:flex @max-[560px]/sdt:overflow-x-auto @max-[560px]/sdt:[scrollbar-width:none]"
const NARROW_ROW =
  "@max-[560px]/sdt:relative @max-[560px]/sdt:flex @max-[560px]/sdt:flex-wrap @max-[560px]/sdt:items-center @max-[560px]/sdt:gap-x-3 @max-[560px]/sdt:gap-y-1 @max-[560px]/sdt:py-3 @max-[560px]/sdt:pr-4"
const NARROW_CELL = "@max-[560px]/sdt:h-auto @max-[560px]/sdt:p-0 @max-[560px]/sdt:first:pl-0 @max-[560px]/sdt:last:pr-0"
/** 窄屏时行末的操作列（没有表头字的最后一列）：钉在第一行右边，和左边的勾选框同一条中线，不跟着元信息换行 */
const NARROW_ACTION = "@max-[560px]/sdt:absolute @max-[560px]/sdt:top-3 @max-[560px]/sdt:flex @max-[560px]/sdt:h-6 @max-[560px]/sdt:items-center"
const INSTANT = { duration: 0 } as const
const MIN_W = 64
const MAX_W = 640
const LAST_MIN = 120
const SELECT_W = 40
const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" })
const isEmpty = (v: unknown) => v == null || v === ""
const fieldOf = <T,>(row: T, key: string) => (row as Record<string, unknown>)[key]

function sortRows<T>(rows: T[], column: DataColumn<T> | undefined, direction: SortDirection) {
  if (!column) return rows
  const valueOf = (row: T) => {
    const v = column.sortValue ? column.sortValue(row) : fieldOf(row, column.key)
    return v instanceof Date ? v.getTime() : v
  }
  return rows
    .map((row, index) => ({ row, index, v: valueOf(row) }))
    .sort((a, b) => {
      const ea = isEmpty(a.v)
      const eb = isEmpty(b.v)
      if (ea || eb) return ea === eb ? a.index - b.index : ea ? 1 : -1
      const r = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : collator.compare(String(a.v), String(b.v))
      return (direction === "asc" ? r : -r) || a.index - b.index
    })
    .map((e) => e.row)
}

/** 受控 / 非受控两种写法 */
function useControllable<V>(value: V | undefined, initial: V, onChange?: (v: V) => void) {
  const [inner, setInner] = React.useState(initial)
  const current = value === undefined ? inner : value
  const set = (next: V) => {
    if (value === undefined) setInner(next)
    onChange?.(next)
  }
  return [current, set] as const
}

/** 过了 ms 才变成 true（加载 400ms 后才出现骨架） */
function useLate(active: boolean, ms = 400) {
  const [late, setLate] = React.useState(false)
  React.useEffect(() => {
    if (!active) return setLate(false)
    const t = window.setTimeout(() => setLate(true), ms)
    return () => window.clearTimeout(t)
  }, [active, ms])
  return active && late
}

/** 排序箭头：换方向时转 180°（fast）；新列的箭头淡入，刚出现时就指向正确方向，不转 */
function SortArrow({ direction }: { direction: SortDirection }) {
  const still = Boolean(useReducedMotion()) || fromKeyboard()
  const [first] = React.useState(() => !still)
  return (
    <motion.span
      aria-hidden
      data-slot="sort-arrow"
      className="inline-flex size-3 shrink-0 items-center justify-center text-fg"
      initial={first ? { opacity: 0, rotate: direction === "desc" ? 180 : 0 } : false}
      animate={{ opacity: 1, rotate: direction === "desc" ? 180 : 0 }}
      transition={still ? INSTANT : { rotate: SPRINGS.fast, opacity: SPRINGS.fast }}
    >
      <ArrowUp className="size-3" />
    </motion.span>
  )
}

function SortableDataTable<T>({
  rows,
  columns,
  rowKey,
  caption,
  sort: sortProp,
  defaultSort = null,
  onSortChange,
  selectable = false,
  selected: selectedProp,
  defaultSelected = [],
  onSelectedChange,
  unit = "条",
  actions,
  status = "ready",
  onRetry,
  errorTitle = "加载失败",
  empty,
  resizable = false,
  flush = false,
  className,
}: {
  rows: T[]
  columns: DataColumn<T>[]
  /** 每行的稳定 id：字段名或函数 */
  rowKey: keyof T | ((row: T) => string)
  /** 表格的名字，给读屏（不显示） */
  caption: string
  sort?: SortState | null
  defaultSort?: SortState | null
  onSortChange?: (sort: SortState) => void
  selectable?: boolean
  selected?: string[]
  defaultSelected?: string[]
  onSelectedChange?: (keys: string[]) => void
  /** 底栏计数的量词：「共 5 条」「已选 2 条」；可写「个项目」 */
  unit?: string
  /** 有选择时放在底栏右侧的批量操作 */
  actions?: (keys: string[]) => React.ReactNode
  status?: "ready" | "loading" | "error"
  onRetry?: () => void
  errorTitle?: string
  /** 没有行时放的内容，默认 <EmptyState title="没有记录" /> */
  empty?: React.ReactNode
  resizable?: boolean
  /** 首尾列与正文内容线对齐（同 Table.flush）；选择槽保留 */
  flush?: boolean
  className?: string
}) {
  const root = React.useRef<HTMLDivElement>(null)
  const tableRef = React.useRef<HTMLTableElement>(null)
  const anchor = React.useRef<string | null>(null)
  const [sort, setSort] = useControllable(sortProp, defaultSort, (s) => s && onSortChange?.(s))
  const [selectedList, setSelected] = useControllable(selectedProp, defaultSelected, onSelectedChange)
  const [announcement, setAnnouncement] = React.useState("")
  const reduce = useReducedMotion()

  const keyOf = (row: T) => String(typeof rowKey === "function" ? rowKey(row) : row[rowKey])
  const sorted = React.useMemo(() => (sort ? sortRows(rows, columns.find((c) => c.key === sort.key), sort.direction) : rows), [rows, columns, sort])
  const keys = sorted.map(keyOf)
  const selection = new Set(selectedList)
  const picked = keys.filter((k) => selection.has(k))
  const allState = picked.length === 0 ? false : picked.length === keys.length ? true : "indeterminate"
  const numericKeys = React.useMemo(() => {
    const auto = (c: DataColumn<T>) => rows.some((r) => typeof fieldOf(r, c.key) === "number") && rows.every((r) => typeof fieldOf(r, c.key) === "number" || isEmpty(fieldOf(r, c.key)))
    return new Set(columns.filter((c) => c.numeric ?? auto(c)).map((c) => c.key))
  }, [columns, rows])
  const numeric = (c: DataColumn<T>) => numericKeys.has(c.key)
  const showRows = sorted.length > 0 && status !== "error"
  const skeleton = status === "loading" && !sorted.length
  const lateSkeleton = useLate(skeleton)

  // ── 列宽：第一次有数据时量一次并锁住（百分比）；拖动后换成像素 ─────────────────────────
  const signature = `${selectable}|${columns.map((c) => c.key).join("|")}`
  const [locked, setLocked] = React.useState<{ sig: string; pct: Record<string, number> } | null>(null)
  const [px, setPx] = React.useState<Record<string, number> | null>(null)
  const pct = locked?.sig === signature ? locked.pct : null
  React.useLayoutEffect(() => {
    const table = tableRef.current
    if (!table || pct || !showRows) return
    const measure = () => {
      const total = table.getBoundingClientRect().width
      if (!total || getComputedStyle(table).display !== "table") return false
      const next: Record<string, number> = {}
      table.querySelectorAll<HTMLElement>("thead th[data-key]").forEach((th) => (next[th.dataset.key!] = (th.getBoundingClientRect().width / total) * 100))
      setLocked({ sig: signature, pct: next })
      return true
    }
    if (measure()) return
    // 窄容器里是两行版式，量不到列宽：等变宽了再量
    const ro = new ResizeObserver(() => measure() && ro.disconnect())
    ro.observe(table)
    return () => ro.disconnect()
  }, [pct, showRows, signature])
  const measurePx = () => {
    const out: Record<string, number> = {}
    tableRef.current?.querySelectorAll<HTMLElement>("thead th[data-key]").forEach((th) => (out[th.dataset.key!] = th.getBoundingClientRect().width))
    return out
  }
  const last = columns.at(-1)?.key
  const widthOf = (c: DataColumn<T>) =>
    px ? (c.key === last ? undefined : `${px[c.key]}px`) : c.width ? `${c.width}px` : pct ? `${pct[c.key]}%` : undefined
  const tableWidth = px
    ? `max(100%, ${columns.reduce((s, c) => s + (c.key === last ? LAST_MIN : (px[c.key] ?? 0)), selectable ? SELECT_W : 0)}px)`
    : undefined

  const drag = React.useRef<{ key: string; x: number; w: number } | null>(null)
  const [resizing, setResizing] = React.useState<string | null>(null)
  const stopDrag = () => ((drag.current = null), setResizing(null))
  const setWidth = (key: string, w: number, base = px ?? measurePx()) => setPx({ ...base, [key]: Math.round(Math.min(MAX_W, Math.max(MIN_W, w))) })
  const resizeHandle = (c: DataColumn<T>) => {
    const w = px?.[c.key]
    return (
      <span
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={`调整「${c.label}」列宽`}
        aria-valuenow={w === undefined ? undefined : Math.round(w)}
        aria-valuemin={MIN_W}
        aria-valuemax={MAX_W}
        data-slot="column-resizer"
        data-active={resizing === c.key || undefined}
        className="group/resize absolute top-0 right-0 z-10 h-full w-2 translate-x-1/2 cursor-col-resize touch-none rounded-sm outline-none focus-visible:focus-ring select-none @max-[560px]/sdt:hidden"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          const base = px ?? measurePx()
          drag.current = { key: c.key, x: e.clientX, w: base[c.key] }
          e.currentTarget.setPointerCapture(e.pointerId)
          setPx(base)
          setResizing(c.key)
        }}
        onPointerMove={(e) => drag.current && setWidth(drag.current.key, drag.current.w + e.clientX - drag.current.x)}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onDoubleClick={() => setPx(null)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
          e.preventDefault()
          const base = px ?? measurePx()
          setWidth(c.key, base[c.key] + (e.shiftKey ? 64 : 16) * (e.key === "ArrowRight" ? 1 : -1), base)
        }}
      >
        <span
          aria-hidden
          className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-line-strong opacity-0 transition-opacity duration-(--ds-dur-fast) ease-ds group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100 group-focus-visible/resize:focus-ring group-data-active/resize:opacity-100"
        />
      </span>
    )
  }

  // ── 排序与选择 ─────────────────────────────────────────────────────
  const sortBy = (c: DataColumn<T>) => {
    const next: SortState = { key: c.key, direction: sort?.key === c.key && sort.direction === "asc" ? "desc" : "asc" }
    setSort(next)
    setAnnouncement(`按${c.label}${next.direction === "asc" ? "升序" : "降序"}排列`)
  }
  const commit = (next: Set<string>) => {
    // 只动当前这些行；别的（被筛掉的）原样保留
    const outside = selectedList.filter((k) => !keys.includes(k))
    const inside = keys.filter((k) => next.has(k))
    setSelected([...outside, ...inside])
    setAnnouncement(inside.length ? `已选 ${inside.length} ${unit}，共 ${keys.length} ${unit}` : "已清除选择")
  }
  const toggleRow = (key: string, extend: boolean) => {
    const next = new Set(selection)
    const on = !selection.has(key)
    const from = extend && anchor.current ? keys.indexOf(anchor.current) : -1
    const to = keys.indexOf(key)
    const range = from < 0 ? [key] : keys.slice(Math.min(from, to), Math.max(from, to) + 1)
    range.forEach((k) => (on ? next.add(k) : next.delete(k)))
    anchor.current = key
    commit(next)
  }
  const clear = () => {
    commit(new Set())
    root.current?.querySelector<HTMLElement>("thead [role=checkbox]")?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (e.key === "Escape" && picked.length) {
      e.preventDefault()
      e.stopPropagation()
      return target.dataset.clear !== undefined ? clear() : commit(new Set())
    }
    const nav = target.dataset.nav
    if (!nav) return
    const list = (name: string) => [...e.currentTarget.querySelectorAll<HTMLElement>(`[data-nav="${name}"]`)]
    const items = list(nav)
    const i = items.indexOf(target)
    const head = list("head")
    const all = head.find((el) => el.getAttribute("role") === "checkbox")
    const steps: Record<string, HTMLElement | undefined> =
      nav === "head"
        ? { ArrowRight: items[i + 1], ArrowLeft: items[i - 1], Home: items[0], End: items.at(-1), ArrowDown: target === all ? list("row")[0] : undefined }
        : { ArrowDown: items[i + 1], ArrowUp: i === 0 ? all : items[i - 1], Home: items[0], End: items.at(-1) }
    const next = steps[e.key]
    if (!next) return
    e.preventDefault()
    next.focus()
  }

  const span = columns.length + (selectable ? 1 : 0)
  // 没有表头字、有 render 的最后一列当作行末操作（移除、更多）：窄屏时钉在右上角
  const tail = columns.at(-1)
  const actionCol = columns.length > 1 && tail && !tail.label && tail.render ? tail : undefined
  const still = Boolean(reduce) || fromKeyboard()
  const count = picked.length ? `已选 ${picked.length} ${unit}` : `共 ${keys.length} ${unit}`

  return (
    <div ref={root} data-slot="sortable-data-table" data-flush={flush || undefined} tabIndex={-1} className={cn("@container/sdt w-full outline-none", className)} onKeyDown={onKeyDown}>
      <div className={cn("mb-3 hidden items-center gap-4 @max-[560px]/sdt:flex", !flush && "px-4")}>
        {selectable ? <Checkbox aria-label="全选" checked={allState} disabled={!showRows} onCheckedChange={() => commit(allState === true ? new Set() : new Set(keys))} /> : null}
        <Select value={sort ? `${sort.key}:${sort.direction}` : ""} onValueChange={(value) => { const c = columns.find(c => value === `${c.key}:asc` || value === `${c.key}:desc`); if (c) { const direction = value.endsWith(":asc") ? "asc" : "desc"; setSort({ key: c.key, direction }) } }}>
          <SelectTrigger aria-label="排序" className="h-(--ds-h-sm) w-auto data-placeholder:text-fg"><SelectValue placeholder="排序" /></SelectTrigger>
          <SelectContent>{columns.filter(c => c.sortable !== false).flatMap(c => ["asc", "desc"].map(direction => <SelectItem key={`${c.key}:${direction}`} value={`${c.key}:${direction}`}>{c.label} · {direction === "asc" ? "升序" : "降序"}</SelectItem>))}</SelectContent>
        </Select>
      </div>
      <Table
        ref={tableRef}
        data-stacked=""
        flush={flush}
        aria-busy={status === "loading" || undefined}
        className={cn((pct || px) && "table-fixed", "@max-[560px]/sdt:block @min-[560px]/sdt:min-w-(--sdt-min)")}
        style={{ width: tableWidth, "--sdt-min": `${columns.reduce((w, c) => w + Math.max(c.width ?? 0, c.label.length * 13 + 52, numeric(c) ? 96 : 112), selectable ? SELECT_W : 0)}px` } as React.CSSProperties}
      >
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          {selectable ? <col style={{ width: SELECT_W }} /> : null}
          {columns.map((c) => <col key={c.key} style={{ width: widthOf(c) }} />)}
        </colgroup>
        <TableHeader className="@max-[560px]/sdt:hidden">
          <TableRow className={NARROW_HEAD}>
            {selectable ? (
              <TableHead className="[&:has([role=checkbox])]:w-10 @max-[560px]/sdt:flex @max-[560px]/sdt:shrink-0 @max-[560px]/sdt:items-center">
                <Checkbox aria-label="全选" data-nav="head" checked={allState} disabled={!showRows}
                  onClick={(e) => (e.preventDefault(), commit(allState === true ? new Set() : new Set(keys)))} />
              </TableHead>
            ) : null}
            {columns.map((c) => {
              const active = sort?.key === c.key
              const sortable = c.sortable !== false
              const num = numeric(c)
              return (
                <TableHead
                  key={c.key}
                  data-key={c.key}
                  aria-sort={sortable ? (active ? (sort!.direction === "asc" ? "ascending" : "descending") : "none") : undefined}
                  className={cn(
                    "relative",
                    (num || c.align === "end") && "text-right",
                    active && "text-fg",
                    "@max-[560px]/sdt:flex @max-[560px]/sdt:shrink-0 @max-[560px]/sdt:items-center @max-[560px]/sdt:px-2",
                    !sortable && "@max-[560px]/sdt:hidden"
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      data-nav="head"
                      aria-label={`按${c.label}排序${active ? `，当前${sort!.direction === "asc" ? "升序" : "降序"}` : ""}`}
                      onClick={() => sortBy(c)}
                      className={cn(
                        "group/sort relative inline-flex min-h-8 -mx-2 px-2 pointer-coarse:min-h-11 max-w-full items-center gap-1 rounded-sm outline-none hover:text-fg focus-visible:focus-ring",
                        num && "flex-row-reverse"
                      )}
                    >
                      <span className="whitespace-nowrap">{c.label}</span>
                      {active ? (
                        <SortArrow key={c.key} direction={sort!.direction} />
                      ) : (
                        <ArrowUp aria-hidden className="size-3 shrink-0 text-fg-subtle opacity-0 group-hover/sort:opacity-100" />
                      )}
                    </button>
                  ) : (
                    c.label
                  )}
                  {resizable && c.key !== last ? resizeHandle(c) : null}
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody className="@max-[560px]/sdt:block">
          {showRows
            ? sorted.map((row, i) => {
                const key = keys[i]
                const on = selection.has(key)
                return (
                  <TableRow
                    key={key}
                    data-row={key}
                    data-selected={on || undefined}
                    className={cn(NARROW_ROW, selectable ? flush ? "@max-[560px]/sdt:pl-8" : "@max-[560px]/sdt:pl-12" : flush ? "@max-[560px]/sdt:pl-0" : "@max-[560px]/sdt:pl-4", flush && "@max-[560px]/sdt:pr-0")}
                    onMouseDown={(e) => selectable && e.shiftKey && e.preventDefault()}
                    onClick={(e) => {
                      if (!selectable || window.getSelection()?.toString()) return
                      if ((e.target as HTMLElement).closest("a,button,input,label,select,textarea,[role=checkbox],[contenteditable=true]")) return
                      toggleRow(key, e.shiftKey)
                    }}
                  >
                    {selectable ? (
                      <TableCell className={cn("@max-[560px]/sdt:absolute @max-[560px]/sdt:top-3 @max-[560px]/sdt:flex @max-[560px]/sdt:h-6 @max-[560px]/sdt:items-center @max-[560px]/sdt:p-0 @max-[560px]/sdt:first:pl-0", flush ? "@max-[560px]/sdt:left-0" : "@max-[560px]/sdt:left-4")}>
                        <Checkbox aria-label={`选择 ${String(fieldOf(row, columns[0].key) ?? key)}`} data-nav="row" checked={on}
                          onClick={(e) => (e.preventDefault(), toggleRow(key, e.shiftKey))} />
                      </TableCell>
                    ) : null}
                    {columns.map((c, ci) => (
                      <TableCell key={c.key} className={cn("truncate", ci === 0 && "text-fg", numeric(c) && "font-mono tabular-nums", (numeric(c) || c.align === "end") && "text-right", NARROW_CELL,
                        ci === 0 ? cn("@max-[560px]/sdt:basis-full @max-[560px]/sdt:text-left", actionCol && "@max-[560px]/sdt:pr-16") : c === actionCol ? cn(NARROW_ACTION, "overflow-visible") : "@max-[560px]/sdt:text-xs",
                        c === actionCol && (flush ? "@max-[560px]/sdt:right-0" : "@max-[560px]/sdt:right-4"))}>
                        {ci > 0 && numeric(c) ? <span className="hidden font-sans text-fg-muted @max-[560px]/sdt:inline">{c.label} </span> : null}
                        {c.render ? c.render(row) : isEmpty(fieldOf(row, c.key)) ? "—" : String(fieldOf(row, c.key))}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })
            : skeleton
              ? Array.from({ length: 5 }, (_, i) => (
                  <TableRow key={`skeleton-${i}`} data-skeleton="" data-static="" className={cn(NARROW_ROW, "@max-[560px]/sdt:pl-4")}>
                    {selectable ? <TableCell className="@max-[560px]/sdt:hidden" /> : null}
                    {columns.map((c, ci) => (
                      <TableCell key={c.key} className={cn(NARROW_CELL, ci === 0 && "@max-[560px]/sdt:basis-full")}>
                        <Skeleton className={cn("inline-block h-3 align-middle transition-opacity duration-(--ds-dur-fast) ease-ds", ["w-3/5", "w-2/5", "w-1/2"][(i + ci) % 3], !lateSkeleton && "opacity-0")} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : [
                  <TableRow key={status === "error" ? "error" : "empty"} data-state={status === "error" ? "error" : "empty"} data-static="" className="@max-[560px]/sdt:block">
                    {/* 窄屏时表格是 block：这一格也要 block 才占满整行，空、出错的那句话才居中 */}
                    <TableCell colSpan={span} className="h-auto p-0 whitespace-normal @max-[560px]/sdt:block">
                      {status === "error" ? (
                        <EmptyState icon={<CircleAlert className="text-danger" />} title={errorTitle}
                          action={onRetry ? <Button variant="secondary" onClick={() => (root.current?.focus(), onRetry())}>重试</Button> : undefined} />
                      ) : (
                        (empty ?? <EmptyState title="没有记录" />)
                      )}
                    </TableCell>
                  </TableRow>,
                ]}
        </TableBody>
      </Table>
      {selectable ? (
        <div data-slot="table-footer" className={cn("flex h-11 items-center justify-between gap-3 border-t border-line text-sm", flush ? "px-0" : "px-4")}>
          <span className="relative tabular-nums text-fg-muted" data-slot="table-count">
            <SwapText>{count}</SwapText>
          </span>
          <AnimatePresence initial={false}>
            {picked.length ? (
              <motion.div key="selection" className="flex items-center gap-2" initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: still ? INSTANT : SPRINGS.fast }}
                exit={{ opacity: 0, transition: still ? INSTANT : EXIT.fast }}>
                {actions?.(picked)}
                <Button variant="ghost" size="sm" className="edge-end" data-clear="" onClick={clear}>
                  清除选择
                </Button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}
      <p role="status" className="sr-only">{announcement}</p>
    </div>
  )
}

export { SortableDataTable, type DataColumn, type SortDirection, type SortState }
