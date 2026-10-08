"use client"

import * as React from "react"
import { Slot } from "radix-ui"

/**
 * 面的层级（DESIGN.md §4.1「面的层级」，2026-10-07）：页面是第 1 层，最多 8 层；每层一个底色、一档阴影（ds-tokens.css 的
 * --ds-elevation-N / --ds-shadow-elevation-N，浅色第 3 层起都是白、靠阴影分层，深色每层加 3% 白）。
 *
 * 为什么要上下文：弹层自己写死底色时，在对话框里打开会和对话框同色、糊成一块。所在层经 React 上下文往下传（能穿过 portal），
 * Elevated 取「所在层 + offset」（最多 8），写到自己身上，再把新层号提供给子树——对话框里的下拉自动再高一层，不用传 props。
 *
 * 约定的 offset（ELEVATION）：弹层（下拉菜单、弹出层、选择器、组合框、悬停卡片）+2，阴影固定第 3 层（底色随所在层走，
 * 阴影不随嵌套加重：三层深的弹层看起来仍是弹层）；对话框、抽屉 +4，阴影随层。
 *
 * 写到 DOM 上的只有两个属性，样式在 ds-theme.css（components 层、零权重，调用处的 bg-* / shadow-* 照常覆盖）：
 * - data-elevation="N"：底色 = 第 N 层，--ds-surface（所在的面）= 第 N 层，深色的次级字随层提亮（选中底上仍 ≥ 4.5）。
 * - data-elevation-shadow="M"：阴影 = 第 M 层；focus-ring 自动外移 1px 压住阴影的 1px 环。
 * 悬停、选中是相对所在面的叠色（bg-hover / bg-selected），放在哪一层上都对，弹层里不用换色。
 *
 * 用法：
 *   // 自己渲染一个盒子
 *   <Elevated offset={ELEVATION.dialog.offset}>…</Elevated>
 *   // 合到 Radix 的内容节点上（放在 Portal 里面、Content 外面；Content 要把 ref、className、style 往下传，Radix 的都会）
 *   <MenuPrimitive.Portal>
 *     <Elevated asChild {...ELEVATION.popover}>
 *       <MenuPrimitive.Content className="rounded-popover p-(--ds-pad-popover)">…</MenuPrimitive.Content>
 *     </Elevated>
 *   </MenuPrimitive.Portal>
 *   // 只要层号（自己算颜色、画 canvas）：useElevation()
 * 用了 Elevated 的内容节点不要再写 bg-menu / bg-card / bg-canvas / shadow-popover / shadow-overlay，会盖掉层级的底色与阴影。
 * 动效：无（层级是结构，不是交互状态）。
 */
const MAX_LEVEL = 8

/** 约定的偏移：弹层 +2 且阴影固定第 3 层；对话框 +4，阴影随层 */
const ELEVATION = {
  popover: { offset: 2, shadow: 3 },
  dialog: { offset: 4 },
} as const

const clamp = (level: number) => Math.max(1, Math.min(MAX_LEVEL, Math.round(level)))

// 没有 Provider 就是页面本身：第 1 层
const ElevationContext = React.createContext<number>(1)

/** 子树所在的层（1–8） */
function useElevation(): number {
  return React.useContext(ElevationContext)
}

/** 把子树声明在第 level 层（Elevated 自己会提供；只在自己画面、不用 Elevated 时才直接用它） */
function ElevationProvider({ level, children }: { level: number; children?: React.ReactNode }) {
  return <ElevationContext.Provider value={clamp(level)}>{children}</ElevationContext.Provider>
}

type ElevatedProps = React.ComponentProps<"div"> & {
  /** 比所在层高几层：弹层 2，对话框 4 */
  offset: number
  /** 阴影用第几层；不写时随自己的层。弹层固定 3 */
  shadow?: number
  /** 把属性合到唯一的子元素上（Radix 的 Content），不另加一层 div */
  asChild?: boolean
}

function Elevated({ offset, shadow, asChild = false, ...props }: ElevatedProps) {
  const level = clamp(useElevation() + offset)
  const Comp = asChild ? Slot.Root : "div"
  return (
    <ElevationContext.Provider value={level}>
      <Comp
        data-elevation={level}
        data-elevation-shadow={clamp(shadow ?? level)}
        {...props}
      />
    </ElevationContext.Provider>
  )
}

export { Elevated, ElevationProvider, useElevation, ELEVATION }
export type { ElevatedProps }
