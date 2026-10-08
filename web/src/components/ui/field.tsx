"use client"

import { nextFrame } from "@/components/ui/frame"

import * as React from "react"
import { CircleAlert } from "lucide-react"
import { animate, AnimatePresence, motion, useIsPresent, useMotionValue, useReducedMotion, type AnimationPlaybackControls } from "motion/react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { EASE_OUT, EXIT, SPRINGS, FROM_FIRST_FRAME } from "@/components/ui/ease"
import { useFluidHover } from "@/components/ui/fluid-hover"
import { fromKeyboard, isEditable } from "@/components/ui/hotkeys"
import { useInvariant } from "@/components/ui/invariant"

/**
 * 表单项：标签 → 控件 → 说明或错误，间距 8。出错时控件用 aria-invalid 显示红边，只有图标为红色。
 * 自动接线（照 uiarc：说明与错误的 id 合进 aria-describedby）：Field 里的控件调用 useFieldControl（Input、Textarea、SearchField
 * 和文本框、特殊输入组的组件都已接上），就自动拿到 id、aria-describedby（说明 + 错误）、aria-invalid（有错误时）；
 * FieldLabel 不写 htmlFor 时指向这个控件。显式传的 id、htmlFor、aria-invalid 优先，aria-describedby 合并去重。
 *
 * FieldGroup：一叠字段共用一块跟随悬停（DESIGN.md K2）。字段静止透明、没有线，离指针最近的那一格浅叠色 + 1px 线，
 * 聚焦的那格白底 + 强调色线（外观见 ui/input 的 quietFieldSurface）。指针在两格之间的空隙里也落到最近的一格，不熄灭；
 * 没有另画的高亮块，每格自己画状态。框静止时看不见，所以标签、说明、错误往里缩到和框里的字同一条线（16 · 12，有前导图标时对图标 12 · 8）。
 *
 * 动效（DESIGN.md §4.2）：
 * - 校验出错（系统；指针点提交、点到别处引起）→ 错误行高度从 0 撑开到量出的像素高，moderate（0.16s）；文字淡入 fast（0.08s），同时开始。
 *   下面的内容跟着这条弹簧平稳下移，不跳。
 * - 错误清除 → 高度收起走 moderate 的退场（0.12s，不回弹），文字淡出 0.06s；收起途中文字保持上一句，不闪空。中途反悔从当前高度接着走。
 * - 错误换了一句（原位改写，不先收再开）→ 新句淡入 0.08s、旧句淡出 0.06s，同时 blur 4px 交叉，叠在同一格；行数变了高度 moderate 跟上。
 * - 打字引起的出现、清除、改写（打字带来的内容变化照常动）→ 同上。
 * - 回车提交、Tab 离开这类命令键引起的 → 0ms，直接出现、直接消失、直接换句。
 * - 页面一打开就有的错误直接显示，不做入场；不抖输入框。
 * - FieldGroup 的悬停 → 底色与线 80ms，跟着指针在格之间换。
 * - 减少动态效果 → 高度直接到位，换句不模糊，只留淡入淡出。
 */

/** 最近一次按键是不是在可编辑的地方打字（字符、退格、删除、输入法）。打字照常动，回车、Tab 这类命令键 0ms */
let typing = false
if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    (e) => {
      typing = isEditable(e.target) && (e.isComposing || e.key.length === 1 || e.key === "Backspace" || e.key === "Delete")
    },
    true
  )
}

type FieldPart = "control" | "label" | "description" | "error"
type FieldContextValue = {
  base: string
  parts: Partial<Record<FieldPart, string>>
  set: (part: FieldPart, id: string | undefined) => void
}
const FieldContext = React.createContext<FieldContextValue | null>(null)

