"use client"

import { nextFrame, useSizeCache } from "@/components/ui/frame"

import * as React from "react"
import { AnimatePresence, animate, motion, motionValue, useMotionValue, useMotionValueEvent, useReducedMotion, type AnimationPlaybackControls, type MotionValue } from "motion/react"

import { cn } from "@/lib/utils"
import { DUR, EASE_OUT, SPRINGS } from "@/components/ui/ease"
import { fromKeyboard } from "@/components/ui/hotkeys"

/**
 * 变形文字：一行短标签换成下一个（关注 → 已关注、发布 → 发布中 → 已发布、3 条未读 → 4 条未读），只换变了的字。
 * - 两段共有的字按「字 + 第几次出现」配对（「已读已读」里第二个「已」配第二个「已」），滑到新位置；新字原位淡入，旧字原位淡出。
 * - 外框宽度跟着新标签走，旁边的东西滑过去而不是跳；字体晚到、容器变化引起的宽度变化直接跟上，不播。
 * - 只一行，不换行。按字切（字形簇，emoji 不拆）。
 * - 读屏：纯文字放在 sr-only 里，拆开的字 aria-hidden；它不播报变化，要播报就在外面包一层 aria-live。
 * - 放进 Button 当文字时，按钮不再自己做「换文案」交叉，宽度跟着它走。
 *
 * 动效（谁引起：多半是点了之后系统给出新状态）：
 * - 共有的字 → snappy 滑到新位置（小东西换位置）；中途再换从当前位置、当前速度接着走。
 * - 新字 → 200ms 淡入、blur 4px → 清晰，晚 50ms 开始让旧字先让开，新字之间错落 50ms（最多算 3 个）；旧字 150ms 淡出并变糊（裁定 8）。
 * - 外框宽度 → 变宽时移动的是前沿，snappy；变窄时是后沿，smooth（和 Button 换文案同一对）；中途再换接着走。
 * - 键盘引起的换字、首次渲染、减少动态 → 0ms，直接换。
 */
type Glyph = { char: string; key: string }

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null

/** 按字形簇切，每个字记下它是第几次出现：配对用「字 + 次序」 */
function toGlyphs(text: string): Glyph[] {
  const seen = new Map<string, number>()
  const chars = segmenter ? [...segmenter.segment(text)].map((s) => s.segment) : Array.from(text)
  return chars.map((char) => {
    const n = seen.get(char) ?? 0
    seen.set(char, n + 1)
    return { char, key: `${char}\u0000${n}` }
  })
}

const HANDOFF = 0.05
const STAGGER = 0.05

const GLYPH = {
  gone: (still: boolean) =>
    still ? { opacity: 0, transition: { duration: 0 } } : { willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 0, filter: "blur(4px)", transition: { duration: DUR.fast, ease: EASE_OUT } },
}

