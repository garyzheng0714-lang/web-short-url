"use client"

import * as React from "react"
import { Slot } from "radix-ui"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { useGeometryInvariant } from "@/components/ui/invariant"
import { NavHighlightContext, WeightLabel, composeRefs, useNavHighlight, useNavHighlightItem } from "@/components/ui/nav-highlight"
import { SidebarCollapsedContext, SidebarContext } from "@/components/ui/sidebar"
import { Tooltip } from "@/components/ui/tooltip"

/**
 * 导航项（DESIGN.md K2、K6、§4.3）：行高 --ds-h-row（36 · 紧凑 28，触屏至少 44），左右 --ds-pad-row（8 · 6），
 * 图标 --ds-icon（16 · 14）到字 --ds-gap-control（8 · 4），字 14 / 500；同一棵菜单树（NavMenu，或不在 NavMenu 里的 NavSection）
 * 只有一个悬停范围，子行（NavFolder 展开的项）也在里面：
 * - 悬停：一块跟随悬停底（fast 0.08s），指针在行间空隙、末行之下也落在最近的行；点在空隙里等于点亮着的那行。键盘焦点移到哪行，底跟到哪行。
 * - 当前：一块 bg-nav-current 的底在行之间滑动（moderate 0.16s）；同一行因为别处折叠而挪位时直接到位。当前项的字变 600（隐形副本占宽，不挤动行尾）。
 * - 图标：默认 fg-muted、线 1.5；悬停或当前时 fg、线 2（80ms）。
 * - 有弹层开着（行尾菜单、头像菜单）时悬停冻结，下面的行不跟着亮。
 * 不在任何 NavMenu / NavSection 里的单独一项：自己画 :hover 底与静态当前底。
 * asChild：渲染为路由链接等元素，如 <NavItem asChild><Link to="/">首页</Link></NavItem>；链接里的字照样变 600。
 * 窄屏侧栏是抽屉：点了导航项抽屉自动关。
 * 桌面侧栏收起成图标栏时：缩成行高见方的图标钮（图标原位不动），字只留给读屏，指向在右侧出名字；当前与悬停由钮自己画。
 */
