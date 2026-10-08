import * as React from "react"

import { cn } from "@/lib/utils"
import { useFieldControl } from "@/components/ui/field"
import { fieldSurface, useFieldSurface } from "@/components/ui/input"

/**
 * 多行输入：外观与状态同 Input（DESIGN.md §4.3：禁用 → 出错 → 聚焦 → 悬停 → 静止；放进 FieldGroup 时换成 quiet 外观）。
 * 高度随内容长（field-sizing: content），80 起、240 封顶，再多在框内滚动。横向内边距同 Input（16 · 12），上下 8，字是控件档（触屏至少 16）。
 * 不给拉伸角：会自己长高，拉伸角多余；原生拉伸角还压在圆角里（2026-10-06 打磨）。
 * 放进 Field 时自动接线（useFieldControl）：id、说明与错误的 aria-describedby、有错误时 aria-invalid；显式传的优先。
 * 动效：底色与线 80ms；键盘聚焦即时；换行时高度即时跟内容（打字是高频，不做过渡）。
 */
function Textarea({ className, id, disabled, "aria-describedby": describedBy, "aria-invalid": invalid, ...props }: React.ComponentProps<"textarea">) {
  const { labelledBy: _, ...field } = useFieldControl({ id, "aria-describedby": describedBy, "aria-invalid": invalid })
  const surface = useFieldSurface()
  const isInvalid = field["aria-invalid"] === true || field["aria-invalid"] === "true"
  return (
    <textarea
      data-slot="textarea"
      data-invalid={isInvalid || undefined}
      data-disabled={disabled || undefined}
      disabled={disabled}
      className={cn(
        surface,
        "block min-h-20 max-h-60 resize-none [field-sizing:content] w-full min-w-0 rounded-control px-(--ds-pad-x-md) py-2 text-md leading-(--ds-lh-control) text-fg outline-none placeholder:text-fg-muted",
        // 只读同 Input：槽底不随悬停、聚焦变化（read-only 伪类在 textarea 上只匹配只读与禁用，不会误伤）
        surface === fieldSurface && "read-only:bg-well!",
        className
      )}
      {...field}
      {...props}
    />
  )
}

export { Textarea }
