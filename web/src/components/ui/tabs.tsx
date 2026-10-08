"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { LiftedCard, LiftLabel, liftItem } from "@/components/ui/lifted-card"

/**
 * 标签页：切换整块内容（换了一块东西，DESIGN.md §2.2）。只换同一对象的值、不换面板时用 Segmented。
 * 外形（K6，用户 2026-10-07：标签页是胶囊）：没有轨道；当前项是一块胶囊底（bg-selected），文字 600、其余 fg-muted。
 * 项固定高 36 · 紧凑 28（--ds-h-md，随 Density），横向 12 · 8，图标 16 · 14、与字 8 · 4；项与项之间不留缝。标签栏到面板 16。
 * 标签栏四周留 4（-mx-1 px-1 -my-1 py-1）：外侧 2px 焦点环在横向滚动的外壳里不被裁掉；所以第一块胶囊的左缘和面板同一条线。
 * 动效（DESIGN.md §4.2、§4.3「当前」；胶囊、悬停、焦点环都在 LiftedCard pill 里）：
 * - 换标签 → 当前胶囊 moderate（0.16s）滑过去；指针按下的当帧就走（乐观），不等受控值。键盘方向键同一档。
 * - 指针停在别的标签上 → 一块淡胶囊从当前胶囊出发 fast（0.08s）跟过去，透明 0 → 0.4；当前胶囊淡到 0.85；
 *   离开标签栏 → 淡胶囊滑回当前胶囊（moderate）同时 60ms 淡出。空隙里也落到最近的标签，点空隙 = 点它。
 * - 文字：被悬停或当前 fg，其余 fg-muted；当前 600（隐形 600 副本占宽，不挤动旁边），颜色与字重 80ms；图标线 1.5 → 2，80ms。
 * - 键盘焦点：外侧 2px 环在标签之间 fast 滑动，只在 :focus-visible。
 * - 面板 → 新面板从切换方向一侧 8px 处滑入并淡入，fast（--ds-dur-fast 80ms，CSS keyframes，一次性进场）；旧面板立即隐藏（只有一层，高度只变一次）。
 *   整块面板不加 blur。首屏挂载不播。
 * - 减少动态 → 胶囊、环直接到位，只留透明度；面板只淡入、不平移。
 * 面板自己渲染，不用 Radix 的 Content：它包着 Presence，挂载时读 getComputedStyle().animationName，
 * 在首屏提交里强制做整页的首次布局（2026-10-04 性能实测，见 docs/验收/2026-10-04-性能/）。旧面板本来就立即隐藏、不播退场，用不上 Presence。
 * 键盘与焦点仍全在 Radix 的 Root / List / Trigger 上；面板与标签的 id、ARIA 关联照 Radix 的写法由这里生成。
 */
type Orientation = "horizontal" | "vertical"
const TabsContext = React.createContext<{ value: string; group: string; fade: boolean; dir: 1 | -1; orientation: Orientation } | null>(null)

const triggerId = (group: string, value: string) => `${group}-trigger-${value}`
const contentId = (group: string, value: string) => `${group}-content-${value}`

function useTabs(part: string) {
  const ctx = React.useContext(TabsContext)
  if (!ctx) throw new Error(`${part} 必须放在 Tabs 里`)
  return ctx
}

function Tabs({
  className,
  value: valueProp,
  defaultValue,
  onValueChange,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? "")
  // 面板要不要淡入：用户切换之后（指针与键盘同一档，DESIGN.md K3）；首屏直接出现
  const [fade, setFade] = React.useState(false)
  // 面板从哪一侧进来：新标签在旧标签右边就从右边进（事件里读一次 DOM 顺序，不在渲染里读布局）
  const [dir, setDir] = React.useState<1 | -1>(1)
  const value = valueProp ?? uncontrolled
  const group = `tabs-${React.useId()}`

  return (
    <TabsContext.Provider value={{ value, group, fade, dir, orientation }}>
      <TabsPrimitive.Root
        data-slot="tabs"
        value={value}
        orientation={orientation}
        onValueChange={(next) => {
          setFade(true)
          const from = document.getElementById(triggerId(group, value))
          const to = document.getElementById(triggerId(group, next))
          if (from && to) setDir(from.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1)
          if (valueProp === undefined) setUncontrolled(next)
          onValueChange?.(next)
        }}
        // asChild 包整块（section、Card、SplitPane）时不加排版：那块有自己的布局；加了 flex-col，里面 mx-auto max-w-* 的盒子
        // 会缩成内容宽（2026-10-06 compare-lanes 实测 563 / 862，只能各自补 w-full）
        className={cn(!props.asChild && "flex flex-col gap-4", className)}
        {...props}
      />
    </TabsContext.Provider>
  )
}

function TabsList({ className, children, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  const ctx = React.useContext(TabsContext)
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        // 四周 4：外侧焦点环（离边 2 + 宽 2）有地方画；fit-content 的父级按外边距盒算宽，所以最宽是 100% + 8
        "relative isolate -mx-1 -my-1 inline-flex w-fit max-w-[calc(100%+8px)] items-center px-1 py-1",
        "data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch",
        className
      )}
      {...props}
    >
      <LiftedCard group={ctx?.group ?? "tabs"} variant="pill" className="rounded-full" />
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({
  className,
  children,
  value,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const { group } = useTabs("TabsTrigger")
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      value={value}
      id={triggerId(group, value)}
      aria-controls={contentId(group, value)}
      // 固定高，不靠 py：和并排的按钮、输入框同高（DESIGN.md §3.1）
      className={cn(liftItem, "h-(--ds-h-md)", className)}
      {...props}
    >
      <LiftLabel>{children}</LiftLabel>
    </TabsPrimitive.Trigger>
  )
}

function TabsContent({
  className,
  value,
  forceMount,
  style,
  children,
  ...props
}: Omit<React.ComponentProps<typeof TabsPrimitive.Content>, "asChild">) {
  const { value: current, group, fade, dir, orientation } = useTabs("TabsContent")
  const selected = value === current
  const present = Boolean(forceMount) || selected
  // 挂载时就是当前的面板不播进场（同 Radix：下一帧之后才放开）
  const mountStill = React.useRef(selected)
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => (mountStill.current = false))
    return () => cancelAnimationFrame(frame)
  }, [])
  // 一次性进场走 CSS keyframes，只挂在当前面板上；旧面板立即隐藏，新旧两块不叠在一起。
  // 面板元素一直在（非当前的是 hidden），hidden → 显示时 keyframes 重新播放。只有透明度，减少动态效果时照常淡入。
  return (
    <div
      data-slot="tabs-content"
      data-state={selected ? "active" : "inactive"}
      data-orientation={orientation}
      role="tabpanel"
      aria-labelledby={triggerId(group, value)}
      hidden={!present}
      id={contentId(group, value)}
      tabIndex={0}
      className={cn(
        // transition-none：下面的 duration-* 只给进场 keyframes 用；不写它，duration 会让面板上所有属性带上过渡，
        // 叠放的面板切走时 visibility 要等过渡走完才藏起来，新旧两层叠在一起（2026-10-05 用户：「切换的时候有残影」）
        "rounded-control outline-none transition-none focus-visible:focus-ring-zone",
        fade && "data-[state=active]:animate-in duration-(--ds-dur-fast) ease-ds fade-in-0 motion-reduce:[--tw-enter-translate-x:0]",
        fade && (dir > 0 ? "slide-in-from-right-2" : "slide-in-from-left-2"),
        className
      )}
      style={{ ...style, animationDuration: mountStill.current ? "0s" : undefined }}
      {...props}
    >
      {present && children}
    </div>
  )
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
