import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * 页面列（DESIGN.md §3.1 Page）：一列内容，固定最大宽度、水平居中；顶栏下 104 起标题、页底留 128。
 * doc 864（正文 672 + 两侧 96）用于阅读、规范、目录；wide 1344 用于画布与多栏示例。
 * app（DESIGN.md §3.11「应用页」，2026-10-08）：数据表格、列表管理、仪表盘、设置。铺满主区不限宽，左右 24、页顶 32、页底 48
 *   （先例 Dub、Polaris、QuickBooks、Airwallex 的应用页都是小标题贴顶、内容铺满；文档页的 104 与 40 号标题放到应用里，一屏只剩标题）。
 *   页里的 PageHeader、Section 经 context 换成应用页的角色字号：页标题 lg 20 / 600，区块标题 sm 15 / 600。
 *   页头到下一块、节与节之间都是 --ds-page-app-gap（24）；页头后紧跟的第一节不再叠一份上边距（原来 24 + 24 = 48）。
 *   页里的表格首尾格内边距换成 --ds-table-edge-app（8）：表格的边落在标题线上，字缩进 8（先例 Stripe、Notion）。
 * 一页一个 main：外面已经有 Page（网站外框、嵌在页面里的模板与区块）时渲染成 div。
 * doc / wide 窄屏左右各 24，宽度不按百分比伸缩（L&S《网格被高估》）。
 * 动效：不动。换页立即回顶，正在读的正文不动（DESIGN.md §5.3）。
 */
type PageWidth = "doc" | "wide" | "app"

/** 当前页面列是哪一种：PageHeader、Section 据此取字号 */
const PageWidthContext = React.createContext<PageWidth>("doc")
/** 外面已经有一个 Page（它渲染了 main） */
const InPageContext = React.createContext(false)

function Page({ width = "doc", className, ...props }: React.ComponentProps<"main"> & { width?: PageWidth }) {
  // 一页一个 main landmark：嵌在别的 Page 里时换成 div（类型同为 HTMLElement 的属性）
  const Tag = (React.useContext(InPageContext) ? "div" : "main") as "main"
  return (
    <InPageContext.Provider value>
      <PageWidthContext.Provider value={width}>
        <Tag
          data-slot="page"
          data-width={width}
          className={cn(
            "w-full min-w-0 px-6",
            width === "app"
              ? "pt-(--ds-page-app-top) pb-(--ds-page-app-bottom) [--ds-table-edge:var(--ds-table-edge-app)]"
              : ["mx-auto pt-(--ds-page-top) pb-(--ds-page-bottom) sm:px-24", width === "wide" ? "max-w-(--ds-page-wide)" : "max-w-(--ds-page-doc)"],
            className
          )}
          {...props}
        />
      </PageWidthContext.Provider>
    </InPageContext.Provider>
  )
}

/**
 * 页面标题：文档页 40/48，字体、字重、字距取 --ds-font-display / --ds-weight-title / --ds-tracking-display；
 * 应用页（Page width="app"）20/26 · 600，界面字体（DESIGN.md §3.11 角色表：层级靠字重和颜色，不靠大字号）。下面不加复述标题的说明。
 * actions：整页的主动作（新建、导出、「⋯」）放标题行右端，与标题中线对齐（DESIGN.md K4、§3.3「整页 → 页头右端」）。
 * 2026-10-08 补：12 张列表页先例（Calendly、Shopify、Remote、Heidi……）都是「名词标题 + 右端主动作」；原来没有这个位置，
 * 使用方只能把输入框和按钮排到标题下面，标题再复述按钮（短链首页「生成短链」标题 + 「生成短链」按钮）。
 */
function PageHeader({ title, actions, className, children }: { title: string; actions?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  const app = React.useContext(PageWidthContext) === "app"
  const heading = (
    <h1 className={cn("min-w-0", app ? "text-lg font-semibold" : "font-display text-3xl tracking-(--ds-tracking-display) [font-weight:var(--ds-weight-title)]")}>{title}</h1>
  )
  return (
    <header data-slot="page-header" className={cn("grid gap-1", app ? "pb-(--ds-page-app-gap)" : "pb-2", className)}>
      {actions ? (
        <div className="flex items-center justify-between gap-4">
          {heading}
          <div data-slot="page-header-actions" className="flex shrink-0 items-center gap-2">
            {actions}
          </div>
        </div>
      ) : (
        heading
      )}
      {children}
    </header>
  )
}

/**
 * 分节：文档页二级标题 24/30 半粗，上方 32、到内容 8；应用页标题 15/24 · 600，上方 --ds-page-app-gap（24）、到内容 12（到邻节 ≥ 到内容 × 2），
 * 紧跟在页头后面时上方不再加（页头自己的下边距就是这一份）。只用留白分组，不套卡片。
 */
function Section({ title, className, children, ...props }: Omit<React.ComponentProps<"section">, "title"> & { title: string }) {
  const app = React.useContext(PageWidthContext) === "app"
  return (
    <section data-slot="section" className={cn("grid scroll-mt-24", app ? "gap-3 pt-(--ds-page-app-gap) [[data-slot=page-header]+&]:pt-0" : "gap-2 pt-8", className)} {...props}>
      <h2 className={app ? "text-sm font-semibold" : "font-display text-xl tracking-(--ds-tracking-display) [font-weight:var(--ds-weight-heading)]"}>{title}</h2>
      {children}
    </section>
  )
}

/**
 * 顶栏（DESIGN.md §3.1 Topbar，44 高）：贴顶，左边 ☰ 与面包屑，右边 ≤3 个图标按钮（最后一个用 edge-end）。
 * 顶栏放在圆角卡片顶上时，最后一个按钮改成嵌进角里：右内边距 4（pr-1），不用 edge-end，上下右间距相等、圆角同心（corner-audit）。
 * 页面标题不放这里，标题属于 Page。不画底线：滚动时下面的内容渐渐淡入底色、没入栏下（progressive-blur，实底渐隐，不用模糊）。
 */
function Topbar({ className, children, ...props }: React.ComponentProps<"header">) {
  return (
    <header data-slot="topbar" className={cn("sticky top-0 z-30 isolate flex h-(--ds-header-h) shrink-0 items-center px-3", className)} {...props}>
      {/* 静态摆放（示例、模板里的内嵌顶栏）下面没有滚动内容，不需要模糊 */}
      <div aria-hidden className="progressive-blur [.static>&]:hidden" />
      {children}
    </header>
  )
}

export { Page, PageHeader, PageWidthContext, Section, Topbar }
export type { PageWidth }
