"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { motion, useReducedMotion } from "motion/react"
import { Copy } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { EASE_OUT, EXIT } from "@/components/ui/ease"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { Tooltip } from "@/components/ui/tooltip"

/**
 * 复制：复制一个值，并在原处确认（DESIGN.md §5「反馈」：成功就地 ✓ 保持 2 秒，再点重新计时）。两种外形：
 * - CopyButton：一颗按钮（Button），放在值旁边、列表行尾（iconOnly）。
 * - CopyField：整行是一颗按钮——标签 + 值 + 复制图标（或「复制」二字）。悬停时整段值叠一层强调色 20% 的高亮（<mark>，左右留 8 不贴字）、
 *   图标线 1.5 → 2、颜色 fg-muted → fg（80ms），整段值读起来就是点的目标。高与控件同档（36 · 28）。
 * 共同规则：
 * - 剪贴板被拒、不可用（非安全上下文）时先退回 execCommand（只对已经拿到的文字）；还不行显示「复制失败」✕，不假装成功；2 秒后同样复位，再点就是重试。
 * - 值要异步取到时（点了才生成的 Markdown）传 Promise 或返回 Promise 的函数：带着 Promise 交给 ClipboardItem，写入仍发生在这次点击里。
 * - 宽度永远不变：图标在同一格里互换；带字时三段文字叠在同一格，格宽取最宽的那段（中文「复制失败」比「已复制」宽，所以不只拿「已复制」占位），字左对齐。
 * - 读屏：按钮的名字跟着状态换（复制 → 已复制 / 复制失败）；CopyField 有标签时名字是「复制 + 标签」（aria-labelledby 先指自己再指标签）。
 *   结果另由页面底部一个 role="status" 念出「label：已复制」。
 * - 提示（iconOnly、CopyField 的图标版）：按下那一刻提示开着，复制后提示原地换成结果并留着；没开着就不因为点击冒出来。
 *   结果复位后、指针离开后提示不再自己弹回，指针移出再移进才恢复平常的悬停提示。
 * - 默认 type="button"：放在表单里不会顺手提交表单。
 *
 * 动效（DESIGN.md §4.2「图标互换」）：
 * - 复制完成 → 复制图标与 ✓（或 ✕）在同一格交叉：出现的走 fast 全长 0.08s（easeOut），消失的走 fast 的退场 0.06s（easeIn），
 *   带 4px 模糊与 0.6 缩放；✓ / ✕ 同时一笔画出（pathLength 0 → 1，0.08s easeOut）。已经是「已复制」时再点，✓ 重画一次（按复制次数换 key）。
 * - 文字（带字时）同格交叉，时长同图标，模糊 4px。
 * - 2000ms 后复位 → 原路换回。
 * - 键盘（Enter / 空格）复制 → 0ms，直接换。
 * - 减少动态 → 不缩放、不模糊、不画笔画，只淡入淡出。
 */
type CopyState = "idle" | "copied" | "error"
type CopyValue = string | Promise<string> | (() => string | Promise<string>)

const RESET_AFTER = 2000

/** 异步剪贴板用不了时的退路：屏幕外的临时 textarea + execCommand（只在点击里调，不在挂载时） */
function copyViaSelection(text: string) {
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  // 16px：iOS Safari 会放大聚焦的小字号输入框；select() 可能聚焦它
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px"
  document.body.append(area)
  area.select()
  area.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand("copy")
  } catch {
    ok = false
  }
  area.remove()
  return ok
}

function writeClipboard(value: CopyValue): Promise<void> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
  const text = typeof value === "function" ? value() : value
  const fallback = (error?: unknown) => {
    if (typeof text === "string" && copyViaSelection(text)) return
    throw error ?? new Error("剪贴板不可用")
  }
  if (!clipboard) return Promise.resolve().then(() => fallback())
  if (typeof text === "string") return clipboard.writeText(text).catch(fallback)
  if (typeof ClipboardItem !== "undefined" && clipboard.write) {
    return clipboard.write([new ClipboardItem({ "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) })])
  }
  return text.then((t) => clipboard.writeText(t))
}

/**
 * 复制状态：copy(value) 返回是否成功；成功和失败都停留 resetAfter 毫秒，每次复制重新计时（只认最后一次）。
 * count 每次复制加一：✓ 按它换 key，再点一次重画。卸载后结果到达也不再改状态、不再起计时器。
 */
function useCopy({ resetAfter = RESET_AFTER }: { resetAfter?: number } = {}) {
  const [state, setState] = React.useState<CopyState>("idle")
  const [count, setCount] = React.useState(0)
  const timer = React.useRef(0)
  const latest = React.useRef(0)
  const alive = React.useRef(true)
  React.useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      window.clearTimeout(timer.current)
    }
  }, [])
  const copy = React.useCallback(
    (value: CopyValue) => {
      const n = ++latest.current
      let write: Promise<void>
      try {
        write = writeClipboard(value)
      } catch (error) {
        write = Promise.reject(error)
      }
      return write.then(
        () => true,
        () => false
      ).then((ok) => {
        if (!alive.current || n !== latest.current) return ok
        setState(ok ? "copied" : "error")
        setCount((c) => c + 1)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setState("idle"), resetAfter)
        return ok
      })
    },
    [resetAfter]
  )
  return { state, count, copy }
}

