import * as React from "react"
import { animate, motionValue, useReducedMotion, type MotionValue } from "motion/react"

import { nextFrame } from "@/components/ui/frame"
import { cn } from "@/lib/utils"
import { DUR, EASE_OUT, FROM_FIRST_FRAME, SPRINGS } from "@/components/ui/ease"

/**
 * 按位滚动的文字（计费周期切换的价格、指标、用量条、图表读数共用；也能单独用在价格、上线时刻这类「值得停一拍」的变化上）：
 * 每一位数字朝数值变化的方向滚到新数字，像里程表；字母、汉字换字时，旧字朝同一个方向滑出、新字滑入。
 * - 认人：开头的符号（¥、+、「已上线」这类前缀）按左端认，数字和后面的分隔符、单位按右端认：
 *   999 → 1,000 时个位仍是个位、逗号不跟着滚，新多出来的一位淡入；¥ 不会因为位数变了闪一下。
 * - stagger：从左到右依次停下（每位晚 50ms）；spins：每一位多转几圈再落（1–2 圈），快的时候带一点模糊，停下即清晰。
 * - 只管看得见的字：整块 aria-hidden，读屏文字由使用方在旁边放一份 sr-only（值会自己变时外面再包 aria-live）。
 * - 每一位的窗口顶端对齐（align-top）：overflow 隐藏的行内块基线在底边，不顶对齐时数字比旁边的字高出一截下伸部、外层被撑高（2026-10-02）。
 *
 * 动效（DESIGN.md §5.2 snappy「数位滚动」）：
 * - 值变化（系统，或指针点了别的选项）→ 每一位 snappy 滚到新数字，最多滚 9 格；中途再改从当前位置、当前速度接着滚。
 * - spins（多转几圈，位移远超 200px）→ 改用 smooth（不过冲、长而软的落地）；速度越快越糊（≤ 2px），停下即清晰。
 * - stagger → 第 n 位晚 n × 50ms 开始，从左到右依次停下。
 * - 非数字换字 → 旧字朝方向滑出、新字滑入，snappy；新旧各带 2px 模糊交叉（裁定 8），透明度 200 进 / 150 出。
 * - still（键盘引起、悬停预览这类高频切换）→ 直接换成新字，0ms。
 * - 新多出来的一位 → 200ms 淡入。减少动态 → 直接换，不淡入。
 */
/**
 * 0–9 叠五遍：平时停在中间那一遍（20–29），朝上或朝下滚都还有字；中途连着往同一个方向改两次也不会滚出头。
 * 停下后悄悄挪回中间那一遍（同一个数字，看不出来）。spins 最多 2 圈：中间 + 9 + 20 = 49，刚好不出头。
 */
const REPEAT = 5
const MIDDLE = 20
// 同一叠 50 行用一个文本节点排版：不为每一行创建元素，避免多组金额换值时重算数千个节点。
// 每行沿用父级行高，整叠仍为 50lh，百分比位移和弹簧坐标不变（DESIGN.md §5.3）。
const STACK = Array.from({ length: REPEAT * 10 }, (_, i) => i % 10).join("\n")
const STAGGER = 0.05

type Motion = { dir: number; still: boolean; delay: number; spins: number }

type DigitState = { pos: MotionValue<number>; initial: string; digit: number; node: HTMLSpanElement | null }
const shift = (p: number) => `translateY(${(-p / (REPEAT * 10)) * 100}%)`
function paintDigit(state: DigitState, spins = 0) {
  if (!state.node) return
  state.node.style.transform = shift(state.pos.get())
  const window = state.node.parentElement
  if (window && (spins || window.style.filter)) {
    const blur = spins ? Math.min(Math.max(Math.abs(state.pos.getVelocity()) - 10, 0) * 0.05, 2) : 0
    window.style.filter = blur < 0.1 ? "" : `blur(${blur.toFixed(2)}px)`
  }
}

