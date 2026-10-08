import * as React from "react"
import { CircleX, Search } from "lucide-react"
import { motion, useComposedRefs, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { EXIT, SPRINGS } from "@/components/ui/ease"
import { useFieldControl } from "@/components/ui/field"
import { isComposing } from "@/components/ui/hotkeys"
import { fieldSurface } from "@/components/ui/input"
import { usePressScale } from "@/components/ui/stretch"

/**
 * 搜索框：一个产品里只放一个全局搜索入口；快捷键用 hotkeys 挂。
 * 尺寸（DESIGN.md §3.1）：高 --ds-h-md；两侧都有图标（放大镜、清除），横向内边距用有图标一侧的 --ds-pad-x-icon；图标 --ds-icon，图标到字 --ds-gap-control。
 * 有内容时右侧出现清除按钮：点一下清空并把焦点留在输入框（受控用法照常收到 onChange 与 onValueChange）。
 * Esc（照 uiarc，各浏览器一致，不靠原生 type=search）：有内容时清空、拦下这一下（不让外面的对话框、抽屉跟着关）；已经空了就放行。
 * 清除按钮的槽位常驻（16 宽），出现、消失都不改输入框宽度。放进 Field 时自动接线（useFieldControl）。
 * 拿它筛列表时用 onQueryChange：输入法组字途中（拼音还在候选框里）不回传，组完字回传一次——不会拿「tui」去筛中文列表（2026-10-02 第 10 步）。
 *
 * 动效（DESIGN.md §4.2）：
 * - 打字（打字带来的内容变化照常动）→ 有内容时清除按钮从 0.8 长到 1、淡入、blur 4→0，SPRINGS.fast；清空 → EXIT.fast 收走（不回放进场）。
 *   中途反悔从当前值接着走。点清除按钮清空同样 EXIT.fast。
 * - Esc 清空（命令键）→ 清除按钮 0ms 直接消失。
 * - 聚焦 → 槽底变白、槽线变强调色、放大镜 fg-muted → fg 同一帧即时（同 Input，§4.3）；清除按钮悬停换色 80ms ease-ds。
 * - 指针按住清除按钮 → 按压：图标 fast 压到 .9（小于 24 的按钮，没有面可收），松手 fast 弹回（usePressScale；
 *   压在里面的图标上，外面的按钮正由出现 / 消失的动画管着缩放，两者不抢同一个 transform）。
 * - 减少动态 → 不缩放、不模糊，只淡入淡出。
 */
function SearchField({
  className,
  ref,
  value,
  defaultValue,
  onChange,
  onValueChange,
  onQueryChange,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  id,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  ...props
}: React.ComponentProps<"input"> & {
  /** 每次打字、清除都回传当前文字（清除时为空串） */
  onValueChange?: (value: string) => void
  /** 拿去筛选的文字：同 onValueChange，但输入法组字途中不回传，组完字回传一次 */
  onQueryChange?: (value: string) => void
}) {
  const input = React.useRef<HTMLInputElement | null>(null)
  const refs = useComposedRefs(input, ref)
  const [typed, setTyped] = React.useState(String(defaultValue ?? ""))
  const filled = String(value ?? typed).length > 0
  const reduce = useReducedMotion()
  const { labelledBy: _, ...field } = useFieldControl({ id, "aria-describedby": describedBy, "aria-invalid": invalid })
  const composing = React.useRef(false)
  // 这一次清空是不是 Esc 引起的：命令键 0ms（清除按钮直接消失）
  const [escaped, setEscaped] = React.useState(false)

  // 走原生 setter 再派发 input 事件，React 的 onChange 与非受控状态都能收到
  const clear = () => {
    const el = input.current
    if (!el) return
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, "")
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.focus()
  }

  const instant = escaped && !filled
  const press = usePressScale<HTMLSpanElement>(0.9)
  return (
    <label
      data-slot="search-field"
      className={cn(
        fieldSurface,
        "group flex h-(--ds-h-md) w-full cursor-text items-center gap-(--ds-gap-control) rounded-control px-(--ds-pad-x-icon) text-md",
        "has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-40",
        "has-[input[aria-invalid=true]]:shadow-[inset_0_0_0_1px_var(--ds-danger)]",
        className
      )}
    >
      <Search
        className="size-(--ds-icon) shrink-0 text-fg-muted group-focus-within:text-fg"
        aria-hidden
      />
      <input
        ref={refs}
        type="search"
        value={value}
        defaultValue={defaultValue}
        onChange={(e) => {
          setTyped(e.target.value)
          if (e.target.value) setEscaped(false)
          onChange?.(e)
          onValueChange?.(e.target.value)
          if (!composing.current && !(e.nativeEvent as InputEvent).isComposing) onQueryChange?.(e.target.value)
        }}
        onCompositionStart={(e) => {
          composing.current = true
          onCompositionStart?.(e)
        }}
        onCompositionEnd={(e) => {
          composing.current = false
          onCompositionEnd?.(e)
          onQueryChange?.(e.currentTarget.value)
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (e.defaultPrevented || e.key !== "Escape" || isComposing(e.nativeEvent) || !e.currentTarget.value) return
          // 有内容：这一下 Esc 只清空，不往外传
          e.preventDefault()
          e.stopPropagation()
          setEscaped(true)
          clear()
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-muted disabled:cursor-not-allowed [&::-webkit-search-cancel-button]:hidden"
        {...field}
        {...props}
      />
      <motion.button
        type="button"
        data-slot="search-field-clear"
        aria-label="清除搜索"
        tabIndex={-1}
        disabled={!filled || props.disabled}
        onPointerDown={press.press}
        onPointerUp={press.release}
        onPointerLeave={press.release}
        onPointerCancel={press.release}
        onClick={() => {
          setEscaped(false)
          clear()
        }}
        initial={false}
        animate={
          filled
            ? { willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 1, scale: 1, filter: "blur(0px)" }
            : { willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 0, scale: reduce ? 1 : 0.8, filter: reduce ? "blur(0px)" : "blur(4px)" }
        }
        transition={instant ? { duration: 0 } : filled ? SPRINGS.fast : EXIT.fast}
        className={cn(
          // 图标 16，点按区用伪元素补到 24（触屏 44，DESIGN.md §4.6）
          "relative grid size-(--ds-icon) shrink-0 place-items-center rounded-full text-fg-muted transition-colors duration-(--ds-dur-fast) ease-ds hover:text-fg before:absolute before:-inset-1 before:content-[''] pointer-coarse:before:-inset-3.5",
          !filled && "pointer-events-none"
        )}
      >
        <span ref={press.node} data-slot="search-field-clear-icon" className="grid size-(--ds-icon) place-items-center">
          <CircleX className="size-(--ds-icon)" aria-hidden />
        </span>
      </motion.button>
    </label>
  )
}

export { SearchField }