function TextMorph({
  children,
  as = "span",
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  /** 标签文字，一行 */
  children: string
  as?: "span" | "strong" | "p" | "div"
}) {
  const reduce = useReducedMotion()
  // span / p / div 都是同一种块，按 span 给类型
  const Tag = as as "span"
  const frame = React.useRef<HTMLSpanElement>(null)
  const track = React.useRef<HTMLSpanElement>(null)
  const width = useMotionValue(0)
  const sizing = React.useRef<AnimationPlaybackControls | null>(null)
  // 外框要去的宽度（最近一次量到的新标签宽度）：ResizeObserver 据此分辨「是我们换了字」还是「字号、字体变了」
  const target = React.useRef(0)
  useMotionValueEvent(width, "change", (v) => {
    if (frame.current) { frame.current.style.contain = "layout"; frame.current.style.width = `${v}px` }
  })

  // 每个字的节点和横向位移。位移量相对于字行（不是视口）：所在按钮居中、跟着变宽时，那段移动交给外框宽度，字只走自己在行里的那一段
  const nodes = React.useRef(new Map<string, HTMLSpanElement>())
  const positions = React.useRef(new Map<string, number>())
  useSizeCache(track, () => {
    positions.current.clear()
    nodes.current.forEach((el, key) => positions.current.set(key, el.offsetLeft))
  })
  const shifts = React.useRef(new Map<string, MotionValue<number>>())
  const shiftOf = (key: string) => {
    let v = shifts.current.get(key)
    if (!v) shifts.current.set(key, (v = motionValue(0)))
    return v
  }

  // 上一个标签：哪些字是新的（只有新字错落）；换之前每个字此刻看得见的位置（布局位置 + 正在走的位移），中途再换从这里接着走；
  // 这次要不要直接换（键盘、减少动态）在换的那一刻定下来。此刻 DOM 还是旧标签
  const [label, setLabel] = React.useState({ current: children, previous: children, still: true, from: new Map<string, number>(), id: 0 })
  if (label.current !== children) {
    const from = new Map<string, number>()
    positions.current.forEach((left, k) => from.set(k, left + (shifts.current.get(k)?.get() ?? 0)))
    setLabel({ current: children, previous: label.current, still: fromKeyboard() || Boolean(reduce), from, id: label.id + 1 })
  }
  const still = label.still
  const glyphs = toGlyphs(children)
  const kept = new Set(toGlyphs(label.previous).map((g) => g.key))
  let entering = 0

  // 共有的字：先放到新位置，再用位移把它挪回原来看得见的地方，snappy 走回 0（带着上一段的速度）；直接换时一律归零
  React.useLayoutEffect(() => {
    const starts: (() => void)[] = []
    positions.current.clear()
    nodes.current.forEach((el, k) => {
      positions.current.set(k, el.offsetLeft)
      const was = label.from.get(k)
      const v = shiftOf(k)
      if (label.still || was === undefined) {
        v.stop()
        v.jump(0)
        return
      }
      const dx = was - el.offsetLeft
      if (Math.abs(dx) < 0.5 && !v.isAnimating()) return
      const velocity = v.getVelocity()
      v.jump(dx)
      el.style.transform = `translateX(${dx}px)`
      starts.push(() => { animate(v, 0, { ...SPRINGS.snappy, velocity }) })
    })
    return nextFrame(() => { starts.forEach(start => start()) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label.id])

  // 外框宽度：提交后、绘制前量出新标签的宽度。第一次、键盘、减少动态直接到位；否则变宽 snappy、变窄 smooth
  React.useLayoutEffect(() => {
    const t = track.current
    if (!t) return
    const next = parseFloat(getComputedStyle(t).width)
    if (!Number.isFinite(next)) return
    const cur = width.get()
    target.current = next
    sizing.current?.stop()
    if (!cur || still || Math.abs(next - cur) < 0.5) {
      width.jump(next)
      if (frame.current) frame.current.style.width = `${next}px`
      return
    }
    return nextFrame(() => { sizing.current = animate(width, next, next > cur ? SPRINGS.snappy : SPRINGS.smooth) })
  }, [children, still, width])

  // 字体晚到、容器字号变了：宽度直接跟上，不播
  React.useEffect(() => {
    const t = track.current
    if (!t || typeof ResizeObserver === "undefined") return
    // 只管「字没换、宽度却变了」：直接跳到新宽度，正在播的宽度动画一并停掉
    const ro = new ResizeObserver(() => {
      const next = parseFloat(getComputedStyle(t).width)
      if (!Number.isFinite(next) || Math.abs(next - target.current) < 0.1) return
      target.current = next
      sizing.current?.stop()
      width.jump(next)
    })
    ro.observe(t)
    return () => ro.disconnect()
  }, [width])
  React.useEffect(() => () => sizing.current?.stop(), [])

  return (
    <Tag data-slot="text-morph" className={cn("inline-flex items-center align-middle whitespace-nowrap", className)} {...props}>
      <span className="sr-only">{children}</span>
      {/* 外框带着宽度；四周多留 .5em（负外边距抵掉，不改排版），右沿 .5em 羽化：变宽时新字从软边里露出来，变窄时旧字从软边里淡掉。字行永远贴着外框起点（按钮里的文字默认居中，不贴就会在变宽途中跟着居中跳） */}
      <span
        ref={frame}
        aria-hidden
        className="relative box-content inline-block align-top text-start py-[.5em] pr-[.5em] pl-[.2em] -my-[.5em] -mr-[.5em] -ml-[.2em] [mask-image:linear-gradient(90deg,#000_calc(100%_-_.5em),transparent)]"
      >
        <span ref={track} className="relative inline-flex whitespace-pre">
          <AnimatePresence mode="popLayout" initial={false} custom={still}>
            {glyphs.map(({ char, key }) => {
              const order = kept.has(key) ? 0 : entering++
              return (
                <motion.span
                  key={key}
                  ref={(el: HTMLSpanElement | null) => {
                    if (el) nodes.current.set(key, el)
                    else nodes.current.delete(key)
                  }}
                  className="inline-block"
                  style={{ x: shiftOf(key) }}
                  custom={still}
                  variants={GLYPH}
                  initial={still ? false : { willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 0, filter: "blur(4px)" }}
                  animate={{ willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 1, filter: "blur(0px)" }}
                  exit="gone"
                  transition={{ duration: still ? 0 : DUR.base, ease: EASE_OUT, delay: still ? 0 : HANDOFF + Math.min(order, 3) * STAGGER }}
                >
                  {char}
                </motion.span>
              )
            })}
          </AnimatePresence>
        </span>
      </span>
    </Tag>
  )
}
TextMorph.displayName = "TextMorph"

export { TextMorph }
