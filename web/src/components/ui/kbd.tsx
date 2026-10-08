import { nextFrame } from "@/components/ui/frame"
import * as React from "react"
import { ArrowBigUp, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronUp, Command, CornerDownLeft, Delete, Option, type LucideIcon } from "lucide-react"
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react"

import { cn } from "@/lib/utils"
import { SPRINGS } from "@/components/ui/ease"

/**
 * 键帽：只用在「键盘快捷键」一览里（按 ? 打开的那张表）；按钮、导航、搜索框、提示、菜单、页脚里一律不放键位。
 * 一个组合键写在一枚键帽里（⌘K），用符号不用英文单词，只写真实可用的快捷键。
 * 符号键（⌘ ⇧ ⌥ ⌃ ↵ ⌫ 方向键）画成 lucide 图标，不用字体里的字符：字符的粗细、大小、基线跟着字体走，和旁边的图标对不上；
 * 图标 1em、线宽 2，和同一行的字一样粗、一样高。
 *
 * 动效（DESIGN.md §5.1「键盘 0ms」的明文例外：键帽的动画就是按键本身）：
 * - 真的按下这枚键帽写的键（键盘；组合键要修饰键一起按住）→ 按压：下沉 1px、影子由凸起换成凹下；
 *   按下 snappy，松开 snappy 弹簧弹回；下沉量和影子深浅由同一个值算出，同拍 → 减少动态时不下沉，只留影子的明暗变化。
 * - 指针悬停、点击键帽 → 不动（键帽不可交互）。
 */
const GLYPHS: Record<string, LucideIcon> = {
  "⌘": Command, "⇧": ArrowBigUp, "⌥": Option, "⌃": ChevronUp, "↵": CornerDownLeft, "⏎": CornerDownLeft,
  "⌫": Delete, "↑": ArrowUp, "↓": ArrowDown, "←": ArrowLeft, "→": ArrowRight,
}

/** 读屏念的键名：符号键画成 aria-hidden 的图标，旁边放一段 sr-only 的名字，「⌘K」读成「Command K」而不是只有「K」 */
const NAMES: Record<string, string> = {
  "⌘": "Command", "⇧": "Shift", "⌥": "Option", "⌃": "Control", "↵": "Return", "⏎": "Return",
  "⌫": "Delete", "↑": "Up", "↓": "Down", "←": "Left", "→": "Right",
}

/** "⌘⇧P" → [⌘图标][⇧图标]P：符号键画成图标，字母和单词照写；图标跟字号走（1em） */
function Keys({ keys, className }: { keys: string; className?: string }) {
  const parts = [...keys].reduce<string[]>((out, ch) => {
    if (GLYPHS[ch] || !out.length || GLYPHS[out[out.length - 1]]) out.push(ch)
    else out[out.length - 1] += ch
    return out
  }, [])
  return (
    <span data-slot="keys" className={cn("inline-flex items-center gap-[0.125em] leading-none", className)}>
      {parts.map((p, i) => {
        const Icon = GLYPHS[p]
        if (!Icon) return <span key={i}>{p}</span>
        return (
          <React.Fragment key={i}>
            <Icon aria-hidden className="size-[1em]! shrink-0" strokeWidth={2} />
            <span className="sr-only">{NAMES[p]} </span>
          </React.Fragment>
        )
      })}
    </span>
  )
}

