import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useReducedMotion } from "motion/react";
import { useVisible } from "@/components/ui/loop-clock";

/**
 * 图解的时钟，接口同 ui/loop-clock 的 useLoopClock：一条以秒计的循环时间轴，onFrame(t) 每帧直接写 DOM，不渲染 React；
 * 离开视口、标签页隐藏时停；减少动态时只画 still 那一刻；seek 立即画；暂停时速率缓到 0 再睡下，悬停时缓到 0.6。
 *
 * 不直接用 useLoopClock：它的速率弹簧取 SPRINGS.smooth，2026-10-07 起等于 moderate（刚度 3330、阻尼 115），
 * 按帧显式积分在 60fps 下发散（迭代矩阵特征值约 −1.47）——暂停或悬停一改速率，一秒后时间就跳出几万秒。
 * 这里速率按指数趋近目标，任何帧率下都稳定。Su 修好后换回 ui/loop-clock。
 */
/** 速率趋近目标的时间常数（秒）：约 0.36 秒缓到 95%，与原来 smooth 弹簧的缓停相近 */
const TAU = 0.12;
const HOVER_RATE = 0.6;

export function useStoryClock(
  ref: RefObject<Element | null>,
  { duration, onFrame, paused = false, hovering = false, still }: { duration: number; onFrame: (t: number) => void; paused?: boolean; hovering?: boolean; still: number },
) {
  const visible = useVisible(ref);
  const reduce = Boolean(useReducedMotion());
  const state = useRef({ t: 0, rate: paused ? 0 : 1, last: 0, raf: 0 });
  const frame = useRef(onFrame);
  useLayoutEffect(() => {
    frame.current = onFrame;
  });
  const target = paused ? 0 : hovering ? HOVER_RATE : 1;
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const s = state.current;
    if (reduce) {
      setRunning(false);
      frame.current(still);
      return;
    }
    if (!visible || (target === 0 && s.rate < 0.005)) {
      if (target === 0) s.rate = 0;
      setRunning(false);
      frame.current(s.t);
      return;
    }
    setRunning(true);
    s.last = performance.now();
    const tick = (now: number) => {
      // rAF 的时间戳可能早于唤醒时取的 performance.now()：夹到 0；切回标签页的长间隔夹到 50ms
      const dt = Math.max(0, Math.min(0.05, (now - s.last) / 1000));
      s.last = now;
      s.rate += (target - s.rate) * (1 - Math.exp(-dt / TAU));
      if (target === 0 && s.rate < 0.005) s.rate = 0;
      s.t = (s.t + s.rate * dt) % duration;
      frame.current(s.t);
      if (target === 0 && s.rate === 0) {
        setRunning(false);
        return;
      }
      s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(s.raf);
  }, [visible, reduce, target, duration, still]);

  const seek = useCallback(
    (t: number) => {
      state.current.t = ((t % duration) + duration) % duration;
      frame.current(state.current.t);
    },
    [duration],
  );
  return { seek, time: () => state.current.t, running, reduce };
}
