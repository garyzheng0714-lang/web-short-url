"use client"

import * as React from "react"

import * as M from "@/components/ui/data-grid-model"

/**
 * 数据表格的改值（和 data-grid 一起装）：撤销 / 重做栈（100 步）、改一格、清空、向下填充、复制、粘贴。
 * 边界：这里只算「要改哪些格、改成什么」并记撤销；行怎么存（受控回传或表格自己存）由 commit 决定，
 * 选区、活动格、编辑框归 data-grid，粘贴后要选中贴进去的那一块时调 selectRange。纯函数（解析、剪贴板格式、应用改动）在 data-grid-model。
 * 没有动效：改值是高频操作，0ms（DESIGN.md §5.1）。
 */
type GridEditsInput = {
  rows: M.DataGridRow[]
  /** 按当前排序排好的行：格子坐标按它算 */
  view: M.DataGridRow[]
  cols: M.DataGridColumn[]
  range: M.Range
  /** 正在编辑某一格时，复制粘贴交给编辑框 */
  editing: boolean
  commit: (rows: M.DataGridRow[]) => void
  /** 读屏播报 */
  say: (message: string) => void
  selectRange: (from: M.Cell, to: M.Cell) => void
}

function useGridEdits({ rows, view, cols, range, editing, commit, say, selectRange }: GridEditsInput) {
  const n = view.length
  const undo = React.useRef<M.Change[][]>([])
  const redo = React.useRef<M.Change[][]>([])
  // 栈放在 ref 里（改值时同步可读），换一次版本让撤销 / 重做按钮跟着亮灭
  const [, bump] = React.useState(0)

  /** 改值：整份新行回传；记一步撤销 */
  const write = (changes: M.Change[], message: string, record: "do" | "undo" | "redo" = "do") => {
    if (!changes.length) return say(message)
    commit(M.applyChanges(rows, changes, record === "undo"))
    if (record === "do") {
      undo.current = [...undo.current.slice(-99), changes]
      redo.current = []
    } else if (record === "undo") redo.current = [...redo.current, changes]
    else undo.current = [...undo.current, changes]
    bump((v) => v + 1)
    say(message)
  }
  const editable = (col: number) => cols[col]?.editable !== false
  const setCell = (row: number, col: number, value: unknown): M.Change | null => {
    const r = view[row]
    const c = cols[col]
    if (!r || !c || !editable(col) || Object.is(r[c.key], value) || (r[c.key] == null && value == null)) return null
    return { id: r.id, key: c.key, before: r[c.key] ?? null, after: value }
  }

  const eachCell = (r: M.Range, fn: (row: number, col: number) => void) => {
    for (let i = r.r0; i <= r.r1; i++) for (let j = r.c0; j <= r.c1; j++) fn(i, j)
  }
  const clear = () => {
    const changes: M.Change[] = []
    eachCell(range, (i, j) => {
      const ch = setCell(i, j, null)
      if (ch) changes.push(ch)
    })
    write(changes, `清空了 ${changes.length} 格`)
  }
  const fillDown = () => {
    const changes: M.Change[] = []
    eachCell({ ...range, r0: range.r0 + 1 }, (i, j) => {
      const ch = setCell(i, j, view[range.r0][cols[j].key] ?? null)
      if (ch) changes.push(ch)
    })
    write(changes, `向下填充了 ${changes.length} 格`)
  }
  const doUndo = (back: boolean) => {
    const stack = back ? undo : redo
    const step = stack.current[stack.current.length - 1]
    if (!step) return say(back ? "没有可撤销的" : "没有可重做的")
    stack.current = stack.current.slice(0, -1)
    write(step, `${back ? "撤销" : "重做"}了 ${step.length} 格`, back ? "undo" : "redo")
  }
  const onCopy = (e: React.ClipboardEvent) => {
    if (editing || !n) return
    e.preventDefault()
    const clip = M.toClipboard(view, cols, range)
    e.clipboardData.setData("text/plain", clip.text)
    e.clipboardData.setData("text/html", clip.html)
    say(`复制了 ${(range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1)} 格`)
  }
  const onPaste = (e: React.ClipboardEvent) => {
    if (editing || !n) return
    e.preventDefault()
    const grid = M.parseTsv(e.clipboardData.getData("text/plain"))
    const h = grid.length
    const w = Math.max(...grid.map((r) => r.length))
    const selH = range.r1 - range.r0 + 1
    const selW = range.c1 - range.c0 + 1
    // 选区是剪贴板的整数倍：平铺满选区；否则从选区左上角贴出剪贴板那么大，越界的裁掉
    const tile = selH % h === 0 && selW % w === 0 && selH * selW > h * w
    const target = { r0: range.r0, c0: range.c0, r1: Math.min(n - 1, range.r0 + (tile ? selH : h) - 1), c1: Math.min(cols.length - 1, range.c0 + (tile ? selW : w) - 1) }
    const changes: M.Change[] = []
    let skipped = 0
    eachCell(target, (i, j) => {
      const text = grid[(i - target.r0) % h]?.[(j - target.c0) % w] ?? ""
      const parsed = M.parseCell(cols[j], text)
      if (!editable(j) || !parsed.ok) return void skipped++
      const ch = setCell(i, j, parsed.value)
      if (ch) changes.push(ch)
    })
    selectRange({ row: target.r0, col: target.c0 }, { row: target.r1, col: target.c1 })
    write(changes, `粘贴了 ${changes.length} 格${skipped ? `，跳过 ${skipped} 格（只读或格式不对）` : ""}`)
  }

  return { write, setCell, editable, clear, fillDown, doUndo, onCopy, onPaste, canUndo: undo.current.length > 0, canRedo: redo.current.length > 0 }
}

export { useGridEdits }
