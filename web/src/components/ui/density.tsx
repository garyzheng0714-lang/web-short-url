import * as React from "react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * 区域密度（DESIGN.md §3.1「控件」、§4.1「密度」）：控件只有两档，默认 36、紧凑 28，按区域定，不逐个控件定。
 * 包住一块（筛选条、工具条、表头、侧栏、属性面板），里面的控件和从这块打开的弹层一起换档：
 * 高、按钮与行的内边距、图标、间隙、控件里的字是一整套（数值见 ds-tokens.css「区域密度」），不只是框变小。
 *
 * 两条路，各管一半：
 * - CSS：Density 在自己身上写 data-density，ds-tokens.css 在它上面重算 --ds-h-md、--ds-pad-x-md、--ds-pad-row、--ds-icon、
 *   --ds-gap-control、--ds-text-control 等；里面的组件照常读这些变量，不用知道自己在哪一档。
 * - React 上下文：弹层挂到 body（或 PortalScope），不在这块 DOM 里，CSS 变量传不过去；上下文能穿过 portal。
 *   弹层内容（菜单、下拉、浮层、提示）在自己的内容节点上展开 useDensityProps()，就拿到触发器所在区域的那一档。
 * 嵌套时里层优先（紧凑区域里的一块可以再写回 default）。组件自己的 size（例如 size="sm"）比区域优先。
 * 默认渲染一个 display: contents 的 div：不占盒子、不改布局；asChild 时把属性合到唯一的子元素上。
 * 动效：无（换档是结构，不是交互状态，不做过渡）。
 */
type DensityValue = "default" | "compact"

const DensityContext = React.createContext<DensityValue | null>(null)

function Density({
  value,
  asChild = false,
  className,
  ...props
}: React.ComponentProps<"div"> & { value: DensityValue; asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div"
  return (
    <DensityContext.Provider value={value}>
      <Comp data-slot="density" data-density={value} className={cn(!asChild && "contents", className)} {...props} />
    </DensityContext.Provider>
  )
}

/** 当前这一档：组件自己指定的 > 外面的 Density > 默认 */
function useDensity(override?: DensityValue | null): DensityValue {
  const region = React.useContext(DensityContext)
  return override ?? region ?? "default"
}

/**
 * 给挂到别处的弹层内容用：`<Content {...useDensityProps()}>`。在某个 Density 里打开时返回 { "data-density": 那一档 }，
 * 否则返回空对象（弹层跟着根上的默认档，不多写属性）。
 */
function useDensityProps(): { "data-density"?: DensityValue } {
  const region = React.useContext(DensityContext)
  return region ? { "data-density": region } : {}
}

export { Density, useDensity, useDensityProps }
export type { DensityValue }
