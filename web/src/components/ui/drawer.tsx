"use client"

import { nextFrame } from "@/components/ui/frame"

import * as React from "react"
import { X } from "lucide-react"
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  usePresence,
  useReducedMotion,
  useTransform,
  type AnimationPlaybackControls,
} from "motion/react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { useDensityProps } from "@/components/ui/density"
import { EXIT, FROM_FIRST_FRAME, SPRINGS, exitFallbackMs } from "@/components/ui/ease"
import { Elevated, ELEVATION } from "@/components/ui/elevated"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { useGeometryInvariant } from "@/components/ui/invariant"
import { PopupContext, useOpenState, usePopup } from "@/components/ui/popup"
import { rubberband } from "@/components/ui/stretch"

/**
 * 抽屉：距视口边缘 --ds-gutter 的浮动面板，用于边看列表边做的次要任务（筛选、编辑、设置；DESIGN.md §2.4）。
 * 左右宽 400，底部最宽 640；内边距按宽度算（400 时 24），圆角 rounded-card。
 * 面（DESIGN.md §4.1「面的层级」）：比所在层高 4 层（Elevated + ELEVATION.dialog），浅色白底、阴影随层；
 * 在 Density 区域里打开时内容带上那一档（useDensityProps）。
 * 动效（DESIGN.md K3、§4.2；抽屉是 moderate 档：临界阻尼，落点不过冲，贴边那一侧不会弹出缝）：
 * - 点开 → 从所在那条边滑进来，SPRINGS.moderate（0.16s、不回弹），从第一帧开始计时（FROM_FIRST_FRAME：挂载的长任务不算进动画）；
 *   遮罩的浓淡由面板位置算出，和位移同拍。
 * - 关闭（关闭按钮、点遮罩、DrawerClose）→ 不回放进场：EXIT.moderate（0.12s 短过渡）退回同一条边；退场途中再打开，从当前位置接着回来。
 * - 拖拽 → 沿关闭方向按住拖，面板 1:1 跟手（直接写位置，不经弹簧）；往里拖是橡皮筋（stretch.ts）。
 *   松手时速度超过 0.4px/ms 或拖过自身 25% 就关：带着手势速度用 SPRINGS.moderate 退出去（手势的动量不断，所以这里用弹簧不用短过渡）；
 *   否则带着速度用 SPRINGS.moderate 弹回原位。进出途中也能一把抓住。
 *   输入框、文字选区、自己处理拖动的控件（touch-action: none，如开关、滑块）不触发拖拽；底部抽屉内容在滚动时让给滚动。
 * - 卸载兜底：关闭后 exitFallbackMs(EXIT.moderate)（220ms）一定卸载，不等动画回调（后台标签页停住 rAF 时遮罩和滚动锁不会留下）。
 * - 键盘打开 / Esc 关闭 → 0ms。
 * - 减少动态 → 组件自己读 useReducedMotion()：不位移，面板和遮罩淡入 fast / 淡出 EXIT.fast；拖拽照常跟手，松手弹回直接到位。
 */
const DrawerTrigger = DialogPrimitive.Trigger
const DrawerClose = DialogPrimitive.Close

const SIDE = {
  right: "top-(--ds-gutter) right-(--ds-gutter) bottom-(--ds-gutter) w-[calc(100%_-_2*var(--ds-gutter))] max-w-[400px] touch-pan-y [--ds-inset-basis:min(400px,100vw-16px)]",
  left: "top-(--ds-gutter) bottom-(--ds-gutter) left-(--ds-gutter) w-[calc(100%_-_2*var(--ds-gutter))] max-w-[400px] touch-pan-y [--ds-inset-basis:min(400px,100vw-16px)]",
  bottom: "right-(--ds-gutter) bottom-(--ds-gutter) left-(--ds-gutter) mx-auto max-h-[80vh] max-w-[640px] [--ds-inset-basis:min(640px,100vw-16px)]",
} as const
/** 关闭方向：沿哪根轴、朝正还是负 */
const TOWARD = { right: ["x", 1], left: ["x", -1], bottom: ["y", 1] } as const

const FLICK = 0.4 // 松手速度超过它（px/ms）就按方向关闭或弹回
const CLOSE_AT = 0.25 // 慢慢拖过自身尺寸的 25% 就关
const SLOP = 4 // 移动超过 4px 才算拖，之内仍是点击
const SHADOW = 24 // 退出时多走一段，让阴影也离开视口
const PARKED = 1e4 // 量到尺寸之前先停在视口外
/** 退场途中不再接收指针。只在退场时才写这个键：写成 undefined 也会盖掉 Radix 给模态内容加的 pointer-events: auto */
const EXITING = { pointerEvents: "none" } as const