/** 换图标的方式：full 完整（缩放 + 模糊）· reduce 只淡入淡出 · key 键盘直接换 */
type Mode = "full" | "reduce" | "key"
const SWAP_IN = { type: "tween", duration: 0.08, ease: EASE_OUT } as const
const SWAP_OUT = { ...EXIT.fast, ease: "easeIn" } as const
const INSTANT = { duration: 0 } as const
const swap = (current: boolean, mode: Mode) => ({
  opacity: current ? 1 : 0,
  scale: current || mode !== "full" ? 1 : 0.6,
  filter: current || mode !== "full" ? "blur(0px)" : "blur(4px)",
  transition: mode === "key" ? INSTANT : current ? SWAP_IN : SWAP_OUT,
})

/** 一笔画出的 ✓ / ✕：24 格画在图标格里；线宽随格子换算成屏幕上的 1.5，悬停时乘 4/3 成 2（--copy-k） */
function DrawnMark({ kind, mode, draw }: { kind: "check" | "cross"; mode: Mode; draw: number }) {
  const d = kind === "check" ? "M4 12l5 5L20 6" : "M7 7l10 10M17 7L7 17"
  return (
    // 不加 class lucide：non-scaling-stroke 会改动 pathLength 的虚线换算
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="size-full transition-[stroke-width] duration-(--ds-dur-fast) ease-ds [stroke-width:calc(var(--copy-stroke,2.25)*var(--copy-k,1))]"
    >
      <motion.path key={draw} d={d} initial={mode === "full" ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={SWAP_IN} />
    </svg>
  )
}

/** 图标格：复制图标、✓、✕ 叠在同一格里交叉（格子尺寸不变） */
function CopyGlyph({ state, mode, count, className }: { state: CopyState; mode: Mode; count: number; className?: string }) {
  return (
    <span aria-hidden data-slot="copy-glyph" className={cn("grid shrink-0 *:[grid-area:1/1]", className)}>
      <motion.span data-slot="copy-idle" className="grid size-full place-items-center" initial={false} animate={swap(state === "idle", mode)}>
        <Copy className="size-full" />
      </motion.span>
      <motion.span data-slot="copy-copied" className="grid size-full place-items-center text-success" initial={false} animate={swap(state === "copied", mode)}>
        {state === "copied" ? <DrawnMark kind="check" mode={mode} draw={count} /> : <DrawnMark kind="check" mode="key" draw={0} />}
      </motion.span>
      <motion.span data-slot="copy-error" className="grid size-full place-items-center text-danger" initial={false} animate={swap(state === "error", mode)}>
        {state === "error" ? <DrawnMark kind="cross" mode={mode} draw={count} /> : <DrawnMark kind="cross" mode="key" draw={0} />}
      </motion.span>
    </span>
  )
}

const STATES: CopyState[] = ["idle", "copied", "error"]

/** 三段文字叠在同一格：格宽取最宽的一段，当前那段可见，左对齐 */
function CopyLabels({ state, mode, labels }: { state: CopyState; mode: Mode; labels: Record<CopyState, string> }) {
  return (
    <span aria-hidden className="grid text-start *:[grid-area:1/1]">
      {STATES.map((s) => (
        <motion.span key={s} initial={false} animate={{ ...swap(s === state, mode), scale: 1 }}>
          {labels[s]}
        </motion.span>
      ))}
    </span>
  )
}

/**
 * 提示的去留（见文件头「提示」）：按下那一刻记下提示开没开；复制后开着的换成结果并留住，没开的压住；
 * 结果复位或指针离开后压住，指针重新进来才放开。
 */
function useResultTip(state: CopyState) {
  const [hovered, setHovered] = React.useState(false)
  const [mode, setMode] = React.useState<"idle" | "result" | "suppressed">("idle")
  const shown = React.useRef(false)
  const wasShown = React.useRef(false)
  // 结果复位：在绘制前压住，提示不会先闪一帧「复制」
  React.useLayoutEffect(() => {
    if (state === "idle") setMode((m) => (m === "result" ? "suppressed" : m))
  }, [state])
  const open = mode === "result" ? true : mode === "suppressed" ? false : hovered
  shown.current = open
  return {
    open,
    onOpenChange: setHovered,
    /** 按下（指针）或键盘点击前记下：提示这会儿开着吗 */
    capture: () => (wasShown.current = shown.current),
    /** 复制结果出来了 */
    settle: () => setMode(wasShown.current ? "result" : "suppressed"),
    enter: () => setMode((m) => (m === "suppressed" ? "idle" : m)),
    leave: () => setMode((m) => (m === "result" ? "suppressed" : m)),
  }
}

/** 读屏播报区放在 body 下：按钮的子元素对读屏是「展示用」的，里面的 status 不可靠 */
function CopyStatus({ text }: { text: string }) {
  const [region, setRegion] = React.useState<HTMLElement | null>(null)
  React.useEffect(() => setRegion(document.body), [])
  return region
    ? createPortal(
        <span role="status" className="sr-only">
          {text}
        </span>,
        region
      )
    : null
}

type CopyOptions = {
  /** 要复制的值；要点了才算出来的传 Promise 或返回 Promise 的函数 */
  value: CopyValue
  /** 动作名，也是按钮静止时的无障碍名称 */
  label?: string
  copiedLabel?: string
  errorLabel?: string
  /** 成功或失败停留的毫秒数 */
  resetAfter?: number
  onCopied?: () => void
  onCopyError?: () => void
}

/** 两种外形共用：状态、换法、提示、点击 */
function useCopyAction({ value, label = "复制", copiedLabel = "已复制", errorLabel = "复制失败", resetAfter = RESET_AFTER, onCopied, onCopyError }: CopyOptions) {
  const { state, count, copy } = useCopy({ resetAfter })
  const reduce = useReducedMotion()
  const [mode, setMode] = React.useState<Mode>("full")
  const tip = useResultTip(state)
  const labels = { idle: label, copied: copiedLabel, error: errorLabel }
  const run = (event: React.MouseEvent) => {
    // 这次换图标怎么动，在点下的那一刻定：键盘直接换
    const keyboard = event.detail === 0 || fromKeyboard()
    if (keyboard) tip.capture()
    setMode(keyboard ? "key" : reduce ? "reduce" : "full")
    void copy(value).then((ok) => {
      tip.settle()
      if (ok) onCopied?.()
      else onCopyError?.()
    })
  }
  return { state, count, mode, tip, labels, run, status: state === "idle" ? "" : `${label}：${labels[state]}` }
}

type CopyButtonProps = Omit<React.ComponentProps<typeof Button>, "children" | "onClick" | "value" | "asChild" | "loading"> &
  CopyOptions & {
    /** 只有图标：自带提示，提示跟着状态换 */
    iconOnly?: boolean
    /** iconOnly 提示出现在哪一边；列表行尾的按钮用 left，不盖住下一行的按钮（DESIGN.md §4.5） */
    tooltipSide?: "top" | "bottom" | "left" | "right"
  }

function CopyButton({ value, label, copiedLabel, errorLabel, resetAfter, onCopied, onCopyError, iconOnly = false, tooltipSide, variant, size, className, ...props }: CopyButtonProps) {
  const { state, count, mode, tip, labels, run, status } = useCopyAction({ value, label, copiedLabel, errorLabel, resetAfter, onCopied, onCopyError })
  const button = (
    <Button
      type="button"
      {...props}
      variant={variant ?? (iconOnly ? "ghost" : "secondary")}
      size={size ?? (iconOnly ? "icon" : "sm")}
      data-slot="copy-button"
      data-copy-state={state}
      aria-label={labels[state]}
      // 悬停时 ✓ / ✕ 的线同按钮里的 lucide 图标一样 1.5 → 2；sm 的 14 格、md 的 16 格换算不同
      className={cn("[--copy-stroke:2.25] data-[size=sm]:[--copy-stroke:2.57] data-[size=icon-sm]:[--copy-stroke:2.57] hover:[--copy-k:1.3333]", className)}
      onPointerDown={tip.capture}
      onPointerEnter={tip.enter}
      onPointerLeave={tip.leave}
      onClick={(e) => {
        // 只有图标：这次点击不让提示收起（Radix 见到 defaultPrevented 就不关），结果出来后由 useResultTip 决定去留
        if (iconOnly) e.preventDefault()
        run(e)
      }}
    >
      {/* 换文案身份固定：按钮里只有这一个子组件，Button 不做自己的换字 morph */}
      <CopyFace state={state} mode={mode} count={count} labels={labels} iconOnly={iconOnly} />
    </Button>
  )
  return (
    <>
      {iconOnly ? (
        <Tooltip content={labels[state]} side={tooltipSide} open={tip.open} onOpenChange={tip.onOpenChange}>
          {button}
        </Tooltip>
      ) : (
        button
      )}
      <CopyStatus text={status} />
    </>
  )
}

function CopyFace({ state, mode, count, labels, iconOnly }: { state: CopyState; mode: Mode; count: number; labels: Record<CopyState, string>; iconOnly: boolean }) {
  return (
    <span aria-hidden className="flex items-center gap-1.5">
      <CopyGlyph state={state} mode={mode} count={count} className="size-(--button-icon)" />
      {iconOnly ? null : <CopyLabels state={state} mode={mode} labels={labels} />}
    </span>
  )
}

type CopyFieldProps = Omit<React.ComponentProps<"div">, "children" | "onCopy"> &
  Omit<CopyOptions, "value" | "label"> & {
    /** 显示并复制的值 */
    value: string
    /** 值上方的名字，也拼进按钮的名字（「复制 API Key」） */
    label?: string
    /** 动作名：带字时显示，图标版是提示与按钮名 */
    actionLabel?: string
    /** 只有图标（默认，带提示）；false 时图标后带「复制」二字 */
    iconOnly?: boolean
    /** 动作在值的哪一边 */
    align?: "start" | "end"
    disabled?: boolean
  }

/** 整行复制：标签 + 值 + 动作，整行一颗按钮（见文件头） */
function CopyField({
  value,
  label,
  actionLabel = "复制",
  copiedLabel,
  errorLabel,
  resetAfter,
  onCopied,
  onCopyError,
  iconOnly = true,
  align = "end",
  disabled,
  className,
  ...props
}: CopyFieldProps) {
  const { state, count, mode, tip, labels, run, status } = useCopyAction({ value, label: actionLabel, copiedLabel, errorLabel, resetAfter, onCopied, onCopyError })
  const id = React.useId()
  const buttonId = `${id}-button`
  const labelId = `${id}-label`
  const action = (
    <span className="flex shrink-0 items-center gap-(--ds-gap-control) px-(--ds-pad-row) text-fg-muted transition-colors duration-(--ds-dur-fast) ease-ds group-hover/copy:text-fg">
      <CopyGlyph state={state} mode={mode} count={count} className="size-(--ds-icon)" />
      {iconOnly ? null : <CopyLabels state={state} mode={mode} labels={labels} />}
    </span>
  )
  const button = (
    <button
      id={buttonId}
      type="button"
      data-slot="copy-field-button"
      data-copy-state={state}
      disabled={disabled}
      aria-label={labels[state]}
      aria-labelledby={label ? `${buttonId} ${labelId}` : undefined}
      onPointerDown={tip.capture}
      onClick={(e) => {
        if (iconOnly) e.preventDefault()
        run(e)
      }}
      className={cn(
        "group/copy flex h-(--ds-h-md) w-full min-w-0 items-center rounded-control text-(length:--ds-text-control) leading-(--ds-lh-control) outline-none select-none",
        "focus-visible:focus-ring disabled:pointer-events-none",
        // 图标线：lucide 的复制图标与画出来的 ✓ ✕ 一起 1.5 → 2
        "[--copy-stroke:2.25] in-data-[density=compact]:[--copy-stroke:2.57] hover:[--copy-k:1.3333] [&_svg.lucide]:transition-[stroke-width] [&_svg.lucide]:duration-(--ds-dur-fast) hover:[&_svg.lucide]:stroke-2",
        align === "start" && "flex-row-reverse"
      )}
    >
      <span className="min-w-0 flex-1 truncate text-start font-mono text-fg">
        {/* 悬停时整段值叠强调色 20%：左右各留 8，底色不贴字（DESIGN.md 红线 5） */}
        <mark className="rounded-sm bg-transparent px-(--ds-pad-row) text-fg transition-colors duration-(--ds-dur-fast) ease-ds group-hover/copy:bg-[color-mix(in_srgb,var(--ds-accent)_20%,transparent)]">
          {value}
        </mark>
      </span>
      {action}
    </button>
  )
  return (
    <div
      data-slot="copy-field"
      className={cn("grid min-w-0 gap-2", disabled && "cursor-not-allowed opacity-40", className)}
      onPointerEnter={tip.enter}
      onPointerLeave={tip.leave}
      {...props}
    >
      {label ? (
        <span id={labelId} className="pl-(--ds-pad-row) text-sm font-medium text-fg">
          {label}
        </span>
      ) : null}
      {iconOnly ? (
        <Tooltip content={labels[state]} side="top" open={tip.open} onOpenChange={tip.onOpenChange}>
          {button}
        </Tooltip>
      ) : (
        button
      )}
      <CopyStatus text={status} />
    </div>
  )
}

export { CopyButton, CopyField, useCopy, writeClipboard, type CopyButtonProps, type CopyFieldProps, type CopyState, type CopyValue }
