"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/tooltip"

/**
 * 侧栏的两条边（ui/sidebar 的部件，DESIGN.md §3.9、K3）：
 * - SidebarRail：展开时贴在侧栏右边线外侧的 8 宽把手（不伸进侧栏的滚动条槽），指上去边线亮起（line-strong，80ms）。
 *   拖动调宽，夹在 160–360（工具栏宽 400 时到 400）；往外拖过最小宽再 56 预演收起，拖回来取消，松手才算数；
 *   按下没移动 ≥ 4px 就是一次点击：收起。拖动 1:1 跟手（时长 0），由 ui/sidebar 按 resizing 选档。
 * 不做收起后的悬停浮出（用户 2026-10-08：「鼠标移动到侧边栏为什么会自动弹出，这是什么垃圾」），原来的感应条与浮出计时已删。
 */
const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 360
/** 拖过最小宽这么多就预演收起（往边上一甩就关，原生应用的手势） */
const COLLAPSE_SLOP = 56
/** 按下后移动不到这么多算点击 */
const DRAG_SLOP = 4


function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="font-sans">{children}</kbd>
}

function SidebarRail({
  max,
  shortcut,
  panel,
  onWidth,
  onCollapse,
  onToggle,
  onResizing,
}: {
  /** 最宽：360，工具栏宽 400 时取 400 */
  max: number
  /** 提示里写的键位；null 不写 */
  shortcut: string | null
  /** 量起始宽度用的面板 */
  panel: React.RefObject<HTMLElement | null>
  onWidth: (px: number) => void
  /** 拖动途中预演收起 / 拖回展开 */
  onCollapse: (collapsed: boolean) => void
  /** 点一下：收起 */
  onToggle: () => void
  onResizing: (resizing: boolean) => void
}) {
  const drag = React.useRef<{ x: number; width: number; moved: boolean; collapsed: boolean } | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const end = () => {
    drag.current = null
    setDragging(false)
    onResizing(false)
  }
  return (
    <Tooltip
      side="right"
      open={dragging ? false : undefined}
      content={
        <>
          拖动调宽，点击收起
          {shortcut ? <Key>{shortcut}</Key> : null}
        </>
      }
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="调整侧栏宽度或收起"
        data-slot="sidebar-rail"
        data-dragging={dragging || undefined}
        onPointerDown={(e) => {
          if (e.button !== 0 || !panel.current) return
          drag.current = { x: e.clientX, width: panel.current.offsetWidth, moved: false, collapsed: false }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x
          if (!d.moved && Math.abs(dx) < DRAG_SLOP) return
          if (!d.moved) {
            d.moved = true
            setDragging(true)
            onResizing(true)
          }
          const raw = d.width + dx
          if (raw < SIDEBAR_MIN - COLLAPSE_SLOP) {
            if (!d.collapsed) {
              d.collapsed = true
              onWidth(SIDEBAR_MIN)
              onCollapse(true)
            }
            return
          }
          if (d.collapsed) {
            d.collapsed = false
            onCollapse(false)
          }
          onWidth(Math.max(SIDEBAR_MIN, Math.min(max, raw)))
        }}
        onPointerUp={(e) => {
          const d = drag.current
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
          end()
          if (d && !d.moved) onToggle()
        }}
        // 指针被打断（触屏手势、失去捕获）：停在原处，不当成点击
        onPointerCancel={end}
        className={cn(
          // 8 宽，整条在侧栏右边线外侧：命中范围在两栏之间，不伸进侧栏的滚动条槽（DESIGN.md §3.9）
          "absolute inset-y-0 left-full z-10 w-2 cursor-col-resize touch-none outline-none",
          "after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-line-strong after:opacity-0 after:transition-opacity after:duration-(--ds-dur-fast) after:ease-ds",
          "hover:after:opacity-100 data-dragging:after:opacity-100"
        )}
      />
    </Tooltip>
  )
}

export { COLLAPSE_SLOP, SIDEBAR_MAX, SIDEBAR_MIN, SidebarRail }