function NavItem({
  className,
  icon,
  count,
  trailing,
  active = false,
  asChild = false,
  onClick,
  children,
  ref,
  ...props
}: React.ComponentProps<"button"> & {
  icon?: React.ReactNode
  count?: number
  /** 行尾的元素（目录的箭头、快捷键），排在数量后面 */
  trailing?: React.ReactNode
  active?: boolean
  asChild?: boolean
}) {
  const sidebar = React.useContext(SidebarContext)
  const collapsed = React.useContext(SidebarCollapsedContext)
  const item = useNavHighlightItem(active, ref)
  const Comp = asChild ? Slot.Root : "button"
  const ownCurrent = item.staticCurrent || ((!item.scoped || collapsed) && active)
  // asChild：字在子元素（Link）里面，把它的内容包进 WeightLabel，字重才能随当前项变、不挤动
  const label =
    asChild && React.isValidElement<{ children?: React.ReactNode }>(children)
      ? React.cloneElement(children, undefined, <WeightLabel className="flex-1">{children.props.children}</WeightLabel>)
      : <WeightLabel className="flex-1">{children}</WeightLabel>

  const button = (
    <Comp
      ref={item.ref}
      data-slot="nav-item"
      type={asChild ? undefined : "button"}
      aria-current={active ? "page" : undefined}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e)
        if (sidebar && !sidebar.desktop) sidebar.setMobileOpen(false)
      }}
      className={cn(
        "group/nav relative isolate flex h-(--ds-h-row) w-full min-w-0 items-center gap-(--ds-gap-control) rounded-row px-(--ds-pad-row) text-left text-(length:--ds-text-nav) leading-(--ds-lh-sm) [font-weight:var(--ds-weight-nav)] text-fg outline-none pointer-coarse:min-h-(--ds-h-md)",
        "focus-visible:focus-ring",
        "disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40",
        // 图标：fg-muted、线 1.5 → 悬停（跟随悬停亮着，或单独一项的 :hover）与当前时 fg、线 2
        "[&_svg]:size-(--ds-icon) [&_svg]:shrink-0 [&_svg]:text-fg-muted [&_svg]:transition-[color,stroke-width] [&_svg]:duration-(--ds-dur-fast) [&_svg]:ease-ds",
        "hover:[&_svg]:text-fg hover:[&_svg.lucide]:stroke-2 data-[fluid-hover]:[&_svg]:text-fg data-[fluid-hover]:[&_svg.lucide]:stroke-2",
        "aria-[current=page]:[&_svg]:text-fg aria-[current=page]:[&_svg.lucide]:stroke-2",
        (!item.scoped || collapsed) && "not-aria-[current=page]:hover:bg-hover",
        // 图标栏：行高见方、图标居中；字、数量、行尾只留给读屏
        collapsed && "w-(--ds-h-row) justify-center px-0 [&>[data-slot=weight-label]]:sr-only [&>[data-slot=nav-count]]:hidden [&>[data-slot=nav-trailing]]:hidden",
        className
      )}
      {...props}
    >
      {ownCurrent ? <span aria-hidden data-slot="nav-current" className="absolute inset-0 -z-10 rounded-inherit bg-nav-current" /> : null}
      {icon}
      {asChild ? <Slot.Slottable>{label}</Slot.Slottable> : label}
      {count ? <span data-slot="nav-count" className="ml-auto text-xs font-normal text-fg-muted tabular-nums">{count}</span> : null}
      {trailing ? <span data-slot="nav-trailing" className="flex shrink-0 items-center">{trailing}</span> : null}
    </Comp>
  )
  // 在侧栏里的项一直包着提示（只在图标栏时放开），开合时元素树不变、焦点不丢
  const name = sidebar ? textOf(asChild && React.isValidElement<{ children?: React.ReactNode }>(children) ? children.props.children : children) : ""
  return name ? <Tooltip content={name} side="right" open={collapsed ? undefined : false}>{button}</Tooltip> : button
}

/** 导航项的名字（图标栏的提示用）：只取纯文字 */
function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  return ""
}

/**
 * 一棵菜单树的悬停范围（DESIGN.md K2）：里面所有 NavItem（含 NavFolder 的子行）共用一块跟随悬停底和一块滑动的当前底。
 * 行与行之间 --ds-gap-row。分隔线、另一类行（账号、设置）另起一个 NavMenu。
 */
function NavMenu({ className, children, ref, ...props }: React.ComponentProps<"div">) {
  const node = React.useRef<HTMLDivElement>(null)
  const scope = useNavHighlight(node, { radius: "rounded-row" })
  return (
    <NavHighlightContext.Provider value={scope.context}>
      <div ref={composeRefs(node, ref)} data-slot="nav-menu" {...props} {...scope.handlers} className={cn("relative isolate grid gap-(--ds-gap-row)", className)}>
        {scope.overlays}
        {children}
      </div>
    </NavHighlightContext.Provider>
  )
}

/**
 * 业务分组：组名 13 / 500 fg-muted、高 --ds-h-row。外面没有 NavMenu 时，组里的行自成一个悬停范围（组名不在范围里，指着组名不亮行）；
 * 外面有 NavMenu 时并进它的范围，几组之间当前底照样滑。
 */
function NavSection({
  label,
  action,
  className,
  children,
}: {
  label?: React.ReactNode
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  const parent = React.useContext(NavHighlightContext)
  return (
    <div role="group" data-slot="nav-section" aria-label={typeof label === "string" ? label : undefined} className={cn("grid gap-(--ds-gap-row)", className)}>
      {label ? (
        // 图标栏里组名隐去，留着高度当组与组之间的空隙
        <div className="flex h-(--ds-h-row) items-center justify-between px-(--ds-pad-row) text-xs font-medium text-fg-muted group-data-[state=collapsed]/sidebar:invisible">
          <span className="truncate">{label}</span>
          {action}
        </div>
      ) : null}
      {parent ? children : <NavMenu>{children}</NavMenu>}
    </div>
  )
}

/** 一项里第一个看得见的墨迹的左缘：图标（不算箭头）或第一段字 */
function inkLeft(item: Element, skipChevron: boolean) {
  const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n instanceof SVGSVGElement) {
      if (skipChevron && n.getAttribute("aria-hidden") === "true" && n.classList.contains("lucide-chevron-right")) continue
      return n.getBoundingClientRect().left
    }
    if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim() && !n.parentElement?.closest(".sr-only,[data-weight-ghost]")) {
      const range = document.createRange()
      range.selectNodeContents(n)
      return range.getBoundingClientRect().left
    }
  }
  return null
}

