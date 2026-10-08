"use client"

import * as React from "react"
import { motion, useReducedMotion, type Transition } from "motion/react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { SPRINGS } from "@/components/ui/ease"
import { FluidHoverHighlight } from "@/components/ui/fluid-hover"
import { DRAW, FocusTrail, MergedSelection, RETRACT, rowGroupAttr, useRowGroup, WeightLabel, type RowGroup } from "@/components/ui/selection-rows"

type CheckedState = boolean | "indeterminate"

/**
 * 复选框（DESIGN.md §4.3「选中」「焦点」、§4.2、§3.1「控件」）。两种用法：
 *
 * Checkbox：单个框，checked / unchecked / "indeterminate"（半选，用于全选）。框 = 图标尺寸（默认 16、紧凑 14，--ds-icon），圆角 sm，勾 12。
 * 带文字写 label（和 description）：框与第一行文字垂直居中对齐，整段文字可点；说明经 aria-describedby 关联。
 * 不写 label 时就是一个框，由使用方用 <label> 包住。未选是凹槽底 + 1.5px fg-subtle 内边（非文字对比 ≥ 3:1）；
 * 悬停（框、整段文字、包住它的 <label>）边加深到 fg-muted（80ms）；勾上后实心主题色，边变透明，勾是白色。焦点 focus-ring-out。
 *
 * CheckboxGroup + CheckboxGroupItem：一列可多选的行（通知方式、导出的文件）。每行高 = 控件高（36 · 紧凑 28），左右 8 · 6，
 * 框到字 8 · 4；整行就是那个 role=checkbox 的按钮，点哪里都切换。
 * - 勾选的行不画实心框：框的 1.5px 边变透明，只留 fg 色的勾；行下面一块选中底（bg-selected），相邻勾选的行合成一块（ui/selection-rows）。
 *   桥接两段的那一行勾上：两块的内沿在这一行中线合拢（moderate 0.16s），内角晚 0.07s 才变直，合拢后无感换成一块；取消中间一行反过来。
 * - 悬停：一块跟随悬停底（fast）；亮着的行边加深、字 fg-muted → fg（80ms）。勾上的字 400 → 600（隐形副本占宽）。
 * - 键盘：每行一个 Tab 停点；↑ ↓ 在行间移动、首尾相接，Home / End 到首行 / 末行，跳过禁用；空格切换（回车不切换，WAI-ARIA）。
 *   整组一个焦点环，在行间 fast 滑动（内收 2px），只在 :focus-visible；键盘移动时悬停底也跟着走。
 *
 * 勾（两种用法同一套）：勾上 → 沿笔画画出（pathLength 0 → 1，0.08s easeOut）；取消 → 收回（0.04s easeIn），收完才隐去；
 * 勾 ↔ 半选横线是同一条三点路径，直接变形（fast）；挂载时已勾的直接画好，不播。键盘与指针同一套档位（DESIGN.md K3）。
 * 减少动态：不画、不变形，只留淡入淡出与颜色。
 */
// 同一条三点路径的两种形状：勾（左下 → 底 → 右上）与横线（左 → 中 → 右），点数相同才能逐点变形
const MARKS = {
  check: "M3 8.5L6.5 12L13 4.5",
  minus: "M3 8L8 8L13 8",
} as const
const SNAP = { duration: 0 } as const

/** 勾与横线：一条路径。从无到有时画出；勾 ↔ 横线时变形；取消时收回，收完再隐去（圆头的 0 长度笔画仍会留一个点） */
function Mark({ state }: { state: CheckedState }) {
  const reduce = useReducedMotion()
  const on = state !== false
  // 取消时保留上一次的形状：收回途中不变形
  const shape = React.useRef<string>(MARKS.check)
  if (on) shape.current = state === "indeterminate" ? MARKS.minus : MARKS.check
  const prev = React.useRef(on)
  const appearing = on && !prev.current
  React.useEffect(() => {
    prev.current = on
  })
  const transition: Transition = reduce
    ? { opacity: on ? DRAW : RETRACT, pathLength: SNAP, d: SNAP }
    : on
      ? { pathLength: DRAW, opacity: SNAP, d: appearing ? SNAP : SPRINGS.fast }
      : { pathLength: RETRACT, opacity: { duration: 0, delay: RETRACT.duration }, d: SNAP }
  return (
    <motion.path
      data-slot="checkbox-path"
      initial={false}
      animate={{ d: shape.current, pathLength: on || reduce ? 1 : 0, opacity: on ? 1 : 0 }}
      transition={transition}
    />
  )
}

