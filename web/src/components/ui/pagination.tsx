"use client"

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
 * 靠左 / 靠右写 align（start / end），宽度不动：根节点是尺寸容器，内容宽不计入它的宽，按内容缩（w-auto、w-fit、inline-flex）
 * 就缩成 0、进窄版（2026-10-08 短链：w-auto 靠右，末页被收起）。和统计并排时父容器 flex、Pagination 加 flex-1。
 * 不变量（开发时崩溃）：被按内容缩成 0；窄版但它那一行放得下 384；PaginationContent 里有不是四种部件的文字项（手写「…」）。
 */
const ALIGN = { start: "justify-start", center: "justify-center", end: "justify-end" } as const

/** 窄版的分界：Pagination 自己宽 < 24rem（@max-sm） */
const narrowLimit = () => 24 * parseFloat(getComputedStyle(document.documentElement).fontSize)

/**
 * 它那一行能给它多宽：横排 flex 减去同一行兄弟（含外边距、间距）；网格取它所在那格；其余是父容器的内容宽。
 * 一律用布局像素：放在缩放的预览里（首页缩略图 transform: scale）时 getBoundingClientRect 是缩放后的宽，
 * 和 clientWidth、gridTemplateColumns 混着比会误报（2026-10-08 首页「布局」缩略图崩溃）。
 */
function roomOf(el: HTMLElement) {
  const parent = el.parentElement
  if (!parent) return 0
  const ps = getComputedStyle(parent)
  const own = el.getBoundingClientRect()
  const scale = parent.offsetWidth ? parent.getBoundingClientRect().width / parent.offsetWidth || 1 : 1
  const inner = parent.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight)
  if (ps.display.includes("grid")) {
    const tracks = ps.gridTemplateColumns.split(" ").map(parseFloat)
    if (tracks.some(Number.isNaN)) return inner
    const center = ((own.left + own.right) / 2 - parent.getBoundingClientRect().left) / scale
    let x = parent.clientLeft + parseFloat(ps.paddingLeft)
    for (const t of tracks) {
      if (center <= x + t + 0.25) return Math.max(t, el.offsetWidth)
      x += t + (parseFloat(ps.columnGap) || 0)
    }
    return el.offsetWidth
  }
  if (!ps.display.includes("flex") || !ps.flexDirection.startsWith("row")) return inner
  let used = 0
  for (const sibling of parent.children) {
    const r = sibling.getBoundingClientRect()
    const s = getComputedStyle(sibling)
    if (sibling === el || !r.width || r.bottom <= own.top || r.top >= own.bottom || s.position === "absolute" || s.position === "fixed") continue
    used += r.width / scale + Math.max(0, parseFloat(s.marginLeft)) + Math.max(0, parseFloat(s.marginRight)) + (parseFloat(ps.columnGap) || 0)
  }
  return inner - used
}

function pagerBreach(el: HTMLElement) {
  if ([...el.querySelectorAll<HTMLElement>('[aria-disabled="true"]')].some((link) => link.tabIndex >= 0)) return "禁用的翻页链接仍在 Tab 顺序里"
  const width = el.offsetWidth
  const limit = narrowLimit()
  if (width >= limit - 0.5) return null
  const fix = '靠右写 align="end"、靠左 align="start"，和统计并排时再加 className="flex-1"'
  const row = el.querySelector<HTMLElement>("[data-slot=pagination-content]")?.offsetWidth ?? 0
  if (el.clientWidth < 1 && row > 1)
    return `Pagination 被按内容缩成了 0 宽（w-auto / w-fit / inline-flex）：它是尺寸容器，内容宽不计入，于是进了窄版、页码溢出；${fix}`
  const room = roomOf(el)
  if (room >= limit)
    return `Pagination 只有 ${width.toFixed(0)}px（< ${limit}）进了窄版、收起了页码，可它那一行有 ${room.toFixed(0)}px：别缩它的宽度；${fix}`
  return null
}

/** 页码一行只放这四种：窄版的收起规则只认得它们（2026-10-08 短链：手写的「…」span 让首末页被收起） */
const PARTS = "[data-slot=pagination-link], [data-slot=pagination-ellipsis], [data-slot=pagination-previous], [data-slot=pagination-next]"

function contentBreach(ul: HTMLElement) {
  for (const li of ul.children) {
    const text = li.textContent?.trim() ?? ""
    const part = text ? li.querySelector(PARTS) : null
    if (text && !part)
      return `PaginationContent 里有一项「${text.slice(0, 8)}」不是 PaginationLink / PaginationEllipsis / PaginationPrevious / PaginationNext，窄版的收起规则认不出它；省略号用 <PaginationEllipsis />`
    if (part?.matches("[data-slot=pagination-link]") && /^[.…⋯·]+$/.test(text))
      return `PaginationLink 里写了省略号「${text}」：它不是一页，用 <PaginationEllipsis />`
  }
  return null
}

function Pagination({ className, align = "center", ref, ...props }: React.ComponentProps<"nav"> & { align?: keyof typeof ALIGN }) {
  const root = React.useRef<HTMLElement>(null)
  React.useImperativeHandle(ref, () => root.current!, [])
  useGeometryInvariant("Pagination", root, pagerBreach)
  return (
    <nav
      ref={root}
      aria-label="分页"
      data-slot="pagination"
      data-align={align}
      className={cn("@container flex w-full", ALIGN[align], className)}
      {...props}
    />
  )
}

function PaginationContent({ className, children, ref, ...props }: React.ComponentProps<"ul">) {
  const node = React.useRef<HTMLUListElement>(null)
  useGeometryInvariant("PaginationContent", node, contentBreach)
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
