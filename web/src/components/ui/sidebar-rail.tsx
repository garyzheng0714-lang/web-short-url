import * as React from "react"

import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/tooltip"

/**
 * 侧栏的两条边（ui/sidebar 的部件，DESIGN.md §3.9、K3）：
 * - SidebarRail：展开时贴在侧栏右边线外侧的 8 宽把手（不伸进侧栏的滚动条槽），指上去边线亮起（line-strong，80ms）。
 *   拖动调宽，夹在 160–360（工具栏宽 400 时到 400）；往外拖过最小宽再 56 预演收起，拖回来取消，松手才算数；
 *   按下没移动 ≥ 4px 就是一次点击：收起。拖动 1:1 跟手（时长 0），由 ui/sidebar 按 resizing 选档。
 * - SidebarPeekStrip：收起后屏幕左边 12 宽的感应条，指上去细线亮起；鼠标停 150ms 浮出侧栏，离开 250ms 收回（计时器 usePeek，与收起时的触发器、浮出的卡共用）。
 * 只认鼠标的悬停；触屏、触控笔点一下感应条直接浮出。
 */
const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 360
/** 拖过最小宽这么多就预演收起（往边上一甩就关，原生应用的手势） */
const COLLAPSE_SLOP = 56
/** 按下后移动不到这么多算点击 */
const DRAG_SLOP = 4
/** 浮出：停多久算想看（意图），离开多久收回 */
const PEEK_INTENT = 150
const PEEK_DISMISS = 250

/**
 * 浮出的计时器：感应条、收起时的触发器、浮出的卡共用这一个，在它们之间移动会撤掉还没到点的收回。
 * Esc 收回后，原地不动的指针会因为卡被收走而收到一次补发的进入事件；指针真的移动超过 4px 才重新算意图。
 */
function usePeek(root: React.RefObject<HTMLElement | null>) {
  const [peeking, setPeeking] = React.useState(false)
  const timer = React.useRef<number | undefined>(undefined)
  const suppressed = React.useRef(false)
  const cancelPeekTimer = React.useCallback(() => window.clearTimeout(timer.current), [])
  const schedulePeek = React.useCallback(() => {
    window.clearTimeout(timer.current)
    if (suppressed.current) return
    timer.current = window.setTimeout(() => setPeeking(true), PEEK_INTENT)
  }, [])
  const scheduleDismissPeek = React.useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setPeeking(false), PEEK_DISMISS)
  }, [])
  const dismissPeek = React.useCallback((pointer: { x: number; y: number } | null) => {
    window.clearTimeout(timer.current)
    setPeeking(false)
    const doc = root.current?.ownerDocument
    if (!doc) return
    suppressed.current = true
    // 不知道指针在哪（收回前没动过）：第一次移动的位置当起点
    let from = pointer
    const onMove = (event: PointerEvent) => {
      from ??= { x: event.clientX, y: event.clientY }
      if (Math.hypot(event.clientX - from.x, event.clientY - from.y) <= 4) return
      suppressed.current = false
      doc.removeEventListener("pointermove", onMove)
    }
    doc.addEventListener("pointermove", onMove)
  }, [root])
  React.useEffect(() => () => window.clearTimeout(timer.current), [])
  return { peeking, setPeeking, timer, schedulePeek, scheduleDismissPeek, dismissPeek, cancelPeekTimer }
}

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

function SidebarPeekStrip({
  peeking,
  absolute,
  onIntent,
  onLeave,
  onPeek,
}: {
  peeking: boolean
  /** 外框模式：相对外框定位 */
  absolute: boolean
  /** 鼠标进来：开始 150ms 的意图计时 */
  onIntent: () => void
  /** 浮出之前离开：撤掉计时 */
  onLeave: () => void
  /** 点一下：立刻浮出 */
  onPeek: () => void
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label="浮出侧栏"
      aria-expanded={peeking}
      data-slot="sidebar-peek-strip"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") onIntent()
      }}
      onPointerLeave={() => {
        if (!peeking) onLeave()
      }}
      onClick={onPeek}
      className={cn(
        "group/peek top-(--ds-sidebar-top) bottom-0 left-0 z-40 w-3 cursor-pointer outline-none",
        absolute ? "absolute" : "fixed"
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-px bg-line-strong opacity-0 transition-opacity duration-(--ds-dur-fast) ease-ds group-hover/peek:opacity-100"
      />
    </button>
  )
}

export { COLLAPSE_SLOP, SIDEBAR_MAX, SIDEBAR_MIN, SidebarPeekStrip, SidebarRail, usePeek }
