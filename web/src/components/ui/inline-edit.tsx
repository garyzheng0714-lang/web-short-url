"use client"

import * as React from "react"
import { Check, X } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { EASE_OUT, EXIT, SPRINGS } from "@/components/ui/ease"
import { FieldError, useFieldControl } from "@/components/ui/field"
import { fromKeyboard, isComposing } from "@/components/ui/hotkeys"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip } from "@/components/ui/tooltip"

/**
 * 原地编辑：标题、名称、一段说明这类读多改少的文字。平时是一块浅凹槽里的字（一个原生按钮，读屏念「标签：内容」），悬停加深一档（DESIGN.md §4.3）。
 * 点一下原位变成输入框：字和编辑框共用同一个格子（隐形的镜像按当前文字撑出宽高），所以字的位置、换行一丝不动；
 * 插入点落在点的位置（键盘进入时全选）。右边一块固定宽的槽：编辑时是保存 / 取消，保存中是转圈，保存后是一笔画出的勾。
 * - 回车或失焦保存，Esc 撤回；多行时 Shift+回车换行。单行粘贴进来的换行变成空格。输入法组字时回车交给输入法（DESIGN.md §4.2）。
 * - validate 返回一句话就不保存，就地报错（FieldError，进 aria-describedby）；失焦时草稿不合格就丢掉草稿、回到原值。
 * - onSave 返回 promise：乐观地先显示新文字，400ms 还没好才转圈（Spinner delay），好了画勾、2 秒后淡去；失败回滚到原值，
 *   就地报一句并给「重试」（重试用的是失败的那份草稿）。这一句由 failureMessage 把拒绝的原因换成人能照着改的话（「展位号重复」），
 *   不直接显示错误原文（「Failed to fetch」不是给人看的）；没给或返回空就是「保存失败」。保存中不能再进编辑，不会重复提交；
 *   卸载后结果不再写状态。
 * - 受控 value（外面的数据是真源，保存成功后由外面更新）或非受控 defaultValue；name 写进隐藏 input。放进 Field 自动接线（useFieldControl）。
 *
 * 动效（DESIGN.md §4.2）：
 * - 指针点 ✓ 保存 → 勾沿路径画出（pathLength），fast（0.08s）；2 秒后淡出，fast 的退场（0.06s）。键盘（回车、Tab）保存 → 勾 0ms 直接出现。
 * - 失败回滚（系统）→ 原来的字淡入 0.08s，blur 4→0（短文案交换）。
 * - 进入、退出编辑 → 0ms：字不动，只换了一层外观（白底 + 聚焦环，同输入框聚焦，即时）。悬停：槽底加深 80ms；✓ ✕ 的图标线 1.5 → 2。
 * - 报错、错误清除 → 照 FieldError：打字引起的 moderate 撑开 / 收起，回车引起的 0ms。
 * - 减少动态 → 勾直接到位，回滚只淡入；转圈改成明暗呼吸（Spinner）。
 */

type Status = "idle" | "saving" | "saved" | "failed"

const TEXT = { title: "font-display text-xl [font-weight:var(--ds-weight-heading)]", body: "text-md" }
/** 文字与编辑框共用的盒子：静止就是凹槽（看得出能点），盒子左缘落在列线上，同输入框（DESIGN.md §3.2：有底色的元素量盒子）；字距边 8 / 4 */
const BOX = "rounded-control px-2 py-1"
/** 槽的高度 = 一行字的行高，下移 4（盒子上内边距），按钮、勾、转圈和第一行字垂直居中 */
const LINE = { title: "h-7.5", body: "h-6" }

/** 指针落在第几个字前面：逐字量这一行的字框，找到第一个中线在指针右边的字；这一行都在左边就落在行尾 */
function caretAt(el: HTMLElement | null, x: number, y: number) {
  const node = el?.firstChild
  if (!node || node.nodeType !== Node.TEXT_NODE) return null
  const len = node.textContent?.length ?? 0
  const range = document.createRange()
  let lineEnd: number | null = null
  for (let i = 0; i < len; i++) {
    range.setStart(node, i)
    range.setEnd(node, i + 1)
    const r = range.getBoundingClientRect()
    if (!r.width || y < r.top || y > r.bottom) continue
    if (x < r.left + r.width / 2) return i
    lineEnd = i + 1
  }
  return lineEnd ?? len
}

