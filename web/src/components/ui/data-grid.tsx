"use client"

import { nextFrame } from "@/components/ui/frame"

import * as React from "react"
import { ArrowDown, ArrowUp, Redo2, Undo2 } from "lucide-react"
import { animate, motionValue, useReducedMotion, type MotionValue } from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import * as M from "@/components/ui/data-grid-model"
import { DataGridBodyRow, DataGridState, DataGridStatus, useLate, useGridWidths, type Editing, type DataGridProps } from "@/components/ui/data-grid-parts"
import { useGridEdits } from "@/components/ui/data-grid-edits"
import { EASE_OUT, SPRINGS } from "@/components/ui/ease"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { Tooltip } from "@/components/ui/tooltip"

/**
 * 数据表格：像电子表格一样就地改很多值（预算、价格表、库存）。新建而不是扩展 sortable-data-table：那个是只读记录 + 行选择的 <table>，
 * 这里要单元格选择、编辑、上万行虚拟滚动、列固定——行是绝对定位的 div（role="grid"），交互模型完全不同。纯函数在 data-grid-model，改值（撤销、清空、填充、复制粘贴）在 data-grid-edits，行与底栏在 data-grid-parts。
 * - 虚拟滚动：只渲染看得见的行 ± 6（加上活动格那一行），行 36 高、表头 44 吸顶、行号与 pinned 列吸左；只在表格自己里面滚。
 * - 选择：点一格、Shift 点 / 拖出范围；活动格 2px 墨色内框、白底，选区 selected 底（不用彩色底）；没碰过表格前都不画。底栏写地址（B3:D7）、计数、数字列求和。
 * - 编辑：Enter / F2 / 双击 / 直接打字开始；Enter 提交下移、Tab 提交右移、Esc 放弃；数字列解析不了标红不提交；选项列只收选项里的值。
 *   输入法组字中的 Enter 不提交。中文直接打字请先按 Enter 或双击进入编辑（表格本身不是输入框）。
 * - 键盘：方向键、Shift 扩选、⌘/Ctrl + 方向到边、Home / End、PageUp / PageDown、Tab；Delete 清空；⌘/Ctrl + C / V（TSV，与表格软件互通）、
 *   Z / Shift+Z（撤销 / 重做，100 步）、D（向下填充）、A（全选）。焦点一直在表格上，活动格经 aria-activedescendant 念出来。
 * - 排序：点表头 升序 → 降序 → 不排；只排这一次，之后编辑不重排（行不会在指针下跳走）。
 *
 * 动效（DESIGN.md §5.1、§5.2；谁引起 → 用哪条 → 减少动态时）：
 * - 指针点表头排序 → 看得见的行从原位置 moderate（0.16s，不过冲）滑到新位置，从视口外进来的淡入 80ms（fast）→ 键盘排序、减少动态时直接到位。
 * - 刷新中变淡（opacity .4）80ms，恢复 80ms（CSS --ds-dur-fast）。
 * - 选择、活动格、编辑框 → 不动（高频操作，0ms）；滚动时跟着内容走。
 */

// 行高、表头高、行号槽宽、视口外多渲染几行
const [ROW, HEAD, GUTTER, OVERSCAN] = [36, 44, 48, 6]
/** 排序时从视口外进来的行淡入：fast 档的时长（WAAPI 用毫秒） */
const FADE_MS = 80

