export const EASE_OUT = [0.23, 1, 0.32, 1] as const

/** 时间驱动的循环（打字中的点、呼吸）：对称缓入缓出。不用在交互上 */
export const EASE_LOOP = [0.77, 0, 0.175, 1] as const

/** 落定判据：离终点的包络衰减到起始位移的 0.1%（100px 的位移只剩 0.1px，看不出来） */
const SETTLED = 0.001

/**
 * 由「多久落定（秒）+ 回弹多少」换算成物理弹簧（质量 1）。
 * 必须写成 stiffness / damping：motion ≥ 12.34 对 duration / bounce 写法会把打断时继承的速度清零，
 * 物理写法才能中途换目标时从当前位置、当前速度接着走。
 *
 * 换算：阻尼比 ζ = 1 − bounce，固有频率 ω；从静止出发，离终点的包络在落定时间 T 等于 SETTLED：
 * - ζ = 1（临界）：e^(−ωT)·(1 + ωT) = 0.001，x = ωT 无解析解，牛顿法得 x ≈ 9.2334
 * - ζ < 1：ζ / √(1 − ζ²) · e^(−ζωT) = 0.001 → ζωT = ln(ζ / (√(1 − ζ²) · 0.001))
 * 然后 stiffness = ω²，damping = 2ζω。三档的结果：
 *   fast      0.08s · 0     → ω 115.4 · stiffness 13321 · damping 230.8
 *   moderate  0.16s · 0     → ω  57.7 · stiffness  3330 · damping 115.4
 *   slow      0.24s · 0.12  → ω  35.6 · stiffness  1269 · damping  62.7（过冲 0.3%）
 * motion 的 { type: "spring", duration, bounce } 用同一判据解刚度，所以两种写法是同一条曲线
 * （逐毫秒比对，最大偏差 ≤ 0.3px / 100px，docs/验收/2026-10-07-专业方法/motion/curves.mjs），差别只在能不能继承速度。
 */
export const settle = (duration: number, bounce = 0) => {
  const zeta = 1 - bounce
  let x: number
  if (zeta >= 1) {
    x = 5
    for (let i = 0; i < 12; i++) x -= (Math.exp(-x) * (1 + x) - SETTLED) / (-x * Math.exp(-x))
  } else {
    x = Math.log(zeta / (Math.sqrt(1 - zeta * zeta) * SETTLED)) / zeta
  }
  const omega = x / duration
  return { type: "spring", stiffness: omega * omega, damping: 2 * zeta * omega, mass: 1 } as const
}

/** 进场三档（DESIGN.md §4.2）。键盘触发一律 0ms，不用它们 */
const fast = settle(0.08)
const moderate = settle(0.16)
const slow = settle(0.24, 0.12)

/**
 * 退场：同档的短过渡，不回弹，比进场快一档（0.06 / 0.12 / 0.16s）。
 * 曲线是对称缓入缓出（motion 不写 ease 时的默认），读起来是「收走」而不是「弹走」。
 * 卸载时写 exit={{ opacity: 0, transition: EXIT.fast }}；延迟卸载的兜底计时用 exitFallbackMs(EXIT.x)。
 */
export const EXIT = {
  fast: { type: "tween", duration: 0.06, ease: "easeInOut" },
  moderate: { type: "tween", duration: 0.12, ease: "easeInOut" },
  slow: { type: "tween", duration: 0.16, ease: "easeInOut" },
} as const

/** 退场靠动画完成回调卸载时的兜底（毫秒）：后台标签页会卡住 rAF，留下看不见的遮罩与滚动锁；退场时长 + 100 */
export const exitFallbackMs = (exit: { duration: number }) => Math.round(exit.duration * 1000) + 100

/**
 * 过渡期，组件迁移完删除：snappy → fast · smooth → moderate · follow → fast · release → moderate。
 * 旧名字的数值已经是新档，组件迁移只改名字，不改观感。
 */
export const SPRINGS = {
  fast,
  moderate,
  slow,
  snappy: fast,
  smooth: moderate,
  follow: fast,
  release: moderate,
} as const

/** 过渡期，组件迁移完删除：前后沿走同一档（moderate），不再拉伸。新代码直接用 SPRINGS.moderate */
export const MORPH = { lead: moderate, trail: moderate } as const

/**
 * 秒，CSS 过渡在 JS 里的同值（--ds-dur-*）。过渡期，组件迁移完删除：
 * press → 按下 80ms；fast → 颜色、字重 80ms；base（原淡入 200）→ 80ms，淡入改用 SPRINGS.fast、淡出用 EXIT.fast。
 */
export const DUR = { press: 0.08, fast: 0.08, base: 0.08 } as const

/**
 * 和挂载同一刻起步的动画（打开面板、看图器飞出）：从第一帧开始计时。
 * motion 默认从创建那一刻计时，挂载内容的长任务（实测 90ms，CPU 降速 4 倍时 180ms）会被算进去，
 * 第一帧就跳到 25%–95%（「开头冲」，2026-10-04 复查）。只合进 animate(独立 MotionValue, …) 的选项；
 * 不放进 motion 组件的 transition：那条路可能走 WAAPI，startTime 不接受无穷大。
 */
export const FROM_FIRST_FRAME = { startTime: Number.POSITIVE_INFINITY } as const