function MarkSvg({ state }: { state: CheckedState }) {
  return (
    <svg data-slot="checkbox-mark" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-3">
      <Mark state={state} />
    </svg>
  )
}

/** 未选的边：1.5px，颜色走 --mark-line（悬停加深、勾上透明、出错红色都只改这个变量） */
const LINE = "[--mark-line:var(--ds-fg-subtle)] shadow-[inset_0_0_0_1.5px_var(--mark-line)]"

function Checkbox({
  className,
  label,
  description,
  id: idProp,
  checked: checkedProp,
  defaultChecked,
  onCheckedChange,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  /** 框右边的文字，整段可点 */
  label?: React.ReactNode
  /** 文字下面的一行说明，经 aria-describedby 关联 */
  description?: React.ReactNode
}) {
  const auto = React.useId()
  const id = idProp ?? auto
  const [uncontrolled, setUncontrolled] = React.useState<CheckedState>(defaultChecked ?? false)
  const checked = checkedProp ?? uncontrolled

  const root = (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      id={id}
      aria-describedby={description ? `${id}-desc` : props["aria-describedby"]}
      checked={checked}
      onCheckedChange={(next) => {
        if (checkedProp === undefined) setUncontrolled(next)
        onCheckedChange?.(next)
      }}
      className={cn(
        "grid size-(--ds-icon) scroll-m-4 shrink-0 place-items-center rounded-sm bg-well text-primary-fg outline-none",
        LINE,
        "transition-[background-color,box-shadow] duration-(--ds-dur-fast) ease-ds",
        "data-[state=unchecked]:hover:[--mark-line:var(--ds-fg-muted)] data-[state=unchecked]:in-[label:hover]:[--mark-line:var(--ds-fg-muted)] data-[state=unchecked]:group-hover/field:[--mark-line:var(--ds-fg-muted)]",
        "data-[state=checked]:bg-primary data-[state=checked]:[--mark-line:transparent] data-[state=indeterminate]:bg-primary data-[state=indeterminate]:[--mark-line:transparent]",
        "aria-invalid:[--mark-line:var(--ds-danger)]",
        "focus-visible:focus-ring-out",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
      {...props}
    >
      <MarkSvg state={checked} />
    </CheckboxPrimitive.Root>
  )
  if (label === undefined && description === undefined) return root
  // 框高 16 放进一行文字的行高（24）里垂直居中：框与第一行文字对齐，多行时说明往下长
  return (
    <div data-slot="checkbox-field" data-disabled={props.disabled ? "" : undefined} className="group/field flex gap-2 text-sm">
      <span className="flex h-6 pointer-coarse:h-(--ds-h-md) shrink-0 items-center">{root}</span>
      <span className="grid min-w-0 group-data-disabled/field:opacity-40">
        {label !== undefined ? (
          <label htmlFor={id} className="pointer-coarse:flex pointer-coarse:min-h-(--ds-h-md) pointer-coarse:items-center text-fg group-data-disabled/field:cursor-not-allowed">
            {label}
          </label>
        ) : null}
        {description !== undefined ? (
          <span id={`${id}-desc`} className="text-xs text-fg-muted">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  )
}

type GroupContextValue = {
  value: readonly string[]
  toggle: (value: string) => void
  disabled?: boolean
  name?: string
  group: RowGroup<HTMLDivElement>
}
const GroupContext = React.createContext<GroupContextValue | null>(null)

function CheckboxGroup({
  value: valueProp,
  defaultValue,
  onValueChange,
  disabled,
  name,
  className,
  children,
  onKeyDown,
  ...props
}: Omit<React.ComponentProps<"div">, "defaultValue" | "onChange"> & {
  /** 勾上的值 */
  value?: string[]
  defaultValue?: string[]
  onValueChange?: (value: string[]) => void
  /** 整组禁用 */
  disabled?: boolean
  /** 表单字段名：在 <form> 里时每个勾上的行带一个同名的隐藏 input */
  name?: string
}) {
  const [inner, setInner] = React.useState<string[]>(defaultValue ?? [])
  const value = valueProp ?? inner
  const group = useRowGroup<HTMLDivElement>()
  const latest = React.useRef(value)
  latest.current = value
  const toggle = React.useCallback(
    (v: string) => {
      const now = latest.current
      const next = now.includes(v) ? now.filter((x) => x !== v) : [...now, v]
      if (valueProp === undefined) setInner(next)
      onValueChange?.(next)
    },
    [valueProp, onValueChange]
  )
  const checked = group.order.flatMap((v, i) => (value.includes(v) ? [i] : []))

  /** ↑ ↓ 首尾相接，Home / End 到两端；只在行之间走，跳过禁用的行 */
  const move = (e: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e)
    const el = group.ref.current
    if (e.defaultPrevented || !el) return
    const rows = [...el.querySelectorAll<HTMLButtonElement>("[data-slot=checkbox-row]")].filter((r) => r.closest("[data-row-group]") === el && !r.disabled)
    const i = rows.indexOf(e.target as HTMLButtonElement)
    if (i < 0) return
    const n = rows.length
    const next = e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowUp" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1
    if (next < 0) return
    e.preventDefault()
    rows[next].focus()
  }

  return (
    <GroupContext.Provider value={{ value, toggle, disabled, name, group }}>
      <div
        ref={group.ref}
        role="group"
        data-slot="checkbox-group"
        {...rowGroupAttr}
        {...props}
        {...group.handlers}
        onKeyDown={move}
        className={cn("relative isolate grid select-none", className)}
      >
        <MergedSelection group={group} checked={checked} className="rounded-row" />
        <FluidHoverHighlight hover={group.hover} className="rounded-row" />
        <FocusTrail group={group} className="rounded-row" />
        {children}
      </div>
    </GroupContext.Provider>
  )
}

function CheckboxGroupItem({
  value,
  label,
  disabled,
  className,
  ...props
}: Omit<React.ComponentProps<typeof CheckboxPrimitive.Root>, "checked" | "defaultChecked" | "onCheckedChange" | "value" | "children"> & {
  value: string
  /** 行里的文字，也是读屏念的名字 */
  label: React.ReactNode
}) {
  const ctx = React.useContext(GroupContext)
  const { ref, ...row } = ctx?.group.rowProps(value) ?? {}
  const outer = props.ref
  // ref 回调要稳定：每次渲染换新函数，React 会先传 null 再传元素，跟随悬停每次都重量一轮、选中底闪一下
  const merged = React.useCallback(
    (el: HTMLButtonElement | null) => {
      ref?.(el)
      if (typeof outer === "function") outer(el)
      else if (outer) outer.current = el
    },
    [ref, outer]
  )
  if (!ctx) throw new Error("CheckboxGroupItem 要放在 CheckboxGroup 里")
  const on = ctx.value.includes(value)
  const off = Boolean(ctx.disabled || disabled)
  return (
    <CheckboxPrimitive.Root
      {...props}
      {...row}
      ref={merged}
      data-slot="checkbox-row"
      checked={on}
      onCheckedChange={() => ctx.toggle(value)}
      value={value}
      name={ctx.name}
      disabled={off}
      className={cn(
        "group/row flex h-(--ds-h-md) w-full min-w-0 items-center gap-(--ds-gap-control) rounded-row px-(--ds-pad-row) text-left text-(length:--ds-text-control) leading-(--ds-lh-control) outline-none",
        "focus-visible:focus-ring focus-visible:data-focus-trail:outline-transparent",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
    >
      <span
        data-slot="checkbox-box"
        data-state={on ? "checked" : "unchecked"}
        className={cn(
          "grid size-(--ds-icon) shrink-0 place-items-center rounded-sm text-fg",
          LINE,
          "transition-[box-shadow] duration-(--ds-dur-fast) ease-ds",
          "data-[state=unchecked]:group-data-fluid-hover/row:[--mark-line:var(--ds-fg-muted)] data-[state=checked]:[--mark-line:transparent]"
        )}
      >
        <MarkSvg state={on} />
      </span>
      <WeightLabel on={on}>{label}</WeightLabel>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox, CheckboxGroup, CheckboxGroupItem }
