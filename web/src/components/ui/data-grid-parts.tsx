import * as React from "react"
import { CircleAlert } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ELEVATION, Elevated } from "@/components/ui/elevated"
import * as M from "@/components/ui/data-grid-model"
import { Skeleton } from "@/components/ui/skeleton"

type DataGridProps = {
  columns: M.DataGridColumn[]
  rows: M.DataGridRow[]
  /** 改了值（编辑、粘贴、清空、填充、撤销）就回传整份新行；不传时表格自己存着 */
  onRowsChange?: (rows: M.DataGridRow[]) => void
  label: string
  maxHeight?: number
  defaultSort?: M.SortState
  loading?: boolean
  error?: React.ReactNode
  onRetry?: () => void
  emptyLabel?: string
  className?: string
}

/**
 * 数据表格的部件（和 data-grid 一起装）：表体的一行、单元格编辑框（选项列带一个选项列表）、表体里的加载 / 空 / 出错、底栏（地址 · 计数 · 求和）。
 * 都不动（DESIGN.md §4.2：编辑是高频操作，0ms）；选项列表即时出现在格子下面 4，是一个弹层（Elevated +2，底色与阴影随所在层），行高与控件同档（36 · 28）。
 */

type Editing = { row: number; col: number; text: string; invalid?: boolean; pick?: number }

/** 窄容器固定区最多一半；非固定列保持声明的列宽，以横滚保留完整数字。编辑、选择与 reveal 共用这份实际列宽。 */
function useGridWidths(node: React.RefObject<HTMLDivElement | null>, columns: M.DataGridColumn[], gutter: number) {
  const [space, setSpace] = React.useState({ width: 0, narrow: false })
  React.useLayoutEffect(() => {
    const el = node.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const next = { width: el.clientWidth, narrow: getComputedStyle(el).getPropertyValue("--grid-narrow").trim() === "1" }
      setSpace((prev) => prev.width === next.width && prev.narrow === next.narrow ? prev : next)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [node])
  const widths = columns.map(M.widthOf)
  if (!space.narrow || !space.width) return widths
  const pinned = columns.reduce((sum, c, i) => sum + (c.pinned ? widths[i] : 0), 0)
  const scale = pinned ? Math.min(1, Math.max(0, space.width / 2 - gutter) / pinned) : 1
  return widths.map((w, i) => columns[i].pinned ? w * scale : w)
}

/** 400ms 后才为真（DESIGN.md §4.1 加载）：400ms 内结束的加载什么都不显示 */
function useLate(on: boolean) {
  const [late, setLate] = React.useState(false)
  React.useEffect(() => {
    if (!on) return setLate(false)
    const t = window.setTimeout(() => setLate(true), 400)
    return () => window.clearTimeout(t)
  }, [on])
  return on && late
}

/** 编辑框：盖在格子上（2px 聚焦色内框，解析不了时 danger）；输入法组字中的按键一律不处理 */
function DataGridEditor({
  id,
  column,
  row,
  edit,
  options,
  onEdit,
  onCommit,
  onCancel,
}: {
  id: string
  column: M.DataGridColumn
  row: number
  edit: Editing
  options: string[]
  onEdit: (next: Editing) => void
  onCommit: (move?: M.Cell, text?: string) => void
  onCancel: () => void
}) {
  const c = column
  const { row: i, col: j } = edit
  return (
    <>
      <input
        autoFocus
        aria-label={`${c.label}，第 ${row + 1} 行`}
        aria-invalid={edit.invalid || undefined}
        role={c.options ? "combobox" : undefined}
        aria-expanded={c.options ? true : undefined}
        aria-controls={c.options ? `${id}-options` : undefined}
        aria-activedescendant={c.options && edit.pick !== undefined ? `${id}-opt-${edit.pick}` : undefined}
        data-slot="data-grid-editor"
        value={edit.text}
        onChange={(e) => onEdit({ ...edit, text: e.target.value, invalid: false, pick: c.options ? 0 : undefined })}
        onBlur={() => onCommit()}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (c.options && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault()
            return onEdit({ ...edit, pick: Math.min(options.length - 1, Math.max(0, (edit.pick ?? 0) + (e.key === "ArrowDown" ? 1 : -1))) })
          }
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault()
            const to = e.key === "Enter" ? { row: i + (e.shiftKey ? -1 : 1), col: j } : { row: i, col: j + (e.shiftKey ? -1 : 1) }
            return onCommit(to, c.options && edit.pick !== undefined ? options[edit.pick] : undefined)
          }
          if (e.key === "Escape") {
            e.preventDefault()
            onCancel()
          }
        }}
        className={cn(
          "absolute inset-0 z-10 min-w-0 bg-card px-3 text-md text-fg outline-none select-text",
          M.isNumeric(c) && "text-right tabular-nums",
          edit.invalid ? "shadow-[inset_0_0_0_2px_var(--color-danger)]" : "shadow-[inset_0_0_0_2px_var(--color-focus)]"
        )}
      />
      {c.options ? (
        <Elevated asChild {...ELEVATION.popover}>
        <div id={`${id}-options`} role="listbox" aria-label={c.label} data-slot="data-grid-options" className="absolute top-full left-0 z-30 mt-1 grid min-w-full gap-px rounded-popover p-(--ds-pad-popover)">
          {options.map((o, k) => (
            <div
              key={o}
              id={`${id}-opt-${k}`}
              role="option"
              aria-selected={edit.pick === k}
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onCommit({ row: i + 1, col: j }, o)
              }}
              className={cn("flex h-(--ds-h-md) items-center rounded-popover-item px-(--ds-pad-row) text-(length:--ds-text-control) leading-(--ds-lh-control) whitespace-nowrap", edit.pick === k && "bg-hover")}
            >
              {o}
            </div>
          ))}
        </div>
        </Elevated>
      ) : null}
    </>
  )
}