function SavedMark({ instant }: { instant: boolean }) {
  const reduce = useReducedMotion()
  return (
    <motion.svg
      data-slot="inline-edit-saved"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className="size-4 text-success"
      exit={{ opacity: 0, transition: EXIT.fast }}
    >
      <motion.path
        d="M3.5 8.5L6.5 11.5L12.5 4.5"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={instant || reduce ? false : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={SPRINGS.fast}
      />
    </motion.svg>
  )
}

function InlineEdit({
  value,
  defaultValue = "",
  onSave,
  label,
  validate,
  failureMessage,
  placeholder = "",
  multiline = false,
  variant = "title",
  as: Tag = "div",
  name,
  disabled,
  id,
  "aria-describedby": describedBy,
  className,
}: {
  /** 受控：已保存的值（外面的数据是真源；保存成功后由外面更新） */
  value?: string
  defaultValue?: string
  /** 保存：返回 promise 时显示保存中、成功、失败；reject 就回滚 */
  onSave: (next: string) => void | Promise<unknown>
  /** 名字，例如「项目名称」；读屏念「项目名称：官网改版」 */
  label: string
  /** 返回一句错误就不保存 */
  validate?: (next: string) => string | null | undefined
  /** 保存失败（onSave reject）时就地显示的一句，后接「重试」；返回空就是「保存失败」 */
  failureMessage?: (error: unknown) => string | null | undefined
  /** 值为空时显示 */
  placeholder?: string
  /** 多行：跟着内容长高，Shift+回车换行 */
  multiline?: boolean
  /** title：名称、标题（20 / 600）；body：说明（15） */
  variant?: "title" | "body"
  /** 外层元素：标题可以保持是 h1、h2 */
  as?: "div" | "p" | "h1" | "h2" | "h3"
  /** 写进隐藏 input，随表单提交已保存的值 */
  name?: string
  disabled?: boolean
  id?: string
  "aria-describedby"?: string
  className?: string
}) {
  const reduce = useReducedMotion()
  const errorId = `${React.useId()}-error`
  const [inner, setInner] = React.useState(defaultValue)
  const saved = value ?? inner
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(saved)
  const [optimistic, setOptimistic] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<Status>("idle")
  const [error, setError] = React.useState<React.ReactNode>(null)
  const [swap, setSwap] = React.useState(0)
  const failed = React.useRef<string | null>(null)
  const instant = React.useRef(false)
  const caret = React.useRef<number | null>(null)
  const textRef = React.useRef<HTMLSpanElement>(null)
  const field = React.useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const button = React.useRef<HTMLButtonElement>(null)
  const composing = React.useRef(false)
  // 编辑框还算不算「在编辑」：回车、Esc 让它卸载时浏览器会补发一次失焦，那一下不能再保存一次
  const live = React.useRef(false)
  const run = React.useRef(0)
  const timer = React.useRef<number | undefined>(undefined)
  const alive = React.useRef(true)
  React.useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      window.clearTimeout(timer.current)
    }
  }, [])

  const shown = optimistic ?? saved
  // 「重试」按钮是失败那一刻造出来的：它调用的 onSave、判断受控与否都要用最新一次渲染的
  const latest = React.useRef({ onSave, failureMessage, controlled: value !== undefined })
  latest.current = { onSave, failureMessage, controlled: value !== undefined }
  const control = useFieldControl({ id, "aria-describedby": [describedBy, error ? errorId : null].filter(Boolean).join(" ") || undefined })
  const invalid = (Boolean(error) && status !== "failed") || control["aria-invalid"] === true || control["aria-invalid"] === "true"

  const start = (at: number | null) => {
    if (disabled || status === "saving") return
    caret.current = at
    live.current = true
    setDraft(shown)
    setError(null)
    setEditing(true)
  }
  React.useLayoutEffect(() => {
    const el = field.current
    if (!editing || !el) return
    el.focus()
    const at = caret.current
    if (at === null) el.select()
    else el.setSelectionRange(at, at)
  }, [editing])

  const leave = (focusText: boolean) => {
    live.current = false
    setEditing(false)
    if (focusText) requestAnimationFrame(() => button.current?.focus())
  }
  const save = (next: string) => {
    const prev = saved
    const me = ++run.current
    window.clearTimeout(timer.current)
    instant.current = fromKeyboard()
    failed.current = null
    setError(null)
    setOptimistic(next)
    setStatus("saving")
    const ok = () => {
      if (!alive.current || me !== run.current) return
      if (!latest.current.controlled) setInner(next)
      setOptimistic(null)
      setStatus("saved")
      timer.current = window.setTimeout(() => alive.current && setStatus((s) => (s === "saved" ? "idle" : s)), 2000)
    }
    const fail = (reason?: unknown) => {
      if (!alive.current || me !== run.current) return
      failed.current = next
      setOptimistic(null)
      setStatus("failed")
      if (prev !== next) setSwap((n) => n + 1)
      setError(
        <>
          {latest.current.failureMessage?.(reason) || "保存失败"}
          <button
            type="button"
            data-slot="inline-edit-retry"
            className="ml-2 font-medium text-fg underline-offset-4 outline-none hover:underline focus-visible:focus-ring-out"
            onClick={() => failed.current !== null && save(failed.current)}
          >
            重试
          </button>
        </>
      )
    }
    try {
      Promise.resolve(latest.current.onSave(next)).then(ok, fail)
    } catch (reason) {
      fail(reason)
    }
  }
  const commit = (via: "key" | "pointer" | "blur") => {
    const next = draft
    const problem = validate?.(next)
    if (problem) {
      // 失焦时不合格：丢掉草稿回到原值，不把人拽回来
      if (via === "blur") {
        setError(null)
        return leave(false)
      }
      return setError(problem)
    }
    leave(via !== "blur")
    if (next !== shown) save(next)
  }
  const cancel = () => {
    setError(null)
    leave(true)
  }

  const box = cn(TEXT[variant], BOX, multiline ? "break-words text-pretty whitespace-pre-wrap" : "overflow-hidden text-ellipsis whitespace-pre")
  const empty = !shown
  return (
    // 不用 gap：错误行收起时 0 高，gap 照样在它前面留 8（字段底边比墨迹多 8）；错误行自己带 pt-2（同 Field）
    <div data-slot="inline-edit" data-editing={editing || undefined} data-status={status} className={cn("flex min-w-0 flex-col", className)}>
      <Tag className="m-0 flex min-w-0 items-start gap-2 [font:inherit]">
        <span className="relative inline-grid min-w-0 grid-cols-[minmax(0,auto)]">
          {/* 镜像：按当前的字撑出格子；编辑框和平时的文字都盖在它上面，所以位置、换行一样 */}
          <span aria-hidden className={cn(box, "invisible col-start-1 row-start-1 min-w-0")}>
            {(editing ? draft : shown) || placeholder || " "}
            {"​"}
          </span>
          {editing ? (
            React.createElement(multiline ? "textarea" : "input", {
              ref: field,
              id: control.id,
              "aria-label": label,
              "aria-describedby": control["aria-describedby"],
              "aria-invalid": invalid || undefined,
              value: draft,
              placeholder,
              rows: multiline ? 1 : undefined,
              type: multiline ? undefined : "text",
              "data-slot": "inline-edit-field",
              className: cn(
                box,
                "absolute inset-0 size-full min-w-0 resize-none overflow-hidden bg-card text-fg shadow-inset focus-ring placeholder:text-fg-muted",
                invalid && "shadow-[inset_0_0_0_1px_var(--ds-danger)]"
              ),
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                const next = multiline ? e.target.value : e.target.value.replace(/[\r\n]+/g, " ")
                setDraft(next)
                if (error && !composing.current) setError(validate?.(next) || null)
              },
              onCompositionStart: () => (composing.current = true),
              onCompositionEnd: () => (composing.current = false),
              onKeyDown: (e: React.KeyboardEvent) => {
                if (isComposing(e.nativeEvent) || composing.current) return
                if (e.key === "Escape") {
                  e.preventDefault()
                  e.stopPropagation()
                  cancel()
                } else if (e.key === "Enter" && !(multiline && e.shiftKey)) {
                  e.preventDefault()
                  commit("key")
                }
              },
              onBlur: (e: React.FocusEvent) => {
                if (!live.current || (e.relatedTarget as HTMLElement | null)?.closest?.("[data-slot=inline-edit-actions]")) return
                commit("blur")
              },
            })
          ) : (
            <button
              ref={button}
              type="button"
              id={control.id}
              data-slot="inline-edit-text"
              aria-label={`${label}：${shown || "未填写"}`}
              aria-describedby={control["aria-describedby"]}
              aria-busy={status === "saving" || undefined}
              disabled={disabled}
              onPointerDown={(e) => {
                if (e.button === 0) caret.current = caretAt(textRef.current, e.clientX, e.clientY)
              }}
              onClick={(e) => start(e.detail === 0 ? null : caret.current)}
              className={cn(
                box,
                "hit-area absolute inset-0 size-full min-w-0 overflow-visible text-start text-fg bg-well shadow-inset outline-none transition-[background-color] duration-(--ds-dur-fast) ease-ds hover:bg-well-hover focus-visible:focus-ring focus-visible:transition-none",
                "disabled:pointer-events-none aria-busy:pointer-events-none"
              )}
            >
              <motion.span
                key={swap}
                ref={textRef}
                className={cn("block", multiline ? "break-words text-pretty whitespace-pre-wrap" : "overflow-hidden text-ellipsis whitespace-pre", empty && "text-fg-muted")}
                initial={swap ? { willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 0, filter: reduce ? "blur(0px)" : "blur(4px)" } : false}
                animate={{ willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 1, filter: "blur(0px)" }}
                transition={{ type: "tween", duration: 0.08, ease: EASE_OUT }}
              >
                {shown || placeholder}
              </motion.span>
            </button>
          )}
        </span>
        <span data-slot="inline-edit-actions" className={cn("mt-1 flex w-15 shrink-0 items-center gap-1", LINE[variant])}>
          {editing ? (
            <>
              <Tooltip content="保存">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="保存"
                  data-slot="inline-edit-save"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => commit("pointer")}
                  className="grid size-7 place-items-center rounded-control text-fg-muted outline-none transition-colors duration-(--ds-dur-fast) ease-ds hover:bg-hover hover:text-fg focus-visible:focus-ring [&_svg.lucide]:transition-[stroke-width] [&_svg.lucide]:duration-(--ds-dur-fast) hover:[&_svg.lucide]:stroke-2"
                >
                  <Check className="size-4" aria-hidden />
                </button>
              </Tooltip>
              <Tooltip content="取消">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="取消"
                  data-slot="inline-edit-cancel"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={cancel}
                  className="grid size-7 place-items-center rounded-control text-fg-muted outline-none transition-colors duration-(--ds-dur-fast) ease-ds hover:bg-hover hover:text-fg focus-visible:focus-ring [&_svg.lucide]:transition-[stroke-width] [&_svg.lucide]:duration-(--ds-dur-fast) hover:[&_svg.lucide]:stroke-2"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </Tooltip>
            </>
          ) : status === "saving" ? (
            <span className="grid size-7 place-items-center text-fg-muted">
              <Spinner delay={400} />
            </span>
          ) : (
            <span className="grid size-7 place-items-center">
              <AnimatePresence>{status === "saved" ? <SavedMark key="saved" instant={instant.current} /> : null}</AnimatePresence>
            </span>
          )}
        </span>
      </Tag>
      <FieldError id={errorId}>{error}</FieldError>
      {name ? <input type="hidden" name={name} value={saved} /> : null}
      <span role="status" className="sr-only">
        {status === "saving" ? "正在保存" : status === "saved" ? "已保存" : ""}
      </span>
    </div>
  )
}

export { InlineEdit }