function Kbd({ className, children, ...props }: React.ComponentProps<"kbd">) {
  const ref = React.useRef<HTMLElement>(null)
  const [combo, setCombo] = React.useState<Combo | null>(null)
  const text = typeof children === "string" ? children : null
  React.useLayoutEffect(() => setCombo(parseCombo(text ?? ref.current?.textContent ?? "")), [children, text])
  const pressed = React.useSyncExternalStore(subscribe, () => combo !== null && isHeld(combo), () => false)

  const reduce = useReducedMotion()
  const depth = useMotionValue(0) // 0 抬起 → 1 按到底
  const y = useTransform(() => (reduce ? 0 : depth.get()))
  const raised = useTransform(() => 1 - depth.get())
  React.useEffect(() => {
    return nextFrame(() => {
      const controls = animate(depth, pressed ? 1 : 0, SPRINGS.snappy)
      return () => controls.stop()
    })
  }, [pressed, depth])

  return (
    <motion.kbd
      ref={ref}
      data-slot="kbd"
      data-pressed={pressed || undefined}
      style={{ y }}
      className={cn(
        "relative inline-flex h-5 min-w-5 items-center align-middle justify-center rounded-sm bg-card px-1 font-sans text-xs text-fg-muted select-none",
        className
      )}
      {...(props as React.ComponentProps<typeof motion.kbd>)}
    >
      {text ? <Keys keys={text} /> : children}
      {/* 两层影子交叉：凸起的影子随下沉变淡，凹下的影子变浓 */}
      <motion.span aria-hidden data-slot="kbd-raised" className="pointer-events-none absolute inset-0 rounded-inherit shadow-raised" style={{ opacity: raised }} />
      <motion.span aria-hidden data-slot="kbd-pressed" className="pointer-events-none absolute inset-0 rounded-inherit shadow-pressed" style={{ opacity: depth }} />
    </motion.kbd>
  )
}

/* ── 全页共用一份按键状态：哪些键正按着 ── */

type Combo = { key: string; meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }

const SYMBOLS: Record<string, string> = {
  "↵": "enter", "⏎": "enter", "↑": "arrowup", "↓": "arrowdown", "←": "arrowleft", "→": "arrowright",
  "⌫": "backspace", "⌦": "delete", "⇥": "tab", "␣": " ", esc: "escape", 空格: " ", space: " ",
}

/** "⌘⇧P" → { key: "p", meta, shift }；只有修饰键时 key 为空。 */
function parseCombo(text: string): Combo | null {
  let rest = text.trim()
  const combo = { key: "", meta: false, ctrl: false, alt: false, shift: false }
  const MODS = { "⌘": "meta", "⌃": "ctrl", "⌥": "alt", "⇧": "shift" } as const
  while (rest[0] in MODS) {
    combo[MODS[rest[0] as keyof typeof MODS]] = true
    rest = rest.slice(1).trim()
  }
  const key = rest.toLowerCase()
  combo.key = SYMBOLS[key] ?? SYMBOLS[rest] ?? key
  if (!combo.key && !combo.meta && !combo.ctrl && !combo.alt && !combo.shift) return null
  return combo
}

const held = new Set<string>()
const mods = { meta: false, ctrl: false, alt: false, shift: false }
const listeners = new Set<() => void>()

/** 同时记 key 和物理键位：⌥ 在 macOS 上会把 J 变成 ∆，按键位仍认得出是 J。 */
const namesOf = (e: KeyboardEvent) => [e.key.toLowerCase(), e.code.replace(/^(Key|Digit)/, "").toLowerCase()]

function onKey(e: KeyboardEvent) {
  if (e.type === "keydown") namesOf(e).forEach((n) => held.add(n))
  else namesOf(e).forEach((n) => held.delete(n))
  // macOS 按着 ⌘ 时其他键收不到 keyup：⌘ 一松开就当作全都松开
  if (e.type === "keyup" && e.key === "Meta") held.clear()
  Object.assign(mods, { meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey })
  listeners.forEach((l) => l())
}
function reset() {
  held.clear()
  Object.assign(mods, { meta: false, ctrl: false, alt: false, shift: false })
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  if (!listeners.size) {
    document.addEventListener("keydown", onKey, true)
    document.addEventListener("keyup", onKey, true)
    window.addEventListener("blur", reset)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size) return
    document.removeEventListener("keydown", onKey, true)
    document.removeEventListener("keyup", onKey, true)
    window.removeEventListener("blur", reset)
  }
}

function isHeld(c: Combo) {
  if (c.meta !== mods.meta || c.ctrl !== mods.ctrl || c.alt !== mods.alt) return false
  if (c.shift && !mods.shift) return false
  return c.key ? held.has(c.key) : true
}

export { Kbd }
