"use client"

import * as React from "react"
import { useComposedRefs } from "motion/react"

import { cn } from "@/lib/utils"
import { useFieldControl, useInFieldGroup } from "@/components/ui/field"

/**
 * 字段外观（Input、Textarea、SearchField、SelectTrigger、密码框、数字框、标签输入……共用）。
 * 状态按优先级排，命中第一条就停（DESIGN.md §4.3）：禁用 → 出错 → 聚焦 → 悬停 → 静止。
 * 两套外形：
 * - fieldSurface（默认，凹）：静止浅灰槽底 + 1px 内线；悬停槽底加深一档；聚焦槽底变白、那条线变成 1.5px 强调色（不另套外环）；
 *   出错静止就是 1px 红线，聚焦时 1.5px 红线；禁用 40%，悬停不变。
 * - quietFieldSurface（FieldGroup 里）：静止全透明、没有线；离指针最近的那一格（跟随悬停，Field 上的 data-fluid-hover）浅叠色 + 1px 线；
 *   聚焦白底 + 1.5px 强调色线；出错静止仍透明（错误行的红图标已经说明），悬停浅红底 + 1px 红线、聚焦白底 + 1.5px 红线；禁用透明 + 1px 线 + 40%。
 * 外壳是 div 的（带图标的 Input、密码框、数字框、标签输入）自己写 data-invalid / data-disabled，规则和原生控件上的 aria-invalid / disabled 一样。
 * 动效（DESIGN.md §4.2）：底色与线 80ms ease-ds；键盘聚焦（:focus-visible）即时，不过渡。
 */
const fieldSurface = [
  // ds-field：标记「这是一个字段」，字段里的附属按钮（显示密码、清空、加减）焦点不再自己画环（ds-theme.css）
  "ds-field bg-well shadow-inset transition-[background-color,box-shadow] duration-(--ds-dur-fast) ease-ds focus-visible:transition-none has-[:focus-visible]:transition-none",
  // 悬停加深只在没聚焦、没展开、没禁用时：聚焦的槽底永远是白的；展开的弹出触发器（时间、日期选择）焦点在传送出去的面板里，focus-within 排除不了它。
  // 指针停在框里的按钮（加减、显示密码）上时框不加深：悬停反馈给指着的那个部件（2026-10-06 数字框 235 对 226）。
  // 录快捷键的按钮就是控件本身（占满整个框），不算部件，同 ds-theme.css 里 .ds-field 部件焦点的排除
  "hover:not-focus-within:not-aria-expanded:not-data-[state=open]:not-disabled:not-data-disabled:not-has-[button:not([data-slot=shortcut-recorder-button]):hover]:bg-active",
  "[&_button[class~='hover:bg-hover']:not(:disabled,[aria-disabled=true]):hover]:bg-active",
  // 聚焦 / 展开：槽底变白，槽的那条线本身变成强调色，不在外面再套一圈焦点环（2026-10-05 用户：「把原本灰色的线变成蓝色」）
  "focus:bg-card focus:shadow-inset-focus focus-within:bg-card focus-within:shadow-inset-focus",
  "data-[state=open]:bg-card data-[state=open]:shadow-inset-focus",
  "aria-invalid:shadow-[inset_0_0_0_1px_var(--ds-danger)] data-invalid:shadow-[inset_0_0_0_1px_var(--ds-danger)]",
  // 出错又聚焦：槽线变成焦点的宽度，颜色仍是 danger；键盘焦点环也换成 danger（2026-10-06 字段完整表单、向导邮箱）
  "aria-invalid:focus:shadow-[inset_0_0_0_1.5px_var(--ds-danger)] aria-invalid:focus-within:shadow-[inset_0_0_0_1.5px_var(--ds-danger)] aria-invalid:data-[state=open]:shadow-[inset_0_0_0_1.5px_var(--ds-danger)]",
  "data-invalid:focus-within:shadow-[inset_0_0_0_1.5px_var(--ds-danger)]",
  "aria-invalid:[--ds-focus:var(--ds-danger)] data-invalid:[--ds-focus:var(--ds-danger)]",
  "disabled:cursor-not-allowed disabled:opacity-40 data-disabled:cursor-not-allowed data-disabled:opacity-40",
]

/**
 * FieldGroup 里的字段外观。每条都把上一级排除掉，规则互不覆盖（不靠 Tailwind 的生成顺序）。
 * in-data-fluid-hover：所在的 Field 是离指针最近的那一格。
 */
const quietFieldSurface = [
  "ds-field bg-transparent transition-[background-color,box-shadow] duration-(--ds-dur-fast) ease-ds focus-visible:transition-none has-[:focus-visible]:transition-none",
  // 悬停：浅叠色 + 1px 线
  "not-data-disabled:not-data-invalid:not-focus-within:in-data-fluid-hover:bg-hover not-data-disabled:not-data-invalid:not-focus-within:in-data-fluid-hover:shadow-inset",
  // 聚焦：白底 + 1.5px 强调色线
  "not-data-disabled:not-data-invalid:focus-within:bg-card not-data-disabled:not-data-invalid:focus-within:shadow-inset-focus",
  // 出错：静止透明；悬停浅红底 + 1px 红线；聚焦白底 + 1.5px 红线
  "data-invalid:[--ds-focus:var(--ds-danger)]",
  "not-data-disabled:data-invalid:not-focus-within:in-data-fluid-hover:bg-[color-mix(in_srgb,var(--ds-danger)_6%,transparent)] not-data-disabled:data-invalid:not-focus-within:in-data-fluid-hover:shadow-[inset_0_0_0_1px_var(--ds-danger)]",
  "not-data-disabled:data-invalid:focus-within:bg-card not-data-disabled:data-invalid:focus-within:shadow-[inset_0_0_0_1.5px_var(--ds-danger)]",
  // 禁用：透明 + 1px 线，整格 40%
  "data-disabled:shadow-inset data-disabled:cursor-not-allowed data-disabled:opacity-40",
]