function Drawer({ open, defaultOpen, onOpenChange, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const state = useOpenState(open, defaultOpen, onOpenChange)
  return (
    <PopupContext value={state}>
      <DialogPrimitive.Root {...props} open={state.open} onOpenChange={state.setOpen} />
    </PopupContext>
  )
}

type DrawerContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: keyof typeof SIDE
  title: React.ReactNode
  description?: React.ReactNode
}

/** 关闭后多久一定卸载（不等动画回调）：退场最长的一条是 EXIT.moderate（甩出去的弹簧更快落定） */
const FALLBACK_MS = exitFallbackMs(EXIT.moderate)

function DrawerContent(props: DrawerContentProps) {
  const { open } = usePopup()
  return <AnimatePresence>{open ? <DrawerPanel key="drawer" {...props} /> : null}</AnimatePresence>
}

/**
 * 按下的位置能不能开始拖：输入框和自己处理拖动的控件不抢，有文字选区时不抢。
 * 左右抽屉沿横向拖：里面横向自己会拖的东西（touch-action: pan-y——滑动行、横向滑块、分段切换）也不抢，
 * 不然抽屉先过 4px 门槛把指针抓走，行滑不开（2026-10-02 购物车抽屉里左滑移除踩过）。
 */
function canDrag(target: EventTarget, root: HTMLElement, axis: "x" | "y") {
  if (window.getSelection()?.toString()) return false
  for (let el = target as HTMLElement | null; el && el !== root; el = el.parentElement) {
    if (el.matches("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return false
    const touch = getComputedStyle(el).touchAction
    if (touch === "none" || (axis === "x" && touch === "pan-y")) return false
  }
  return true
}

function DrawerPanel({ className, side = "right", title, description, children, onPointerDown, onOpenAutoFocus, ...props }: DrawerContentProps) {
  const { setOpen } = usePopup()
  const [present, safeToRemove] = usePresence()
  const reduce = useReducedMotion()
  const [axis, sign] = TOWARD[side]
  const node = React.useRef<HTMLDivElement>(null)
  // off：沿关闭方向离开原位的距离，0 = 打开，closed = 完全在视口外
  const off = useMotionValue(PARKED)
  const fade = useMotionValue(1)
  const closed = React.useRef(PARKED)
  const size = React.useRef(PARKED)
  const pos = useTransform(off, (v) => v * sign)
  const scrim = useTransform(() => fade.get() * Math.min(1, Math.max(0, 1 - off.get() / closed.current)))
  const running = React.useRef<AnimationPlaybackControls[]>([])
  const run = (...next: AnimationPlaybackControls[]) => {
    running.current.forEach((a) => a.stop())
    running.current = next
  }
  const fling = React.useRef<number | null>(null) // 拖拽松手关闭时的速度（px/s），交给退场
  const alive = React.useRef(present)
  alive.current = present
  const drag = React.useRef<{ x: number; y: number; from: number; live: boolean; trail: [number, number][] } | null>(null)
  const dragged = React.useRef(false)
  const [scrollable, setScrollable] = React.useState(false)
  const density = useDensityProps()

  const enter = () => {
    if (fromKeyboard()) {
      run()
      off.set(0)
      fade.set(1)
    } else run(animate(off, 0, { ...SPRINGS.moderate, ...FROM_FIRST_FRAME }), animate(fade, 1, { ...SPRINGS.fast, ...FROM_FIRST_FRAME }))
  }
  const latest = React.useRef({ reduce, side, axis, sign, enter })
  latest.current = { reduce, side, axis, sign, enter }
  const observer = React.useRef<ResizeObserver | null>(null)

  // 面板挂进 Portal 的那一刻（Portal 比本组件晚一拍挂载）：量尺寸，停到视口外，开始进场。
  // 开发模式的 StrictMode 会对同一个元素再挂一次 ref，那一次只重新接上尺寸监听。
  const entered = React.useRef<HTMLDivElement | null>(null)
  const pendingEnter = React.useRef<(() => void) | undefined>(undefined)
  React.useEffect(() => () => pendingEnter.current?.(), [])
  const attach = React.useCallback((el: HTMLDivElement | null) => {
    node.current = el
    observer.current?.disconnect()
    if (!el) return
    const { reduce, side, axis, sign, enter } = latest.current
    if (entered.current !== el) {
      entered.current = el
      // 等这一轮提交做完（motion 在挂载时会按渲染时的值再写一次样式）再量、再摆到视口外，赶在下一帧之前
      queueMicrotask(() => {
        if (!el.isConnected) return
        // 全用布局尺寸算（不受此刻的位移影响）：退到视口外 = 自身尺寸 + 离边的距离 + 阴影
        const css = getComputedStyle(el)
        size.current = axis === "x" ? el.offsetWidth : el.offsetHeight
        closed.current = size.current + (parseFloat(css[side]) || 0) + SHADOW
        const keyboard = fromKeyboard()
        const start = keyboard || reduce ? 0 : closed.current
        off.jump(start) // jump：摆位置不带速度（set 会把 10000 → 实际位置算成一个巨大的速度，交给进场弹簧）
        el.style.transform = `translate${axis.toUpperCase()}(${start * sign}px)` // motion 下一帧才写样式，先同步写上
        fade.jump(reduce && !keyboard ? 0 : 1)
        pendingEnter.current?.()
        if (keyboard) enter()
        else pendingEnter.current = nextFrame(enter)
      })
    }
    // 底部抽屉：内容放得下时触屏也能拖；要滚动时把竖向手势让给滚动
    if (side !== "bottom") return
    observer.current = new ResizeObserver(() => setScrollable(el.scrollHeight > el.clientHeight + 1))
    observer.current.observe(el)
    for (const child of el.children) observer.current.observe(child)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const first = React.useRef(true)
  React.useEffect(() => {
    if (!present) pendingEnter.current?.()
    if (first.current) {
      first.current = false
      return
    }
    if (present) {
      if (fromKeyboard()) { off.jump(0); fade.jump(1); return }
      return nextFrame(enter) // 退场途中又打开：保留当前位置与速度
    }
    const v = fling.current
    fling.current = null
    if (fromKeyboard()) {
      run()
      // 等本轮提交结束再移除（同步调用会被 AnimatePresence 忽略，见 DESIGN.md §5.3）
      queueMicrotask(() => safeToRemove())
      return
    }
    // 兜底：退场动画靠 rAF，后台标签页里等不到，遮罩和滚动锁会留下；到点一定交还移除
    const fallback = window.setTimeout(() => !alive.current && safeToRemove(), FALLBACK_MS)
    const cancel = nextFrame(() => {
      const exit = reduce
        ? animate(fade, 0, EXIT.fast)
        : // 点按钮 / 遮罩关闭：短过渡退场；拖拽松手：带着手势速度的弹簧，动量不断
          animate(off, closed.current, v === null ? EXIT.moderate : { ...SPRINGS.moderate, velocity: v })
      run(exit)
      exit.then(() => !alive.current && (window.clearTimeout(fallback), safeToRemove()))
    })
    return () => (window.clearTimeout(fallback), cancel())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present])

  React.useEffect(
    () => () => {
      running.current.forEach((a) => a.stop())
      observer.current?.disconnect()
    },
    []
  )

  const press = (e: React.PointerEvent<HTMLDivElement>) => {
    onPointerDown?.(e)
    dragged.current = false
    if (e.button !== 0 || !e.isPrimary || !present || !canDrag(e.target, e.currentTarget, axis)) return
    drag.current = { x: e.clientX, y: e.clientY, from: off.get(), live: false, trail: [] }
  }
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const along = (axis === "x" ? e.clientX - d.x : e.clientY - d.y) * sign // 正 = 朝关闭方向
    const across = axis === "x" ? e.clientY - d.y : e.clientX - d.x
    if (!d.live) {
      if (Math.hypot(along, across) < SLOP) return
      const el = e.currentTarget
      const scrolls = axis === "y" && (along > 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1)
      if (Math.abs(across) > Math.abs(along) || scrolls) {
        drag.current = null
        return
      }
      d.live = true
      run() // 进出途中也能抓住：从当前位置接着跟手
      d.from = off.get()
      el.setPointerCapture(e.pointerId)
      el.style.userSelect = "none"
      window.getSelection()?.removeAllRanges()
    }
    const raw = d.from + along
    const next = raw >= 0 ? raw : rubberband(raw, 0, Infinity, size.current / 4)
    off.set(next)
    d.trail.push([e.timeStamp, next])
    while (d.trail.length > 2 && e.timeStamp - d.trail[0][0] > 100) d.trail.shift()
  }
  const release = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d?.live) return
    dragged.current = true
    e.currentTarget.style.userSelect = ""
    // 最近 100ms 的平均速度（px/ms，正 = 朝关闭方向）；停住再松手时是 0
    const [t0, v0] = d.trail[0] ?? [0, 0]
    const [t1, v1] = d.trail.at(-1) ?? [0, 0]
    const idle = e.timeStamp - t1 > 60
    const v = idle || t1 === t0 ? 0 : (v1 - v0) / (t1 - t0)
    if (v > FLICK || (v > -FLICK && off.get() > size.current * CLOSE_AT)) {
      fling.current = v * 1000
      setOpen(false)
    } else if (reduce) {
      run()
      off.set(0)
    } else run(animate(off, 0, { ...SPRINGS.moderate, velocity: v * 1000 }))
  }

  return (
    <DialogPrimitive.Portal forceMount>
      <DialogPrimitive.Overlay forceMount asChild>
        <motion.div
          data-slot="drawer-overlay"
          className="fixed inset-0 z-50 bg-scrim scrim-blur"
          style={{ opacity: scrim, ...(present ? null : EXITING) }}
        />
      </DialogPrimitive.Overlay>
      {/* 没有说明时显式不挂 aria-describedby（Radix 否则会提示缺少 Description） */}
      {/* 调用方阻止了自动聚焦、自己也没把焦点放进面板时，焦点仍要进到面板本身：
          否则焦点留在后面的触发按钮上，Tab 直接走到被遮住的页面里（2026-10-06 抽屉默认示例踩过） */}
      <Elevated asChild {...ELEVATION.dialog}>
      <DialogPrimitive.Content
        forceMount
        asChild
        {...(description ? null : { "aria-describedby": undefined })}
        {...props}
        onOpenAutoFocus={(e) => {
          onOpenAutoFocus?.(e)
          if (e.defaultPrevented && !node.current?.contains(document.activeElement)) node.current?.focus({ preventScroll: true })
        }}
      >
        <motion.div
          ref={attach}
          data-slot="drawer-content"
          {...density}
          data-inset
          data-surface
          className={cn(
            "fixed z-50 flex flex-col gap-group overflow-y-auto rounded-card p-inset text-fg outline-none",
            SIDE[side],
            side === "bottom" && (scrollable ? "touch-pan-y" : "touch-none"),
            className
          )}
          style={{ [axis]: pos, opacity: fade, ...(present ? null : EXITING) }}
          onPointerDown={press}
          onPointerMove={move}
          onPointerUp={release}
          onPointerCancel={release}
          // 拖过的这一下不算点击（按下的地方可能是按钮）
          onClickCapture={(e) => {
            if (!dragged.current) return
            dragged.current = false
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          {/* 标题行与右上角的关闭按钮同一中线；按钮图标的线条对齐右侧内容线（内边距处）。只有标题行给关闭按钮让 32（同 Dialog）。
              列宽 minmax(0,1fr)：说明里截断的长文本（长邮箱）不能把列撑出内容线（2026-10-06 user-menu 390 实测伸到 370，内容线 358） */}
          <DrawerHeading>
            <DialogPrimitive.Title className="flex min-h-(--ds-h-md) min-w-0 items-center pr-8 text-lg font-semibold">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="min-w-0 text-sm text-fg-muted">{description}</DialogPrimitive.Description> : null}
          </DrawerHeading>
          {children}
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" className="absolute top-inset right-[calc(var(--ds-inset)-(var(--ds-h-md)-16px)/2-3px)]" aria-label="关闭">
              <X />
            </Button>
          </DialogPrimitive.Close>
        </motion.div>
      </DialogPrimitive.Content>
      </Elevated>
    </DialogPrimitive.Portal>
  )
}

/** 标题区里的东西不许伸出内容线：伸出时开发环境崩溃 */
function inColumn(el: HTMLElement) {
  const box = el.getBoundingClientRect()
  const over = Math.max(...[...el.querySelectorAll("*")].map((child) => child.getBoundingClientRect().right)) - box.right
  return over > 0.5 ? `抽屉标题区有内容伸出右侧内容线 ${over.toFixed(1)}px：长文本要能截断或折行` : null
}

function DrawerHeading({ children }: { children: React.ReactNode }) {
  const node = React.useRef<HTMLDivElement>(null)
  useGeometryInvariant("Drawer", node, inColumn)
  return <div ref={node} className="grid grid-cols-[minmax(0,1fr)] gap-2">{children}</div>
}

/** 底部操作区：贴在面板底部，确认类按钮放最右。 */
function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mt-auto flex justify-end gap-2", className)} {...props} />
}

export { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerTrigger }
