import * as React from "react"
import { ChevronLeft, ChevronRight, Ellipsis } from "lucide-react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"
import { useGeometryInvariant } from "@/components/ui/invariant"
import { NavHighlightContext, WeightLabel, composeRefs, useNavHighlight, useNavHighlightItem } from "@/components/ui/nav-highlight"

/**
 * 分页（DESIGN.md K2、K6、§4.3）：页码 --ds-h-md 见方（36 · 紧凑 28）、等宽数字，间距 4、圆角 control。
 * 一行页码是一组（ui/nav-highlight）：
 * - 悬停：一块跟随悬停底（fast 0.08s），指针在页码之间的缝里也落在最近一项；上一页 / 下一页也在组里，不可用（aria-disabled）的跳过。
 * - 当前页：一块 bg-selected 的底在页码之间滑动（moderate 0.16s）；页码窗口挪动时当前页还在原处就不动。当前页的数字变 600（隐形副本占宽）。
 * - 上一页 / 下一页的箭头：悬停时线 1.5 → 2（80ms）。减少动态时底直接到位。
 * 页码用界面字体 + 等宽数字（tabular-nums），不用代码等宽字体（成熟产品的页码都是界面字体）。
 * 窄容器（Pagination 自己宽 < 384，容器查询）：上一页 / 下一页只留箭头（名字仍是 aria-label）。
 *   没有省略号（页数少）：页码只留当前页和前后各一页。
 *   有省略号（页数多）：留首页、省略号、当前页、省略号、末页，收起夹在当前页和省略号之间的邻页——
 *   只剩「7 8 9」时看不出一共几页、也回不到首末页（2026-10-06 点验）；九格摆不下（390 宽溢出），七格摆得下。
 */
function Pagination({ className, ref, ...props }: React.ComponentProps<"nav">) {
  const root = React.useRef<HTMLElement>(null)
  React.useImperativeHandle(ref, () => root.current!, [])
  useGeometryInvariant("Pagination", root, (el) => [...el.querySelectorAll<HTMLElement>('[aria-disabled="true"]')].some(link => link.tabIndex >= 0) ? "禁用的翻页链接仍在 Tab 顺序里" : null)
  return (
    <nav
      ref={root}
      aria-label="分页"
      data-slot="pagination"
      className={cn("@container flex w-full justify-center", className)}
      {...props}
    />
  )
}

function PaginationContent({ className, children, ref, ...props }: React.ComponentProps<"ul">) {
  const node = React.useRef<HTMLUListElement>(null)
  const scope = useNavHighlight(node, { axis: "x", radius: "rounded-control", current: "bg-selected" })
  return (
    <NavHighlightContext.Provider value={scope.context}>
      <ul
        ref={composeRefs(node, ref)}
        data-slot="pagination-content"
        {...props}
        {...scope.handlers}
        className={cn(
          "relative isolate flex items-center gap-1",
          // 窄容器：先藏起省略号和不是当前页的页码，再把当前页前后各一页放回来（后两条选择器更具体，盖过第二条）
          "@max-sm:[&>li:has(>[data-slot=pagination-ellipsis])]:hidden",
          "@max-sm:[&>li:has(>[data-slot=pagination-link]:not([aria-current]))]:hidden",
          "@max-sm:[&>li:has(>[data-slot=pagination-link]):has(+li>[aria-current])]:block",
          "@max-sm:[&>li:has(>[aria-current])+li:has(>[data-slot=pagination-link])]:block",
          // 有省略号：首末页与省略号放回来，只收起当前页和省略号之间的邻页（多一层 :has，选择器更具体，盖过上面四条）
          "@max-sm:[&:has(>li>[data-slot=pagination-ellipsis])>li:has(>[data-slot=pagination-link])]:block",
          "@max-sm:[&:has(>li>[data-slot=pagination-ellipsis])>li:has(>[data-slot=pagination-ellipsis])]:block",
          "@max-sm:[&:has(>li>[data-slot=pagination-ellipsis])>li:has(>[aria-current])+li:has(>[data-slot=pagination-link]):has(+li>[data-slot=pagination-ellipsis])]:hidden",
          "@max-sm:[&:has(>li>[data-slot=pagination-ellipsis])>li:has(>[data-slot=pagination-ellipsis])+li:has(>[data-slot=pagination-link]):has(+li>[aria-current])]:hidden",
          className
        )}
      >
        {/* 两块底：放在一个不占位的 li 里（ul 只装 li） */}
        <li aria-hidden className="contents">{scope.overlays}</li>
        {children}
      </ul>
    </NavHighlightContext.Provider>
  )
}