function DataGrid({ columns, rows: rowsProp, onRowsChange, label, maxHeight = 480, defaultSort = null, loading = false, error, onRetry, emptyLabel = "没有记录", className }: DataGridProps) {
  const uid = React.useId().replace(/:/g, "")
  const reduce = useReducedMotion()
  const [inner, setInner] = React.useState(rowsProp)
  // 不受控时也认使用方换了一份新行（重新加载、切换数据集）：换了就用新的
  const [seenProp, setSeenProp] = React.useState(rowsProp)
  if (seenProp !== rowsProp) {
    setSeenProp(rowsProp)
    setInner(rowsProp)
  }
  const rows = onRowsChange ? rowsProp : inner
  const cols = columns
  const [sort, setSort] = React.useState<M.SortState>(defaultSort)
  const [order, setOrder] = React.useState(() => M.sortIds(rows, cols, defaultSort))
  const byId = React.useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])
  // 行的顺序：排序时定下的 id 顺序；新加的行接在后面，删掉的去掉（编辑不重排）
  const view = React.useMemo(() => {
    const seen = new Set(order)
    return [...order.filter((id) => byId.has(id)), ...rows.filter((r) => !seen.has(r.id)).map((r) => r.id)].map((id) => byId.get(id)!)
  }, [order, byId, rows])
  const n = view.length

  // 列的位置：行号槽之后依次排；pinned 的列吸左（left = 前面所有 pinned 列 + 行号槽）
  const scroller = React.useRef<HTMLDivElement>(null)
  const declared = useGridWidths(scroller, cols, GUTTER)
  const [scroll, setScroll] = React.useState({ top: 0, height: maxHeight, width: 0 })
  // 列加起来比表格窄：最后一列吃掉余下的宽，右边不留一条没有格子的空带
  const spare = Math.max(0, scroll.width - GUTTER - declared.reduce((a, w) => a + w, 0))
  const widths = declared.map((w, i) => (i === declared.length - 1 ? w + spare : w))
  const lefts = widths.reduce<number[]>((a, _, i) => [...a, i ? a[i - 1] + widths[i - 1] : GUTTER], [])
  const totalW = GUTTER + widths.reduce((a, w) => a + w, 0)
  const pinnedW = GUTTER + cols.reduce((a, c, i) => a + (c.pinned ? widths[i] : 0), 0)
  // 吸左时离左边多远：行号槽 + 它前面的 pinned 列（pinned 的列请放在最前）
  const stick = cols.map((_, j) => GUTTER + cols.slice(0, j).reduce((a, c, k) => a + (c.pinned ? widths[k] : 0), 0))

  React.useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setScroll((s) => ({ ...s, height: el.clientHeight, width: el.clientWidth })))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const first = Math.max(0, Math.floor(scroll.top / ROW) - OVERSCAN)
  const last = Math.min(n, Math.ceil((scroll.top + scroll.height) / ROW) + OVERSCAN)

  // 选择与编辑
  const [active, setActive] = React.useState<M.Cell>({ row: 0, col: 0 })
  const [anchor, setAnchor] = React.useState<M.Cell>({ row: 0, col: 0 })
  const range = M.norm(anchor, active)
  const [editing, setEditingState] = React.useState<Editing | null>(null)
  // 编辑框失焦也会提交：提交过一次就清掉，免得 Enter 提交后焦点回到表格时又交一遍
  const editingRef = React.useRef<Editing | null>(null)
  const setEditing = (next: Editing | null) => {
    editingRef.current = next
    setEditingState(next)
  }
  const [said, setSaid] = React.useState("")
  // 没碰过表格时不画活动格、选区和底栏：静止的表格不该看起来已经选中了 A1
  const [engaged, setEngaged] = React.useState(false)
  const clamp = (c: M.Cell): M.Cell => ({ row: Math.min(Math.max(0, c.row), Math.max(0, n - 1)), col: Math.min(Math.max(0, c.col), cols.length - 1) })
  const select = (to: M.Cell, extend = false) => {
    const c = clamp(to)
    setActive(c)
    if (!extend) setAnchor(c)
    reveal(c)
  }
  /** 活动格滚进视口：上下按行，左右要避开吸左的列 */
  const reveal = (c: M.Cell) => {
    const el = scroller.current
    if (!el) return
    const top = c.row * ROW
    const bodyH = el.clientHeight - HEAD
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW > el.scrollTop + bodyH) el.scrollTop = top + ROW - bodyH
    if (cols[c.col]?.pinned) return
    const x = lefts[c.col]
    if (x < el.scrollLeft + pinnedW) el.scrollLeft = x - pinnedW
    else if (x + widths[c.col] > el.scrollLeft + el.clientWidth) el.scrollLeft = x + widths[c.col] - el.clientWidth
  }

  // 改值（撤销栈、清空、填充、复制粘贴）在 data-grid-edits：这里只交给它行、列、选区和「怎么写回」
  const { write, setCell, editable, clear, fillDown, doUndo, onCopy, onPaste, canUndo, canRedo } = useGridEdits({
    rows, view, cols, range, editing: Boolean(editing),
    commit: (next) => (onRowsChange ? onRowsChange(next) : setInner(next)),
    say: setSaid,
    selectRange: (from, to) => {
      setAnchor(from)
      setActive(to)
    },
  })
  const startEdit = (cell: M.Cell, text?: string) => {
    if (!editable(cell.col) || !view[cell.row]) return setSaid(`${cols[cell.col]?.label}不能改`)
    const c = cols[cell.col]
    const v = view[cell.row][c.key]
    setEditing({ ...cell, text: text ?? (v == null ? "" : String(v)), pick: c.options ? Math.max(0, c.options.indexOf(String(v))) : undefined })
  }
  const commitEdit = (move?: M.Cell, text?: string) => {
    const ed = editingRef.current
    if (!ed) return
    const c = cols[ed.col]
    const t = text ?? ed.text
    const parsed = M.parseCell(c, t)
    if (!parsed.ok) {
      setEditing({ ...ed, text: t, invalid: true })
      return setSaid(c.options ? `「${t}」不在${c.label}的选项里` : `${c.label}要填数字`)
    }
    const ch = setCell(ed.row, ed.col, parsed.value)
    setEditing(null)
    if (ch) write([ch], `${view[ed.row][cols[0].key] ?? ""}的${c.label}改成 ${M.formatCell(c, parsed.value) || "空"}`)
    if (move) select(move)
    scroller.current?.focus({ preventScroll: true })
  }
  const cancelEdit = () => {
    setEditing(null)
    scroller.current?.focus({ preventScroll: true })
  }

  // 排序：指针点表头时看得见的行从原位置滑过去（FLIP）；键盘、减少动态直接到位
  const rowEls = React.useRef(new Map<string, HTMLDivElement>())
  const flip = React.useRef<Map<string, number> | null>(null)
  const slides = React.useRef(new Map<string, MotionValue<number>>())
  React.useEffect(() => () => slides.current.forEach(value => value.stop()), [])
  const sortBy = (key: string) => {
    const next: M.SortState = sort?.key !== key ? { key, dir: "asc" } : sort.dir === "asc" ? { key, dir: "desc" } : null
    // 记下每一行此刻在屏幕上的位置（半路又排一次时从当前位置接着滑，不跳回原位）
    if (!reduce && !fromKeyboard())
      flip.current = new Map(
        view.slice(first, last).map((r, i) => {
          const dy = slides.current.get(r.id)?.get() ?? 0
          return [r.id, (first + i) * ROW + dy]
        })
      )
    setSort(next)
    setOrder(M.sortIds(rows, cols, next))
    setSaid(next ? `按${cols.find((c) => c.key === key)?.label}${next.dir === "asc" ? "升序" : "降序"}` : "取消排序")
  }
  React.useLayoutEffect(() => {
    const old = flip.current
    flip.current = null
    // 键盘、减少动态排序：还在滑的行也直接到位
    if (!old) return slides.current.forEach((a, id) => (a.jump(0), rowEls.current.get(id)?.style.removeProperty("transform")))
    const starts: (() => void)[] = []
    view.forEach((r, i) => {
      const el = rowEls.current.get(r.id)
      if (!el) return
      const was = old.get(r.id)
      if (was === undefined) {
        el.style.opacity = "0"
        starts.push(() => { el.style.opacity = ""; el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: `cubic-bezier(${EASE_OUT.join(",")})` }) })
      }
      else if (Math.abs(was - i * ROW) > 0.5) {
        // 起点同步写上：motion 下一帧才写第一帧，不写的话会先闪一帧终点
        const value = slides.current.get(r.id) ?? motionValue(0), velocity = value.getVelocity()
        slides.current.set(r.id, value)
        value.jump(was - i * ROW)
        el.style.transform = `translateY(${value.get()}px)`
        // FLIP 换坐标原点，屏幕位置不变；显式继承换原点前的物理速度。
        starts.push(() => { animate(value, 0, { ...SPRINGS.moderate, velocity, onUpdate: v => { el.style.transform = `translateY(${v}px)` } }) })
      }
    })
    return nextFrame(() => { starts.forEach(start => start()) })
  }, [order])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // 只管表格本身的按键：表头按钮、编辑框里的按键冒泡上来不处理（不然表头上的 Enter 会被当成「编辑」吃掉）
    if (e.target !== e.currentTarget || editing || e.nativeEvent.isComposing || !n) return
    const mod = e.metaKey || e.ctrlKey
    const k = e.key
    const page = Math.max(1, Math.floor((scroll.height - HEAD) / ROW) - 1)
    const moves: Record<string, M.Cell> = {
      ArrowUp: { row: mod ? 0 : active.row - 1, col: active.col },
      ArrowDown: { row: mod ? n - 1 : active.row + 1, col: active.col },
      ArrowLeft: { row: active.row, col: mod ? 0 : active.col - 1 },
      ArrowRight: { row: active.row, col: mod ? cols.length - 1 : active.col + 1 },
      Home: { row: mod ? 0 : active.row, col: 0 },
      End: { row: mod ? n - 1 : active.row, col: cols.length - 1 },
      PageUp: { row: active.row - page, col: active.col },
      PageDown: { row: active.row + page, col: active.col },
    }
    if (k in moves) {
      e.preventDefault()
      select(moves[k], e.shiftKey && k.startsWith("Arrow"))
      // 回到行首：连横向滚动一起回到最左（第一列是固定列时 reveal 不会去动横向滚动）
      if (k === "Home" && scroller.current) scroller.current.scrollLeft = 0
      return
    }
    if (k === "Tab") {
      const step = e.shiftKey ? -1 : 1
      const flat = active.row * cols.length + active.col + step
      if (flat < 0 || flat >= n * cols.length) return // 走出表格：交给浏览器把焦点移走
      e.preventDefault()
      return select({ row: Math.floor(flat / cols.length), col: flat % cols.length })
    }
    if (k === "Enter" || k === "F2") {
      e.preventDefault()
      return startEdit(active)
    }
    if (k === "Escape") return setAnchor(active)
    if (k === "Delete" || k === "Backspace") {
      e.preventDefault()
      return clear()
    }
    if (mod && (k === "z" || k === "Z")) {
      e.preventDefault()
      return doUndo(!e.shiftKey)
    }
    if (mod && k === "y") {
      e.preventDefault()
      return doUndo(false)
    }
    if (mod && k === "d") {
      e.preventDefault()
      return fillDown()
    }
    if (mod && k === "a") {
      e.preventDefault()
      setAnchor({ row: 0, col: 0 })
      return setActive({ row: n - 1, col: cols.length - 1 })
    }
    if (k.length === 1 && !mod && !e.altKey) {
      e.preventDefault()
      startEdit(active, k)
    }
  }

  // 指针：鼠标按下选格、拖出范围；触屏点一下选格（松手时），再点一下编辑，拖是滚动
  const cellAt = (x: number, y: number): M.Cell | null => {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-slot=data-grid-cell]")
    return hit ? { row: Number(hit.dataset.row), col: Number(hit.dataset.col) } : null
  }
  const dragging = React.useRef(false)
  const late = useLate(loading)
  const dimmed = late && n > 0
  const rendered = error ? [] : [...new Set([...Array.from({ length: Math.max(0, last - first) }, (_, i) => first + i), ...(n ? [active.row] : [])])].filter((i) => i < n)
  const editCol = editing ? cols[editing.col] : null
  const options = editCol?.options?.filter((o) => o.includes(editing!.text) || editing!.pick !== undefined) ?? []

  return (
    <div data-slot="data-grid" className={cn("@container/grid grid min-w-0 gap-2", className)}>
      <div className="flex min-w-0 items-center">
        <span className="mr-auto text-sm text-fg-muted tabular-nums" aria-live="polite">{`${n.toLocaleString("zh-CN")} 行`}</span>
          <Tooltip content="撤销" side="top">
            <Button variant="ghost" size="icon" aria-label="撤销" disabled={!canUndo} onClick={() => doUndo(true)} data-slot="data-grid-undo">
              <Undo2 aria-hidden className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip content="重做" side="top">
            <Button variant="ghost" size="icon" className="edge-end" aria-label="重做" disabled={!canRedo} onClick={() => doUndo(false)} data-slot="data-grid-redo">
              <Redo2 aria-hidden className="size-4" />
            </Button>
          </Tooltip>
      </div>
      <div
        ref={scroller}
        role="grid"
        tabIndex={0}
        aria-label={label}
        aria-rowcount={n + 1}
        aria-colcount={cols.length}
        aria-multiselectable
        aria-busy={loading || undefined}
        aria-activedescendant={n && !editing ? `${uid}-${active.row}-${active.col}` : undefined}
        data-slot="data-grid-scroller"
        onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight, width: e.currentTarget.clientWidth })}
        onKeyDown={onKeyDown}
        onFocus={() => setEngaged(true)}
        onMouseDown={(e) => {
          // Shift 点扩选：不让浏览器顺手把表格外的字也选成一片
          if (!e.shiftKey) return
          e.preventDefault()
          scroller.current?.focus({ preventScroll: true })
        }}
        onCopy={onCopy}
        onPaste={onPaste}
        onPointerDown={(e) => {
          if (e.pointerType === "touch" || e.button !== 0) return
          const c = cellAt(e.clientX, e.clientY)
          if (!c || (editing && c.row === editing.row && c.col === editing.col)) return
          if (editing) commitEdit()
          dragging.current = true
          select(c, e.shiftKey)
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return
          const c = cellAt(e.clientX, e.clientY)
          if (c && (c.row !== active.row || c.col !== active.col)) setActive(c)
        }}
        onPointerUp={() => (dragging.current = false)}
        onClick={(e) => {
          if ((e.nativeEvent as PointerEvent).pointerType !== "touch") return
          const c = cellAt(e.clientX, e.clientY)
          if (!c) return
          if (c.row === active.row && c.col === active.col && !editing) startEdit(c)
          else select(c)
        }}
        onDoubleClick={(e) => {
          const c = cellAt(e.clientX, e.clientY)
          if (c) startEdit(c)
        }}
        className="relative min-w-0 overflow-auto rounded-sm border border-line bg-canvas text-sm outline-none select-none focus-visible:focus-ring-zone [--grid-narrow:0] @max-[560px]/grid:[--grid-narrow:1]"
        style={{ maxHeight }}
      >
        <div className="relative" style={{ width: totalW, height: HEAD + Math.max(n, error || !n ? 5 : 0) * ROW }}>
          <div role="row" aria-rowindex={1} className="sticky top-0 z-20 flex border-b border-line bg-sidebar" style={{ width: totalW, height: HEAD }}>
            <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-sidebar" style={{ width: GUTTER }} />
            {cols.map((c, j) => (
              <div
                key={c.key}
                role="columnheader"
                aria-colindex={j + 1}
                aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                className={cn("flex shrink-0 items-stretch border-r border-line bg-sidebar", j === cols.length - 1 && "border-r-0", c.pinned && "sticky z-10", c.pinned && !cols[j + 1]?.pinned && "border-r-line-strong")}
                style={{ width: widths[j], left: c.pinned ? stick[j] : undefined }}
              >
                <button
                  type="button"
                  aria-label={`按${c.label}排序`}
                  data-slot="data-grid-sort"
                  onClick={() => sortBy(c.key)}
                  className={cn("relative hit-area flex min-w-0 flex-1 items-center gap-1 px-3 text-xs font-medium text-fg-muted outline-none hover:text-fg focus-visible:focus-ring", M.isNumeric(c) && "flex-row-reverse")}
                >
                  <span className="truncate">{c.label}</span>
                  {sort?.key === c.key ? sort.dir === "asc" ? <ArrowUp aria-hidden className="size-4 shrink-0" /> : <ArrowDown aria-hidden className="size-4 shrink-0" /> : null}
                </button>
              </div>
            ))}
          </div>
          <div className={cn("transition-opacity ease-ds", "duration-(--ds-dur-fast)", dimmed && "opacity-40")}>
            {rendered.map((i) => (
              <DataGridBodyRow
                key={view[i].id}
                ref={(el) => {
                  if (el) rowEls.current.set(view[i].id, el)
                  else rowEls.current.delete(view[i].id)
                }}
                id={uid}
                row={view[i]}
                index={i}
                count={n}
                top={HEAD + i * ROW}
                height={ROW}
                gutter={GUTTER}
                width={totalW}
                columns={cols}
                widths={widths}
                stick={stick}
                range={engaged ? range : null}
                active={engaged ? active : null}
                editing={editing}
                options={options}
                onEdit={setEditing}
                onCommit={commitEdit}
                onCancel={cancelEdit}
              />
            ))}
          </div>
          <DataGridState top={HEAD} height={ROW * 2} error={error} onRetry={onRetry} loading={loading} late={late} empty={!n} emptyLabel={emptyLabel} />
        </div>
      </div>
      {/* 表格是可聚焦的区，焦点环 focus-ring-zone 外伸 8（DESIGN.md §4.3）：底栏和表格隔 gap 8 时环正好压在「A1」的行盒上，
          再让 6，字离环 6（同区内的字离环）。一直占位（未碰过时 invisible），聚焦时不跳。 */}
      <div className={cn("pt-1.5", !engaged && "invisible")}>
        <DataGridStatus rows={view} cols={cols} range={range} />
      </div>
      <span className="sr-only" aria-live="polite">
        {loading ? "正在加载" : said}
      </span>
    </div>
  )
}

export { DataGrid }
export type { DataGridProps }
export type { DataGridColumn, DataGridRow, SortState as DataGridSort } from "@/components/ui/data-grid-model"
