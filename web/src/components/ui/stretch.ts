"use client"

import { useEffect, useRef } from "react"
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion, type MotionValue, type Transition } from "motion/react"

import { nextFrame } from "@/components/ui/frame"
import { FROM_FIRST_FRAME, SPRINGS } from "@/components/ui/ease"

/**
 * 会移动的块（开关圆钮、分段滑块、标签胶囊、选中底）的左右两条边（DESIGN.md §4.2）。
 * 两条边走同一条弹簧，默认 moderate（0.16s 落定、临界阻尼）：块整体滑过去，途中不拉伸、落点不过冲。
 * 2026-10-07 起不再分前沿 / 后沿（原来前沿 snappy、后沿 smooth，途中拉长约 40%），也不再按位移大小换档：档位按块的大小选。
 * 弹簧由 motion 按时间算出（不是 CSS 曲线）：中途换目标时从当前位置、当前速度接着走，不会跳。
 * - spring：换一档（例如跟手的小块用 SPRINGS.fast），两边仍走同一条。
 * - instant（首帧、键盘、尺寸变化）与减少动态效果：直接到位。
 * 调用方负责判断「这次是不是键盘」（ui/hotkeys 的 fromKeyboard()），键盘一律传 instant。
 * 两条边仍分开存：拖动时调用方可以只动一边（按住伸长），宽度由两边推出来。
 */
export function useEdges(initial: { left: number; right: number }) {
  const left = useMotionValue(initial.left)
  const right = useMotionValue(initial.right)
  // 宽度是自己的 MotionValue，由两条边的变化推出来；不用 useTransform(() => …)：
  // 它在 StrictMode 下或挂载同一帧里直接 set 时会漏掉这次更新，宽度停在旧值（曾停在 0）
  const width = useMotionValue(initial.right - initial.left)
  const sync = () => width.set(right.get() - left.get())
  useEffect(() => {
    sync()
    const offs = [left.on("change", sync), right.on("change", sync)]
    return () => offs.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const reduce = useReducedMotion()
  const running = useRef<{ stop: () => void }[]>([])
  const pending = useRef<(() => void) | null>(null)

  /** 移到新位置；instant 用于首帧和键盘；spring 换一档（两条边仍走同一条） */
  const moveTo = (to: { left: number; right: number }, opts: { instant?: boolean; spring?: Transition; startTime?: number } = {}) => {
    pending.current?.()
    pending.current = null
    if (opts.instant || reduce) {
      running.current.forEach((a) => a.stop())
      left.jump(to.left)
      right.jump(to.right)
      sync()
      running.current = []
      return
    }
    const spring = opts.spring ?? SPRINGS.moderate
    // startTime：和挂载同一刻起步时传 FROM_FIRST_FRAME（ui/ease），从第一帧开始计时
    const at = opts.startTime === undefined ? {} : { startTime: opts.startTime }
    pending.current = nextFrame(() => {
      pending.current = null
      running.current = [
        animate(left, to.left, { ...spring, ...FROM_FIRST_FRAME, ...at }),
        animate(right, to.right, { ...spring, ...FROM_FIRST_FRAME, ...at }),
      ]
    })
  }

  useEffect(() => () => { pending.current?.(); running.current.forEach((a) => a.stop()) }, [])
  const isMoving = () => pending.current !== null || left.isAnimating() || right.isAnimating()
  return { left, right, width, moveTo, isMoving }
}

/**
 * 橡皮筋：超出 [min, max] 的部分按苹果滚动视图的公式衰减，拖得越远越难拉，松手弹回。
 * dimension 是可拖动范围的尺寸，c = 0.55 取自 UIScrollView 的阻尼系数。
 */
export function rubberband(value: number, min: number, max: number, dimension: number, c = 0.55) {
  const over = (d: number) => (1 - 1 / ((d * c) / dimension + 1)) * dimension
  if (value < min) return min - over(min - value)
  if (value > max) return max + over(value - max)
  return value
}

/**
 * 按压（DESIGN.md §4.2 fast 档）：指针主键按下 → fast 压到 to（16 的复选框、单选用 .9，否则看不出；按钮不缩放，见 §4.1）；
 * 松手、移开或取消 → fast 弹回，中途反悔从当前速度接着走。键盘不缩放；减少动态效果时直接到位。
 * 按下期间元素带 data-pressed：阴影压平这类要和缩放同拍的样式挂在它上面（阴影直接随状态切换），不用 :active——
 * 指针按住移出元素时 :active 还在，缩放却已经弹回。
 * 把 node 挂到元素的 ref 上，press / release 挂到指针事件上（release 同时挂 pointerup、pointerleave、pointercancel）。
 * 直接写 style.transform 和属性，不触发 React 渲染。
 */
export function usePressScale<T extends HTMLElement>(to: number) {
  const node = useRef<T | null>(null)
  const scale = useMotionValue(1)
  const reduce = useReducedMotion()
  useMotionValueEvent(scale, "change", (v) => {
    if (node.current) node.current.style.transform = v === 1 ? "" : `scale(${v})`
  })
  const press = (e: { button: number }) => {
    if (e.button !== 0) return
    node.current?.setAttribute("data-pressed", "")
    if (reduce) scale.set(to)
    else animate(scale, to, SPRINGS.fast)
  }
  const release = () => {
    node.current?.removeAttribute("data-pressed")
    if (scale.get() === 1 && !scale.isAnimating()) return
    if (reduce) scale.set(1)
    else animate(scale, 1, SPRINGS.fast)
  }
  return { node, press, release }
}

export type { MotionValue }