function PaginationItem(props: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />
}

const itemBase = [
  "group/nav relative isolate inline-flex h-(--ds-h-md) items-center justify-center rounded-control text-(length:--ds-text-control) leading-(--ds-lh-control) font-medium whitespace-nowrap text-fg outline-none select-none",
  "focus-visible:focus-ring",
  "aria-disabled:pointer-events-none aria-disabled:opacity-40",
  "[&_svg]:size-(--ds-icon) [&_svg]:shrink-0 [&_svg.lucide]:transition-[stroke-width] [&_svg.lucide]:duration-(--ds-dur-fast) [&_svg.lucide]:ease-ds",
  "hover:[&_svg.lucide]:stroke-2 data-[fluid-hover]:[&_svg.lucide]:stroke-2",
]

/** 不在 PaginationContent 里（单独用）时自己画悬停底 */
const ownHover = "cursor-pointer hover:bg-hover"

function PaginationLink({
  className,
  isActive = false,
  asChild = false,
  children,
  ref,
  ...props
}: React.ComponentProps<"a"> & { isActive?: boolean; asChild?: boolean }) {
  const item = useNavHighlightItem(isActive, ref)
  const Comp = asChild ? Slot.Root : "a"
  const label =
    asChild && React.isValidElement<{ children?: React.ReactNode }>(children)
      ? React.cloneElement(children, undefined, <WeightLabel>{children.props.children}</WeightLabel>)
      : <WeightLabel>{children}</WeightLabel>
  return (
    <Comp
      ref={item.ref}
      data-slot="pagination-link"
      aria-current={isActive ? "page" : undefined}
      className={cn(itemBase, "min-w-(--ds-h-md) px-1 tabular-nums", !isActive && "cursor-pointer", !item.scoped && !isActive && ownHover, className)}
      {...props}
    >
      {item.staticCurrent || (!item.scoped && isActive) ? <span aria-hidden data-slot="nav-current" className="absolute inset-0 -z-10 rounded-inherit bg-selected" /> : null}
      {asChild ? <Slot.Slottable>{label}</Slot.Slottable> : label}
    </Comp>
  )
}

/** 窄容器里上一页 / 下一页是正方形的箭头按钮 */
const narrowEdge = "@max-sm:w-(--ds-h-md) @max-sm:gap-0 @max-sm:px-0"

function PaginationPrevious({ className, children, ref, ...props }: React.ComponentProps<"a">) {
  const item = useNavHighlightItem(false, ref)
  return (
    <a
      ref={item.ref}
      data-slot="pagination-previous"
      aria-label="上一页"
      className={cn(itemBase, narrowEdge, "cursor-pointer gap-1 pr-3 pl-2", !item.scoped && ownHover, className)}
      {...props}
      tabIndex={props["aria-disabled"] === true || props["aria-disabled"] === "true" ? -1 : props.tabIndex}
    >
      <ChevronLeft />
      <span className="@max-sm:sr-only">{children ?? "上一页"}</span>
    </a>
  )
}

function PaginationNext({ className, children, ref, ...props }: React.ComponentProps<"a">) {
  const item = useNavHighlightItem(false, ref)
  return (
    <a
      ref={item.ref}
      data-slot="pagination-next"
      aria-label="下一页"
      className={cn(itemBase, narrowEdge, "cursor-pointer gap-1 pr-2 pl-3", !item.scoped && ownHover, className)}
      {...props}
      tabIndex={props["aria-disabled"] === true || props["aria-disabled"] === "true" ? -1 : props.tabIndex}
    >
      <span className="@max-sm:sr-only">{children ?? "下一页"}</span>
      <ChevronRight />
    </a>
  )
}

function PaginationEllipsis({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn("flex size-(--ds-h-md) items-center justify-center text-fg-muted [&_svg]:size-(--ds-icon)", className)}
      {...props}
    >
      <Ellipsis />
    </span>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
}