function Field({ className, ...props }: React.ComponentProps<"div">) {
  const base = React.useId()
  const [parts, setParts] = React.useState<FieldContextValue["parts"]>({})
  const set = React.useCallback(
    (part: FieldPart, id: string | undefined) => setParts((p) => (p[part] === id ? p : { ...p, [part]: id })),
    []
  )
  const value = React.useMemo(() => ({ base, parts, set }), [base, parts, set])
  const ref = React.useRef<HTMLDivElement>(null)
  const fail = useInvariant("Field")
  // 一列两条线（DESIGN.md §3.2）：附属行（说明 + 重发、标签 + 动作）两端撑开时不许比控件宽，强度条、进度条与控件同宽。
  // 2026-10-05 用户截图：6 个验证码格子右缘 425，下面「44 秒后重发」贴到 529（字段宽 384、格子只占 280）。
  // 底边就是墨迹（2026-10-06 共用层）：Field 不许带底内边距——错误行 0 高时 Field 底边 = 控件底边，字段间距只写在容器上（§3.4 的 24）。
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const pad = parseFloat(getComputedStyle(el).paddingBottom)
      if (pad > 0) return fail(`Field 底部多了 ${pad}px 内边距：错误行不在时 Field 底边就是控件底边，字段之间的 24 写在容器的 gap 上（DESIGN.md §3.4）`)
      // 一个 Field 一个控件：两个控件都拿了字段的 id（同一个 id 出现两次），标签只会指向其中一个
      if (parts.control && el.querySelectorAll(`#${CSS.escape(parts.control)}`).length > 1)
        return fail(`两个控件都登记成了这个字段的控件（id 重复）：附属控件给自己的 aria-label，或拆成两个 Field`)
      const message = parts.control ? fieldColumnBreak(el, parts.control) : null
      if (message) fail(message)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fail, parts.control])
  // 禁用只看控件本身（2026-10-06 共用层：倒计时里停用的「重新发送」把「验证码」标签也调灰，像整个字段停用了）。
  // 控件登记了就看它；没登记的（单选组、复选框）看字段里第一个表单控件。附属按钮不算。
  const [disabled, setDisabled] = React.useState(false)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const control = parts.control ? el.querySelector(`#${CSS.escape(parts.control)}`) : el.querySelector(FORM_CONTROL)
      setDisabled(Boolean(control?.matches(":disabled, [aria-disabled=true], [data-disabled]")))
    }
    read()
    const mo = new MutationObserver(read)
    mo.observe(el, { subtree: true, attributes: true, attributeFilter: ["disabled", "aria-disabled", "data-disabled"] })
    return () => mo.disconnect()
  }, [parts.control])
  return (
    <FieldContext.Provider value={value}>
      {/* 不用 gap：网格的行高不收负值，0 高的错误行前面照样留一个 gap（2026-10-06：五个组件报字段到提交 32 而不是 24）。
          间距写成后一个子项的上外边距，错误行不带外边距、自己在里面 pt-2，所以收起时真正是 0 高。
          content-start：并排的两个字段被网格拉成一样高时，行不跟着拉开，控件仍在同一条线上（2026-10-04 复查：营业时间两个触发器差 4px） */}
      <div
        ref={ref}
        data-slot="field"
        data-disabled={disabled || undefined}
        className={cn(
          "group/field grid content-start [&>:where(*+*:not([data-slot=field-error]))]:mt-2",
          // FieldGroup 里标签、说明、错误往里缩的量：框里字的起点；有前导图标时对齐图标
          "[--field-inset:var(--ds-pad-x-md)] has-[[data-icon-start]]:[--field-inset:var(--ds-pad-x-icon)]",
          className
        )}
        {...props}
      />
    </FieldContext.Provider>
  )
}

/** 没登记控件时，算作字段控件的东西：附属按钮（[data-slot=button]）不算 */
const FORM_CONTROL = "input:not([type=hidden]), textarea, select, [role=radiogroup], [role=checkbox], [role=switch], [role=combobox], [role=slider]"

