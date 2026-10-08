"use client"

/**
 * Toast 手势：跟手、速度与甩出。通知生命周期留在 toaster.tsx（DESIGN.md §5）。
 * 动效（DESIGN.md §4.2）：拖动 1:1 跟手；甩出去带着松手速度走 SPRINGS.moderate（动量不断），同时 EXIT.moderate（0.12s）淡出；
 * 不够远、不够快就带着速度 SPRINGS.moderate 回到原位。减少动态时直接到位，只留淡出。
 */
import * as React from "react"
import { animate, type MotionValue } from "motion/react"
import { toast as sonner, type ToastT } from "sonner"
import { EXIT, SPRINGS } from "@/components/ui/ease"
import { rubberband } from "@/components/ui/stretch"
const SWIPE_DISTANCE = 45
const SWIPE_VELOCITY = 0.11

type SwipeOptions = { toast: ToastT; swipeX: MotionValue<number>; swipeY: MotionValue<number>; opacity: MotionValue<number>; natural: number; reduce: boolean | null; onFly: (fade: Promise<unknown>) => void }
function useSwipe({ toast: t, swipeX, swipeY, opacity, natural, reduce, onFly }: SwipeOptions) {
  const drag = React.useRef<{ x: number; y: number; t: number; axis: "x" | "y" | null; trail: [number, number][] } | null>(null)
  const [active, setActive] = React.useState(false)
  const pointer = React.useRef("mouse")
  const dragged = React.useRef(false)
  const locked = t.type === "loading" || t.dismissible === false

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    pointer.current = e.pointerType
    dragged.current = false
    if (e.button !== 0 || locked || (e.target as Element).closest("button, a, input, textarea")) return
    e.currentTarget.setPointerCapture(e.pointerId)
    swipeX.stop()
    swipeY.stop()
    drag.current = { x: e.clientX - swipeX.get(), y: e.clientY - swipeY.get(), t: performance.now(), axis: null, trail: [] }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || (window.getSelection()?.toString().length ?? 0) > 0) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.axis) {
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y"
      dragged.current = true
      setActive(true)
    }
    const v = d.axis === "x" ? dx : dy > 0 ? dy : rubberband(dy, 0, Infinity, natural || 40)
    ;(d.axis === "x" ? swipeX : swipeY).set(v)
    d.trail = [...d.trail.filter(([at]) => performance.now() - at < 80), [performance.now(), v]]
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d?.axis) return
    setActive(false)
    const mv = d.axis === "x" ? swipeX : swipeY
    const amount = mv.get()
    const first = d.trail[0]
    const last = d.trail.at(-1)
    // 松手那一刻的速度（px/s），交给弹簧接着走
    const velocity = first && last && last[0] > first[0] ? ((last[1] - first[1]) / (last[0] - first[0])) * 1000 : 0
    const average = Math.abs(amount) / (performance.now() - d.t)
    const allowed = d.axis === "x" || amount > 0
    if (allowed && (Math.abs(amount) >= SWIPE_DISTANCE || average > SWIPE_VELOCITY)) {
      const away = d.axis === "x" ? Math.sign(amount) * 400 : natural + 64
      if (reduce) mv.jump(away)
      else animate(mv, away, { ...SPRINGS.moderate, velocity })
      const fade = animate(opacity, 0, EXIT.moderate)
      onFly(new Promise((done) => void fade.then(() => done(null))))
      sonner.dismiss(t.id)
      return
    }
    if (reduce) mv.jump(0)
    else animate(mv, 0, { ...SPRINGS.moderate, velocity })
  }
  const consumeClick = () => [dragged.current, (dragged.current = false)][0]
  return { active, consumeClick, pointer: () => pointer.current, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } }
}

export { useSwipe }