/** 表体里的状态（表头不动）：出错一句话 + 重试；没有行时加载 400ms 后出骨架；空是一句话 */
function DataGridState({ top, height, error, onRetry, loading, late, empty, emptyLabel }: { top: number; height: number; error?: React.ReactNode; onRetry?: () => void; loading: boolean; late: boolean; empty: boolean; emptyLabel: string }) {
  if (error)
    return (
      <div data-slot="data-grid-error" className="absolute left-0 flex w-full items-center gap-3 px-4 text-sm text-fg-muted" style={{ top, height }}>
        <CircleAlert aria-hidden className="size-4 shrink-0 text-danger" />
        {error === true ? "加载失败" : error}
        {onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            重试
          </Button>
        ) : null}
      </div>
    )
  if (!empty) return null
  if (loading)
    return late ? (
      <div className="absolute inset-x-0 grid gap-2 px-4 pt-3" style={{ top }}>
        {Array.from({ length: 4 }, (_, k) => (
          <Skeleton key={k} className="h-5" />
        ))}
      </div>
    ) : null
  return (
    <p data-slot="data-grid-empty" className="absolute left-0 m-0 flex items-center px-4 text-sm text-fg-muted" style={{ top, height }}>
      {emptyLabel}
    </p>
  )
}

/**
 * 底栏：选区地址（B3:D7）· 计数（非空格子）· 求和（数字列）。一行只用一种字体（地址也是无衬线 + 等宽数字）；
 * 选区里的数字列格式相同（同为金额、同样小数位）时，求和按那一列的格式写（¥21,200），混了格式才写纯数字。
 */
function DataGridStatus({ rows, cols, range }: { rows: M.DataGridRow[]; cols: M.DataGridColumn[]; range: M.Range }) {
  let total = 0
  let count = 0
  let unit: M.DataGridColumn | null | undefined
  if (rows.length)
    for (let i = range.r0; i <= range.r1; i++)
      for (let j = range.c0; j <= range.c1; j++) {
        const v = rows[i]?.[cols[j].key]
        if (v === null || v === undefined || v === "") continue
        count++
        if (!M.isNumeric(cols[j]) || typeof v !== "number") continue
        total += v
        const c = cols[j]
        unit = unit === undefined || (unit && unit.type === c.type && unit.decimals === c.decimals) ? (unit ?? c) : null
      }
  const sum = unit ? M.formatCell(unit, total) : total.toLocaleString("zh-CN", { maximumFractionDigits: 2 })
  return (
    <div data-slot="data-grid-status" aria-hidden className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-fg-muted tabular-nums">
      <span className="text-fg-muted">{rows.length ? M.address(range) : "—"}</span>
      {rows.length ? (
        <span className="flex gap-4">
          <span>
            计数 <span data-slot="data-grid-count" className="text-fg">{count.toLocaleString("zh-CN")}</span>
          </span>
          {unit !== undefined ? (
            <span>
              求和 <span data-slot="data-grid-sum" className="text-fg">{sum}</span>
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}

/**
 * 表体的一行：行号槽（吸左）+ 各列格子。选区用「选中」底（不透明，固定列滚动时盖得住下面的格子）；活动格自己留白，靠 2px 框认。
 * range / active 为 null：没碰过表格，不画选区和活动格。行的位置（top）和排序滑动的 transform 由 DataGrid 写。
 */
function DataGridBodyRow({
  ref,
  id,
  row: r,
  index: i,
  count: n,
  top,
  height,
  gutter,
  width,
  columns: cols,
  widths,
  stick,
  range,
  active,
  editing,
  options,
  onEdit,
  onCommit,
  onCancel,
}: {
  ref?: React.Ref<HTMLDivElement>
  id: string
  row: M.DataGridRow
  index: number
  count: number
  top: number
  height: number
  gutter: number
  width: number
  columns: M.DataGridColumn[]
  widths: number[]
  stick: number[]
  range: M.Range | null
  active: M.Cell | null
  editing: Editing | null
  options: string[]
  onEdit: (next: Editing | null) => void
  onCommit: (move?: M.Cell, text?: string) => void
  onCancel: () => void
}) {
  return (
    <div ref={ref} role="row" aria-rowindex={i + 2} data-slot="data-grid-row" data-id={r.id} className="absolute left-0 flex" style={{ top, height, width }}>
      <div aria-hidden className={cn("sticky left-0 z-10 flex shrink-0 items-center justify-center border-r border-b border-line bg-canvas text-xs text-fg-muted tabular-nums", i === n - 1 && "border-b-0")} style={{ width: gutter }}>
        {i + 1}
      </div>
      {cols.map((c, j) => {
        const sel = range ? M.inRange(range, i, j) : false
        const isActive = active ? active.row === i && active.col === j : false
        const edit = editing && editing.row === i && editing.col === j ? editing : null
        return (
          <div
            key={c.key}
            id={`${id}-${i}-${j}`}
            role="gridcell"
            aria-colindex={j + 1}
            aria-selected={sel}
            aria-readonly={c.editable === false || undefined}
            data-slot="data-grid-cell"
            data-row={i}
            data-col={j}
            data-active={isActive || undefined}
            className={cn(
              "relative flex shrink-0 items-center border-r border-b border-line px-3",
              sel && !isActive ? "bg-selected" : "bg-canvas",
              j === cols.length - 1 && "border-r-0",
              i === n - 1 && "border-b-0",
              c.pinned && "sticky z-5",
              c.pinned && !cols[j + 1]?.pinned && "border-r-line-strong",
              M.isNumeric(c) && "justify-end tabular-nums",
              c.editable === false ? "text-fg-muted" : "text-fg",
              isActive && "shadow-[inset_0_0_0_2px_var(--color-fg)]"
            )}
            style={{ width: widths[j], left: c.pinned ? stick[j] : undefined }}
          >
            <span className="truncate">{M.formatCell(c, r[c.key])}</span>
            {edit ? <DataGridEditor id={id} column={c} row={i} edit={edit} options={options} onEdit={onEdit} onCommit={onCommit} onCancel={onCancel} /> : null}
          </div>
        )
      })}
    </div>
  )
}

export { DataGridBodyRow, DataGridEditor, DataGridState, DataGridStatus, useLate, useGridWidths }
export type { Editing }

export type { DataGridProps }