/** 全部数位在父级一次提交中调度；每位保留自己的 MotionValue 和速度，不建立独立 React 效果树。 */
function useDigits(chars: { key: string; ch: string; delay: number }[], dir: number, instant: boolean, spins: number) {
  const states = React.useRef(new Map<string, DigitState>())
  const active = chars.filter(c => /^[0-9]$/.test(c.ch))
  for (const c of active) if (!states.current.has(c.key)) states.current.set(c.key, { pos: motionValue(MIDDLE + Number(c.ch)), initial: shift(MIDDLE + Number(c.ch)), digit: Number(c.ch), node: null })
  React.useLayoutEffect(() => {
    const keys = new Set(active.map(c => c.key)), starts: (() => void)[] = []
    for (const [key, state] of states.current) if (!keys.has(key)) { state.pos.stop(); states.current.delete(key) }
    for (const c of active) {
      const state = states.current.get(c.key)!, digit = Number(c.ch), window = state.node?.parentElement
      const changed = state.digit !== digit
      const done = () => {
        // 只落定仍是当前目标的那一次：被新值接管后旧弹簧的收尾不能把数位拨回旧数字（连续输入时停在中间值）
        if (state.digit !== digit) return
        state.pos.jump(MIDDLE + digit); paintDigit(state)
        if (window) { window.style.filter = ""; window.style.willChange = "" }
      }
      if (instant) { state.digit = digit; done(); continue }
      if (!changed) continue
      const cur = state.pos.get()
      let to = Math.floor(cur / 10) * 10 + digit
      if (dir >= 0 && to < cur - 0.01) to += 10
      if (dir < 0 && to > cur + 0.01) to -= 10
      to += (dir >= 0 ? 10 : -10) * spins
      while (to > REPEAT * 10 - 1) to -= 10
      while (to < 0) to += 10
      if (Math.abs(to - cur) < 0.01) continue
      if (window && spins) window.style.willChange = "filter"
      starts.push(() => { state.digit = digit; animate(state.pos, to, { ...(spins ? SPRINGS.smooth : SPRINGS.snappy), ...FROM_FIRST_FRAME, delay: c.delay, onUpdate: () => paintDigit(state, spins), onComplete: done }) })
    }
    if (starts.length) return nextFrame(() => { starts.forEach(start => start()) })
    // 同值重渲染不取消排队；数位变化、键盘与减少动态在同一批提交处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chars.map(c => c.key + c.ch).join("|"), instant])
  React.useEffect(() => () => { states.current.forEach(state => state.pos.stop()) }, [])
  return states.current
}

/** 一个非数字的字：换了就朝 dir 的方向换（新字从下面升起 / 从上面落下），旧字反方向离开；空格不动 */
function Glyph({ ch, dir, still, delay }: { ch: string } & Motion) {
  const reduce = useReducedMotion()
  const [pair, setPair] = React.useState({ now: ch, was: null as string | null, id: 0, dir })
  if (pair.now !== ch || ((still || reduce) && pair.was !== null)) setPair({ now: ch, was: still || reduce ? null : pair.now, id: pair.id + 1, dir })
  const box = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    const el = box.current
    if (!pair.id || !el || pair.was === null || still || reduce) return
    const [enter, leave] = [...el.children] as HTMLElement[]
    const d = pair.dir >= 0 ? 1 : -1
    const ease = "cubic-bezier(0.23, 1, 0.32, 1)"
    const timing = { delay: delay * 1000 }
    enter.style.transform = `translateY(${d * 100}%)`
    enter.style.opacity = "0"
    enter.style.willChange = "transform, opacity, filter"
    leave.style.willChange = "transform, opacity, filter"
    return nextFrame(() => {
      enter.style.opacity = ""
      const a = [
      animate(enter, { transform: [`translateY(${d * 100}%)`, "translateY(0%)"] }, { ...SPRINGS.snappy, delay }),
      animate(leave, { transform: ["translateY(0%)", `translateY(${-d * 100}%)`] }, { ...SPRINGS.snappy, delay }),
      enter.animate([{ opacity: 0, filter: "blur(2px)" }, { opacity: 1, filter: "blur(0px)" }], { duration: DUR.base * 1000, easing: ease, fill: "backwards", ...timing }),
      leave.animate([{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(2px)" }], { duration: DUR.fast * 1000, easing: ease, fill: "forwards", ...timing }),
    ]
    const id = pair.id
    Promise.all(a.map((x) => x.finished)).then(
      () => { enter.style.willChange = ""; leave.style.willChange = ""; setPair((p) => (p.id === id ? { ...p, was: null } : p)) },
      () => {}
    )
    return () => { a.forEach((x) => x.cancel()); enter.style.willChange = ""; leave.style.willChange = "" }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair.id, still, reduce])
  return (
    <span ref={box} aria-hidden className="relative inline-grid h-[1lh] overflow-hidden whitespace-pre align-top">
      <span className="[grid-area:1/1]">{pair.now}</span>
      {pair.was !== null ? <span className="[grid-area:1/1]">{pair.was}</span> : null}
    </span>
  )
}

/** 字符没变就保留 DOM；数位的提交与弹簧由 useDigits 统一处理。 */
const RollingChar = React.memo(function RollingChar({ ch, place, fade, digit, ...m }: { ch: string; place: number; fade: boolean; digit?: DigitState } & Motion) {
  const isDigit = ch >= "0" && ch <= "9"
  const node = React.useRef<HTMLSpanElement>(null)
  const cancelled = React.useRef(false)
  React.useLayoutEffect(() => {
    const el = node.current
    if (!el) return
    el.style.opacity = ""
    if (m.still) cancelled.current = true
    if (!fade || cancelled.current) return
    el.style.opacity = "0"
    return nextFrame(() => {
      el.style.opacity = ""
      const run = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR.base * 1000, delay: m.delay * 1000, easing: `cubic-bezier(${EASE_OUT.join(",")})`, fill: "both" })
      run.onfinish = () => run.cancel()
      return () => run.cancel()
    })
    // 只在新增字符时淡入；换字由 useDigits/Glyph 接管。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.still])
  return (
    <span ref={node} data-place={isDigit ? place : undefined} className="inline-block select-none">
      {digit ? <span aria-hidden data-slot="rolling-window" className="inline-block h-[1lh] overflow-hidden align-top">
        <span ref={node => { digit.node = node }} data-slot="rolling-digit" className="block whitespace-pre" style={{ transform: digit.initial }}>{STACK}</span>
      </span> : <Glyph ch={ch} {...m} />}
    </span>
  )
}, (before, after) => before.ch === after.ch && before.place === after.place && before.spins === after.spins && before.still === after.still)

/** 字符串里的数（去掉千分位、单位；减号「−」当负号）；没有数字时 NaN */
const valueOf = (text: string) => parseFloat(text.replace(/\u2212/g, "-").replace(/[^\d.-]/g, ""))

/**
 * 按位渲染一段文字：开头的非数字前缀按左端认人（p0、p1…），其余按离右端的位置认人（数字 d、其他 s）；
 * 位数变了个位仍是个位，分隔符、单位不滚，¥ 不闪。
 */
function RollingNumber({
  text,
  dir: dirProp,
  still = false,
  stagger = false,
  spins = 0,
  className,
  ...props
}: {
  /** 要显示的文字（数字已经格式化好：千分位、单位） */
  text: string
  /** 1：变大，往上滚；-1：变小，往下滚。不传就按前后两个数比较；不是数字时往上 */
  dir?: number
  /** 直接换成新字（键盘、悬停预览） */
  still?: boolean
  /** 从左到右依次停下（每位晚 50ms） */
  stagger?: boolean
  /** 每一位多转几圈再落：0–2 */
  spins?: 0 | 1 | 2
} & Omit<React.ComponentProps<"span">, "children" | "dir">) {
  const reduce = useReducedMotion()
  // 第一次渲染的每一位直接出现；之后新增的一位（位数变多）才淡入
  const mounted = React.useRef(false)
  React.useEffect(() => {
    mounted.current = true
  }, [])
  // 没给方向：和上一次的数比
  const previous = React.useRef(text)
  const trend = React.useMemo(() => {
    const a = valueOf(previous.current), b = valueOf(text)
    return Number.isFinite(a) && Number.isFinite(b) && b < a ? -1 : 1
  }, [text])
  React.useLayoutEffect(() => { previous.current = text }, [text])
  const dir = dirProp ?? trend
  const fade = mounted.current && !still && !reduce
  const textChars = [...text]
  const firstDigit = textChars.findIndex(ch => /^[0-9]$/.test(ch))
  const prefix = firstDigit < 0 ? textChars.length : firstDigit
  const chars = textChars.map((ch, i) => {
    const place = textChars.length - 1 - i
    return { ch, place, key: i < prefix ? `p${i}` : `${/^[0-9]$/.test(ch) ? "d" : "s"}${place}`, delay: stagger ? i * STAGGER : 0 }
  })
  const digits = useDigits(chars, dir, still || Boolean(reduce), spins)
  return (
    <span data-slot="rolling-number" {...props} className={cn("relative inline-flex", className)}>
      {chars.map(({ key, ...c }) => <RollingChar key={key} {...c} digit={digits.get(key)} dir={dir} still={still || Boolean(reduce)} spins={spins} fade={fade} />)}
      {/* 选中、复制拿到的是这一层透明的整串文字：滚动的数位叠了 0–9 五遍，选中会复制出一长串数字（2026-10-04） */}
      <span data-slot="rolling-copy" className="absolute inset-0 whitespace-pre text-transparent">{text}</span>
    </span>
  )
}

export { RollingNumber }