/** 控件那一行看得见的左右（输入框、格子、按钮这些有外形的东西），不量透明的外层盒子 */
function inkSpan(row: Element) {
  let left = Infinity
  let right = -Infinity
  for (const e of [row, ...row.querySelectorAll("*")]) {
    const cs = getComputedStyle(e)
    const painted =
      e.matches("input, textarea, select, button, [role=textbox], [role=combobox], [contenteditable=true]") ||
      (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") ||
      cs.boxShadow !== "none" ||
      parseFloat(cs.borderLeftWidth) > 0
    if (!painted) continue
    const r = e.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    left = Math.min(left, r.left)
    right = Math.max(right, r.right)
  }
  return right > left ? { left, right } : null
}

/**
 * 看得见的右缘：静止时有底色 / 描边的取盒子；透明的（edge-end 的文字按钮）取字和图标（DESIGN.md §3：量看得见的边）。
 * ghost 按钮静止时是透明的：悬停、按下、展开时的临时底色不算（2026-10-06：悬停「随机生成」时字段一变宽就误报崩溃）。
 * 只量文字节点和 svg，不量元素盒：按钮换字时退场层是 absolute inset-0 并继承内边距，盒子右缘就是按钮右缘（模板 sign-in 误报）。
 */
function inkRight(el: Element) {
  const cs = getComputedStyle(el)
  const ghost = el.matches("[data-slot=button][data-variant=ghost], a")
  const painted = !ghost && ((cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") || cs.boxShadow !== "none" || parseFloat(cs.borderRightWidth) > 0)
  if (painted) return el.getBoundingClientRect().right
  let right = -Infinity
  const range = document.createRange()
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    if (!node.textContent?.trim()) continue
    range.selectNodeContents(node)
    for (const r of range.getClientRects()) if (r.width) right = Math.max(right, r.right)
  }
  for (const svg of el.querySelectorAll("svg")) right = Math.max(right, svg.getBoundingClientRect().right)
  return Number.isFinite(right) ? right : el.getBoundingClientRect().right
}

/** 字段这一列是否断成了两条右线：返回说明文字，没问题返回 null */
function fieldColumnBreak(field: HTMLElement, controlId: string): string | null {
  const control = field.querySelector(`#${CSS.escape(controlId)}`)
  if (!control) return null
  let row: Element | null = control
  while (row && row.parentElement !== field) row = row.parentElement
  if (!row) return null
  const span = inkSpan(row)
  if (!span) return null
  for (const child of field.children) {
    // 不看 visibility：舞台里没切到的示例是 invisible，但已经排好版，量的是同一个几何
    if (child === row || child.getBoundingClientRect().width === 0) continue
    const bar = child.matches("[role=meter], [role=progressbar]") ? child : child.querySelector(":scope > [role=meter], :scope > [role=progressbar]")
    if (bar) {
      const r = bar.getBoundingClientRect()
      if (r.width && (Math.abs(r.left - span.left) > 1 || Math.abs(r.right - span.right) > 1))
        return `条（${r.left.toFixed(0)}–${r.right.toFixed(0)}）和控件（${span.left.toFixed(0)}–${span.right.toFixed(0)}）不一样宽：描述同一个对象的部件同左同右`
      continue
    }
    // 两端撑开的行：≥ 2 个看得见的部件、最后一个被推到右边（justify-between / ml-auto）
    const cs = getComputedStyle(child)
    if (!/flex|grid/.test(cs.display)) continue
    const parts = [...child.children].filter((c) => c.getBoundingClientRect().width > 0)
    if (parts.length < 2) continue
    const last = inkRight(parts[parts.length - 1])
    if (last > span.right + 1.5)
      return `「${child.textContent?.trim().slice(0, 16)}」这一行比控件宽：控件右缘 ${span.right.toFixed(0)}，这一行贴到 ${last.toFixed(0)}。字段宽度跟控件走（w-fit），或控件铺满字段`
  }
  return null
}

/** 在 Field 里登记自己（控件、标签、说明、错误）的 id；离开或不再显示时撤掉 */
function useRegister(part: FieldPart, id: string | undefined) {
  const set = React.useContext(FieldContext)?.set
  React.useLayoutEffect(() => {
    if (!set || !id) return
    set(part, id)
    return () => set(part, undefined)
  }, [set, part, id])
}

type ControlProps = { id?: string; "aria-describedby"?: string; "aria-invalid"?: React.AriaAttributes["aria-invalid"] }

/**
 * 控件接上 Field：返回要写到原生控件上的 id、aria-describedby、aria-invalid，外加标签的 id（labelledBy，给需要拼名字的子按钮）。
 * 不在 Field 里、或 aside（自带 aria-label 的附属控件）时原样返回。
 */
function useFieldControl(props: ControlProps, { aside = false }: { aside?: boolean } = {}) {
  // aside：字段里自带名字的附属控件（标签行、控件旁的「角色」选择器）不是这个字段的控件，不登记、不拿字段的 id，免得两个控件同一个 id
  const field = React.useContext(FieldContext)
  const ctx = aside ? null : field
  const id = props.id ?? (ctx ? `${ctx.base}-control` : undefined)
  useRegister("control", ctx ? id : undefined)
  const describedBy = [...new Set([props["aria-describedby"], ctx?.parts.description, ctx?.parts.error].flatMap((v) => v?.split(/\s+/) ?? []))]
    .filter(Boolean)
    .join(" ")
  return {
    id,
    "aria-describedby": describedBy || undefined,
    "aria-invalid": props["aria-invalid"] ?? (ctx?.parts.error ? true : undefined),
    labelledBy: ctx?.parts.label,
  }
}

function FieldLabel({ className, id, htmlFor, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  const ctx = React.useContext(FieldContext)
  const own = id ?? (ctx ? `${ctx.base}-label` : undefined)
  useRegister("label", own)
  return (
    <LabelPrimitive.Root
      data-slot="field-label"
      id={own}
      htmlFor={htmlFor ?? ctx?.parts.control}
      className={cn(
        "text-sm font-medium text-fg select-none",
        // 字段停用看控件本身（Field 写的 data-disabled），附属按钮停用不连累标签
        "w-fit group-data-disabled/field:cursor-not-allowed group-data-disabled/field:opacity-40",
        "in-data-[slot=field-group]:pl-(--field-inset)",
        className
      )}
      {...props}
    />
  )
}

function FieldDescription({ className, id, ...props }: React.ComponentProps<"p">) {
  const ctx = React.useContext(FieldContext)
  const own = id ?? (ctx ? `${ctx.base}-description` : undefined)
  useRegister("description", own)
  return <p data-slot="field-description" id={own} className={cn("text-xs text-fg-muted in-data-[slot=field-group]:pl-(--field-inset)", className)} {...props} />
}

/** 一句错误的身份：字符串比文字；元素没法比，当作同一句（不交叉） */
const sentenceKey = (node: React.ReactNode) => (typeof node === "string" || typeof node === "number" ? String(node) : node ? "node" : "")
const INSTANT = { duration: 0 } as const
/** 交叉淡化（DESIGN.md §4.2 图标与短文案互换）：出现走 fast 全长 0.08s（easeOut），消失走 fast 的退场 0.06s（easeIn）；透明度与模糊是过渡，不是弹簧 */
const SWAP_IN = { type: "tween", duration: 0.08, ease: EASE_OUT } as const
const SWAP_OUT = { ...EXIT.fast, ease: "easeIn" } as const

/** 一句错误；换句时正在淡出的旧句对读屏隐藏，只念新句 */
function Sentence(props: React.ComponentProps<typeof motion.span>) {
  const present = useIsPresent()
  return <motion.span aria-hidden={!present || undefined} className="col-start-1 row-start-1" {...props} />
}

function FieldError({ className, children, id, ...props }: React.ComponentProps<"p">) {
  const ctx = React.useContext(FieldContext)
  const reduce = useReducedMotion()
  const shown = Boolean(children)
  const own = id ?? (ctx ? `${ctx.base}-error` : undefined)
  useRegister("error", shown ? own : undefined)

  // 收起途中还显示上一句；收完再清掉。换句时 version 加一，新旧两句在同一格里交叉
  const [text, setText] = React.useState(children)
  const [version, setVersion] = React.useState(0)
  if (shown && text !== children) {
    if (text && sentenceKey(text) !== sentenceKey(children)) setVersion((v) => v + 1)
    setText(children)
  }
  const instant = fromKeyboard() && !typing
  const latest = React.useRef({ instant, reduce, shown })
  latest.current = { instant, reduce, shown }

  const inner = React.useRef<HTMLDivElement>(null)
  const height = useMotionValue(0)
  const running = React.useRef<AnimationPlaybackControls | null>(null)
  const mounted = React.useRef(false)
  const target = () => (latest.current.shown ? (inner.current?.offsetHeight ?? 0) : 0)

  // 出现、换句：高度走 moderate 弹簧；清除走 moderate 的退场；命令键、减少动态直接到位
  React.useLayoutEffect(() => {
    const to = target()
    running.current?.stop()
    const done = () => {
      running.current = null
      if (!latest.current.shown) setText(null)
      // 弹簧途中字体到位、宽度变了：落定后按最新高度贴上
      else if (Math.abs(height.get() - target()) > 0.5) height.set(target())
    }
    if (!mounted.current || latest.current.instant || latest.current.reduce) {
      mounted.current = true
      height.set(to)
      if (!shown) setText(null)
      return
    }
    const motionOf = latest.current.shown ? SPRINGS.moderate : EXIT.moderate
    return nextFrame(() => { running.current = animate(height, to, { ...motionOf, ...FROM_FIRST_FRAME, onComplete: done }) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, version])

  // 宽度变了、字体晚到：直接贴到新高度（不是读者引起的，不动画）
  React.useEffect(() => {
    const el = inner.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (!running.current) height.set(target())
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  React.useEffect(() => () => running.current?.stop(), [])

  const fadeIn = SWAP_IN
  const blur = reduce ? "blur(0px)" : "blur(4px)"
  return (
    // Field 不给错误行上外边距，里面用 pt-2 补回：错误不在时这一行真正是 0 高，不留空隙
    <motion.div
      data-slot="field-error"
      className="overflow-hidden"
      style={{ contain: "layout", height }}
      initial={false}
      animate={{ opacity: shown ? 1 : 0 }}
      transition={instant ? INSTANT : shown ? SWAP_IN : SWAP_OUT}
      aria-hidden={!shown}
    >
      <div ref={inner}>
        {text ? (
          <p role="alert" id={own} className={cn("flex items-start gap-1 pt-2 text-xs text-fg-muted in-data-[slot=field-group]:pl-(--field-inset)", className)} {...props}>
            {/* 图标随字定大小（DESIGN.md §4.5：13 号字配 14），装进一行高的盒子对首行中线；长错误换行时留在第一行 */}
            <span aria-hidden className="flex h-lh shrink-0 items-center">
              <CircleAlert className="size-3.5 text-danger" />
            </span>
            <span className="relative grid min-w-0">
              <AnimatePresence initial={false} mode="popLayout">
                <Sentence
                  key={version}
                  initial={instant ? false : { willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 0, filter: blur }}
                  animate={{ willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 1, filter: "blur(0px)", transition: fadeIn }}
                  exit={instant ? { opacity: 0, transition: INSTANT } : { willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 0, filter: blur, transition: SWAP_OUT }}
                >
                  {text}
                </Sentence>
              </AnimatePresence>
            </span>
          </p>
        ) : null}
      </div>
    </motion.div>
  )
}

/** 在不在 FieldGroup 里：在的话字段用 quiet 外观（ui/input 的 useFieldSurface） */
const FieldGroupContext = React.createContext(false)
const useInFieldGroup = () => React.useContext(FieldGroupContext)

/**
 * 一叠字段，共用一块跟随悬停：组里每个 Field 按出现顺序登记成一项，离指针最近的那一格亮（Field 上写 data-fluid-hover）。
 * 增删字段（MutationObserver）时重新登记。空隙里的点击不转给字段（字段不是一次点击就完成的东西）。字段之间 24（DESIGN.md §3.4）。
 */
function FieldGroup({ className, children, ...props }: React.ComponentProps<"div">) {
  const root = React.useRef<HTMLDivElement>(null)
  const { registerItem, handlers } = useFluidHover(root, { gapClick: false })
  React.useEffect(() => {
    const el = root.current
    if (!el) return
    let count = 0
    const scan = () => {
      const fields = [...el.querySelectorAll<HTMLElement>("[data-slot=field]")].filter((f) => f.parentElement?.closest("[data-slot=field-group]") === el)
      fields.forEach((f, i) => registerItem(i, f))
      for (let i = fields.length; i < count; i++) registerItem(i, null)
      count = fields.length
    }
    scan()
    const mo = new MutationObserver(scan)
    mo.observe(el, { childList: true, subtree: true })
    return () => {
      mo.disconnect()
      for (let i = 0; i < count; i++) registerItem(i, null)
    }
  }, [registerItem])
  const { onClick: _, ...pointer } = handlers
  return (
    <FieldGroupContext.Provider value={true}>
      <div ref={root} data-slot="field-group" className={cn("relative isolate grid content-start gap-6", className)} {...pointer} {...props}>
        {children}
      </div>
    </FieldGroupContext.Provider>
  )
}

export { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, useFieldControl, useInFieldGroup }