/** 子项的第一个墨迹（图标或字）落在父项的字下面（差 ≤ 1） */
function childUnderParent(folder: HTMLElement) {
  const parent = folder.firstElementChild
  const child = folder.lastElementChild?.querySelector("[data-slot=nav-item]")
  if (!parent || !child || parent.getAttribute("aria-expanded") !== "true") return null
  // 图标栏里子项不显示、字只留给读屏，不量
  if (!child.getClientRects().length || folder.closest("[data-slot=sidebar][data-state=collapsed]")) return null
  const parentText = (() => {
    const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim() || n.parentElement?.closest(".sr-only,[data-weight-ghost]")) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      return range.getBoundingClientRect().left
    }
    return null
  })()
  const childInk = inkLeft(child, true)
  if (parentText === null || childInk === null || Math.abs(parentText - childInk) <= 1) return null
  return `目录的子项（${childInk.toFixed(1)}）没有落在父项的字（${parentText.toFixed(1)}）下面：差 ${(childInk - parentText).toFixed(1)}px`
}

/**
 * 可展开目录：整行操作；子行和父行在同一个悬停范围里，子行的字对齐父行的字（缩进 = 图标 + 图标到字），字重同为 500。
 * 收起当前分支时（以及侧栏收成图标栏时）父行代表当前位置（当前底从子行滑回父行）。箭头常驻：带图标（一级分组）在行尾，不带图标（二级目录）在行首代替图标；
 * 展开转 90°（fast 0.08s，减少动态时直接到位）。子行展开、收起直接到位，不做高度动画（上方组收起时由使用方同一帧补滚动）。
 * count：目录里有几项（数据，不是说明），排在箭头前面。
 */
function NavFolder({
  label,
  icon,
  count,
  open,
  onOpenChange,
  containsCurrent = false,
  children,
}: {
  label: string
  icon?: React.ReactNode
  count?: number
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 业务明确传入当前页是否属于该目录，不扫描 DOM 推测 */
  containsCurrent?: boolean
  children: React.ReactNode
}) {
  const id = React.useId()
  const chevron = (
    <ChevronRight aria-hidden className={cn("transition-[rotate,color,stroke-width] duration-(--ds-dur-fast) ease-ds motion-reduce:transition-none", open && "rotate-90")} />
  )
  const node = React.useRef<HTMLDivElement>(null)
  // 图标栏里子项不显示：当前页在目录里时由父项代表当前位置
  const collapsed = React.useContext(SidebarCollapsedContext)
  useGeometryInvariant("NavFolder", node, childUnderParent)
  return (
    <div ref={node} data-slot="nav-folder" className="grid gap-(--ds-gap-row)">
      <NavItem
        // 一级分组：图标平时次级灰，组展开时和文字一样深
        className={icon && open ? "[&>svg]:text-fg" : undefined}
        active={containsCurrent && (!open || collapsed)}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onOpenChange(!open)}
        icon={icon ?? chevron}
        count={count}
        trailing={icon ? chevron : undefined}
      >
        {label}
      </NavItem>
      <div
        id={id}
        role="group"
        aria-label={label}
        // 图标栏里不露子项（它们缩进在父项的字下面，会被裁掉一半）
        className={cn("grid gap-(--ds-gap-row) pl-[calc(var(--ds-icon)+var(--ds-gap-control))] group-data-[state=collapsed]/sidebar:hidden", !open && "hidden")}
      >
        {open ? children : null}
      </div>
    </div>
  )
}

export { NavFolder, NavItem, NavMenu, NavSection }
