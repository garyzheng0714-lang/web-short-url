import * as React from "react"
import { useReducedMotion } from "motion/react"

import { SPRINGS } from "@/components/ui/ease"

/**
 * 循环演示的时钟（展示组件共用：data-flow、payment-flow、multi-region-failover、vector-search、dot-grid、voice-orb）。
 * - useVisible：元素在视口里、标签页可见时为 true；离开视口、切走标签页时帧循环都该停。
 * - useLoopClock：一条以秒计的时间轴，画面是它的纯函数（同一时刻永远同一画面，循环无缝）。只在可见、没开减少动态时走；
 *   速率走一条 smooth 弹簧（SPRINGS.smooth 的刚度与阻尼，不过冲）：暂停时缓到 0 再睡下，悬停时缓到 0.6，平常是 speed。
 *   onFrame(t) 每帧调用一次，由组件直接写 DOM，不渲染 React。减少动态时不跑，只用 still 时刻画一帧（seek 照样立即画）。
 */

function useVisible(ref: React.RefObject<Element | null>) {
  const [inView, setInView] = React.useState(false)
  const [shown, setShown] = React.useState(true)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting))
    io.observe(el)
    const vis = () => setShown(document.visibilityState === "visible")
    vis()
    document.addEventListener("visibilitychange", vis)
    return () => {
      io.disconnect()
      document.removeEventListener("visibilitychange", vis)
    }
  }, [ref])
  return inView && shown
}

const { stiffness: K, damping: C } = SPRINGS.smooth
/** 悬停时的速率：慢一点，好看清 */
const HOVER_RATE = 0.6
/**
 * 缓停到这里就睡：速率 < 0.5%、速率的速度 < 0.05。剩下的尾巴合起来不到 0.0004 秒的循环时间（最快的点不到 0.2px），
 * 60fps 下约 0.58 秒睡下；阈值卡到 0.001 时要拖到约 1 秒，负载高、帧变稀时更久（2026-10-02 全量 E2E 抓到暂停后还在动）
 */
const asleep = (rate: number, v: number) => rate < 0.005 && Math.abs(v) < 0.05

function useLoopClock(
  ref: React.RefObject<Element | null>,
  {
    duration,
    onFrame,
    paused = false,
    speed = 1,
    hovering = false,
    still,
  }: {
    /** 一圈多少秒；t 在 [0, duration) 里循环 */
    duration: number
    onFrame: (t: number) => void
    paused?: boolean
    speed?: number
    hovering?: boolean
    /** 减少动态时画的那一刻 */
    still: number
  }
) {
  const visible = useVisible(ref)
  const reduce = Boolean(useReducedMotion())
  const state = React.useRef({ t: 0, rate: paused ? 0 : speed, v: 0, last: 0, raf: 0 })
  const frame = React.useRef(onFrame)
  React.useLayoutEffect(() => {
    frame.current = onFrame
  })
  const target = paused ? 0 : hovering ? HOVER_RATE * speed : speed
  const [running, setRunning] = React.useState(false)

  React.useEffect(() => {
    const s = state.current
    if (reduce) {
      setRunning(false)
      frame.current(still)
      return
    }
    // 不可见：停；暂停且速率已经缓到 0：睡下（画面停在当前时刻）
    if (!visible || (target === 0 && asleep(s.rate, s.v))) {
      setRunning(false)
      frame.current(s.t)
      return
    }
    setRunning(true)
    s.last = performance.now()
    const tick = (now: number) => {
      // rAF 的时间戳可能早于唤醒时取的 performance.now()：夹到 0
      const dt = Math.max(0, Math.min(0.05, (now - s.last) / 1000))
      s.last = now
      const a = K * (target - s.rate) - C * s.v
      s.v += a * dt
      s.rate = Math.max(0, s.rate + s.v * dt)
      s.t = (s.t + s.rate * dt) % duration
      frame.current(s.t)
      if (target === 0 && asleep(s.rate, s.v)) {
        s.rate = 0
        s.v = 0
        setRunning(false)
        return
      }
      s.raf = requestAnimationFrame(tick)
    }
    s.raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(s.raf)
  }, [visible, reduce, target, duration, still])

  const seek = React.useCallback((t: number) => {
    state.current.t = ((t % duration) + duration) % duration
    frame.current(state.current.t)
  }, [duration])
  return { seek, time: () => state.current.t, running, reduce }
}

export { useLoopClock, useVisible }