/** 当前该用哪套外观：在 FieldGroup 里是 quiet，其余是凹槽 */
function useFieldSurface() {
  return useInFieldGroup() ? quietFieldSurface : fieldSurface
}

/** 按需只显示键盘焦点环；容器型控件也检查内部的 :focus-visible。 */
const keyboardFocusRing = "focus-visible:focus-ring has-[:focus-visible]:focus-ring"

/** 输入框里的字：控件档字号（触屏至少 16，iOS 聚焦不放大页面），行高跟密度 */
const inputText = "text-md leading-(--ds-lh-control) font-normal text-fg placeholder:text-fg-muted"

type InputProps = React.ComponentProps<"input"> & {
  focusRing?: "keyboard"
  /**
   * 前导图标（lucide 组件）：字段变成一个外壳 + 图标 + 输入框。悬停或聚焦时图标 fg-muted → fg、线 1.5 → 2（80ms）；
   * 在外壳任意处（图标、内边距）按下都把焦点给输入框。
   */
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
}

/**
 * 表单输入框：用于设置、表单。搜索请用 SearchField。高度是控件档（默认 36 · 紧凑 28，触屏 44 · 32），横向内边距 16 · 12，
 * 有图标那一侧 12 · 8，图标到字 8 · 4（DESIGN.md §3.1）。
 * 放进 Field 时自动接线（useFieldControl）：id、说明与错误的 aria-describedby、有错误时 aria-invalid；显式传的优先。
 * 放进 FieldGroup 时换成 quiet 外观（见上）。
 */
function Input({ className, focusRing, icon: Icon, id, ref, disabled, "aria-describedby": describedBy, "aria-invalid": invalid, ...props }: InputProps) {
  const { labelledBy: _, ...field } = useFieldControl({ id, "aria-describedby": describedBy, "aria-invalid": invalid })
  const surface = useFieldSurface()
  const input = React.useRef<HTMLInputElement>(null)
  const refs = useComposedRefs(input, ref)
  const isInvalid = field["aria-invalid"] === true || field["aria-invalid"] === "true"
  const state = { "data-invalid": isInvalid || undefined, "data-disabled": disabled || undefined }
  // 只读：能选中、能复制、能 Tab 到，但不能改。槽底始终不变——悬停加深、聚焦变白都是「可以输入」的信号，只读不给（2026-10-06 打磨）
  const readOnly = surface === fieldSurface ? (Icon ? "has-[input:read-only]:bg-well!" : "read-only:bg-well!") : ""
  if (!Icon) {
    return (
      <input
        ref={refs}
        data-slot="input"
        disabled={disabled}
        className={cn(
          surface,
          focusRing === "keyboard" && keyboardFocusRing,
          "h-(--ds-h-md) w-full min-w-0 rounded-control px-(--ds-pad-x-md) outline-none",
          inputText,
          readOnly,
          className
        )}
        {...state}
        {...field}
        {...props}
      />
    )
  }
  return (
    <div
      data-slot="input-shell"
      data-icon-start=""
      {...state}
      // 外壳任意处按下（图标、内边距）都把焦点给输入框；按在输入框上照常放插入点
      onMouseDown={(e) => {
        if (e.button !== 0 || e.target === input.current || disabled) return
        e.preventDefault()
        input.current?.focus()
      }}
      className={cn(
        surface,
        focusRing === "keyboard" && keyboardFocusRing,
        "group/input flex h-(--ds-h-md) w-full min-w-0 cursor-text items-center gap-(--ds-gap-control) rounded-control pr-(--ds-pad-x-md) pl-(--ds-pad-x-icon)",
        readOnly,
        className
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-(--ds-icon) shrink-0 text-fg-muted transition-[color,stroke-width] duration-(--ds-dur-fast) ease-ds",
          "group-hover/input:text-fg group-hover/input:stroke-2 group-focus-within/input:text-fg group-focus-within/input:stroke-2 in-data-fluid-hover:text-fg in-data-fluid-hover:stroke-2",
          "group-data-disabled/input:text-fg-muted group-data-disabled/input:stroke-[1.5]"
        )}
      />
      <input
        ref={refs}
        data-slot="input"
        disabled={disabled}
        className={cn("h-full w-full min-w-0 flex-1 bg-transparent outline-none disabled:cursor-not-allowed", inputText)}
        {...field}
        {...props}
      />
    </div>
  )
}

export { Input, fieldSurface, quietFieldSurface, useFieldSurface, keyboardFocusRing }
