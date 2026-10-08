"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { MorphIcon } from "@/components/ui/morph-icon"
import { usePressScale } from "@/components/ui/stretch"

/**
 * 分裂按钮：一颗胶囊两个按钮——左边是默认动作，右边箭头打开同一动作的 2–5 个变体（合并 / 压缩合并 / 变基合并）。
 * 变体里危险的（tone="danger"）自动排到最后，用分隔线隔开。主文案可以原位换成结果（复制页面 → 已复制），宽度跟着走。
 * 一组变体里只要有一项带图标，没图标的项留出同宽的空位：菜单里的字只有一条竖线（DESIGN.md §0.6）。
 * 两半之间 1px 分隔线，外侧圆角、内侧直角，拼成一颗胶囊；禁用时两半一起禁用。
 * variant="danger"：默认动作本身是破坏性的（下架、拒绝），变体是它的几种原因或范围；白底红字、实色描边（2026-10-05）。
 * 读屏：箭头的名字是「label 的更多选项」（可改 menuLabel）；主文案变化时由 role="status" 念出新文案。
 *
 * 动效（DESIGN.md §5.2 按压、morph；菜单同 DropdownMenu）：
 * - 指针按主半边 → 整颗胶囊 snappy 压到 0.97，松手 snappy 弹回（主半边自己不缩，否则两半之间裂缝）。
 * - 指针按箭头半边 → 不缩放、只换色（它是菜单的锚点：缩放会让菜单量到缩小后的位置）；菜单打开期间箭头保持按下的颜色。
 * - 菜单打开 / 关闭（指针）→ 从箭头下方右对齐长出、原路缩回（DropdownMenu：scale .95→1，snappy）；箭头同时转向上 / 转回（MorphIcon，snappy）。
 * - 主文案换成结果 → 交给 Button：宽度 morph（变宽 snappy、变窄 smooth），新旧文案 blur 交叉；箭头半边随宽度一起移动。
 * - 键盘（Enter / 空格 / ↓ 打开、Esc 关闭、键盘选中后换文案）→ 0ms：菜单、箭头、宽度都直接到位。
 * - 减少动态 → 按压直接压到位、直接弹回（没有过渡，§5.2 按压）；箭头直接换方向；菜单不缩放只淡入淡出；文案只淡入淡出、宽度直接到位。
 */
type SplitButtonAction = {
  label: string
  icon?: React.ReactNode
  onSelect: () => void
  /** danger：图标变红，排到最后并隔开 */
  tone?: "default" | "danger"
  disabled?: boolean
}

type SplitButtonProps = {
  /** 默认动作的文字；换成结果（「已复制」）时宽度 morph */
  label: string
  icon?: React.ReactNode
  onClick: () => void
  /** 2–5 个变体 */
  actions: SplitButtonAction[]
  variant?: "primary" | "secondary" | "danger"
  size?: "sm" | "md"
  disabled?: boolean
  /** 箭头的无障碍名称，默认「label 的更多选项」 */
  menuLabel?: string
  className?: string
}

function SplitButton({ label, icon, onClick, actions, variant = "primary", size = "md", disabled, menuLabel, className }: SplitButtonProps) {
  const capsule = usePressScale<HTMLDivElement>(0.97)
  const [open, setOpen] = React.useState(false)
  // 主文案变了才念（第一次渲染不念）
  const [announce, setAnnounce] = React.useState("")
  const first = React.useRef(label)
  React.useEffect(() => {
    if (label !== first.current) setAnnounce(label)
  }, [label])
  const plain = actions.filter((a) => a.tone !== "danger")
  // 有图标的项和没图标的项混排时，没图标的补一个图标位，字落在同一条线上
  const slot = actions.some((a) => a.icon) ? <span aria-hidden className="size-4.5 shrink-0" /> : null
  const danger = actions.filter((a) => a.tone === "danger")
  const square = size === "sm" ? "w-(--ds-h-sm)" : "w-(--ds-h-md)"
  const solid = variant === "primary"
  // 胶囊按下时两半一起压平阴影（缩放在胶囊上，阴影在各自身上）
  const pressedShadow = solid ? "in-data-pressed:shadow-solid-pressed" : "in-data-pressed:shadow-pressed"

  return (
    <div ref={capsule.node} data-slot="split-button" className={cn("inline-flex shrink-0 whitespace-nowrap", className)}>
      <Button
        variant={variant}
        size={size}
        pressScale={false}
        disabled={disabled}
        data-slot="split-button-main"
        className={cn("rounded-r-none", pressedShadow)}
        onClick={onClick}
        onPointerDown={(e) => !disabled && capsule.press(e)}
        onPointerUp={capsule.release}
        onPointerLeave={capsule.release}
        onPointerCancel={capsule.release}
      >
        {icon}
        {label}
      </Button>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            pressScale={false}
            disabled={disabled}
            data-slot="split-button-menu"
            aria-label={menuLabel ?? `${label}的更多选项`}
            className={cn(
              "relative rounded-l-none px-0 [corner-top-left-shape:round] [corner-bottom-left-shape:round]",
              square,
              // 实色主按钮：两半之间画一条浅色缝。描边的白底 / 危险款：两半各自有 1px 内描边，右半往左压 1px，
              // 两条边叠成同一条线（2026-10-05：原来再加 border-l，缝上叠出三条线，又粗又灰）
              solid ? "before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-action-fg/30" : "-ml-px",
              pressedShadow,
              // 只换色：按着、打开期间都是悬停色
              variant === "primary"
                ? "active:bg-action-hover data-[state=open]:bg-action-hover"
                : variant === "danger"
                  ? "active:brightness-95 data-[state=open]:brightness-95"
                  : "active:bg-fill-hover"
            )}
          >
            <MorphIcon name={open ? "chevron-up" : "chevron-down"} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {plain.map((a) => (
            <DropdownMenuItem key={a.label} disabled={a.disabled} onSelect={a.onSelect}>
              {a.icon ?? slot}
              {a.label}
            </DropdownMenuItem>
          ))}
          {danger.length && plain.length ? <DropdownMenuSeparator /> : null}
          {danger.map((a) => (
            <DropdownMenuItem key={a.label} tone="danger" disabled={a.disabled} onSelect={a.onSelect}>
              {a.icon ?? slot}
              {a.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span role="status" className="sr-only">
        {announce}
      </span>
    </div>
  )
}

export { SplitButton, type SplitButtonAction, type SplitButtonProps }
