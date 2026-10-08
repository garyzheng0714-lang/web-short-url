import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

import { useDensity } from "@/components/ui/density"
import { LiftedCard, LiftLabel, liftItem } from "@/components/ui/lifted-card"

/**
 * 分段切换：同一对象即时换值、无提交，每视图最多一个（DESIGN.md §2.2、K6）。
 * items 必须是字面量数组或 as const 常量；2–4 项，每项 ≤ 2 字时最多 6 项。换内容用 Tabs；提交字段用 RadioGroup；连续量用 Slider。
 * 外形：凹槽胶囊轨道（bg-well + 内阴影）里一块凸起的胶囊（LiftedCard raised）。轨道内边距 + 胶囊高 = 控件高：4 + 28 = 36 · 紧凑 2 + 24 = 28
 * （随 Density；触屏控件高放大时胶囊跟着长）。全部是胶囊，同心（DESIGN.md §4.4）。项横向 12 · 8，图标 16 · 14、与字 8 · 4。
 * 文字：被悬停或当前 fg，其余 fg-muted；当前 600（隐形 600 副本占宽），颜色与字重 80ms；图标线 1.5 → 2，80ms。
 * 动效（DESIGN.md §4.2；细节见 LiftedCard）：
 * - 换段 → 胶囊 moderate（0.16s）滑过去；指针按下当帧就走（乐观）。键盘（方向键移焦点，空格选中）同一档。
 * - 指针停在别的段上 → 淡胶囊（bg-hover 0.4）从当前胶囊出发 fast 跟过去，当前胶囊淡到 0.8；离开轨道滑回并 60ms 淡出。
 * - 键盘焦点 → 外侧 2px 环在段之间 fast 滑动；方向键移到的段同时亮起悬停胶囊。
 * - 按住当前段 → 胶囊压平（shadow-pressed，80 / 180ms）；按住左右拖 → fast 跟手、两端橡皮筋，松手 moderate 吸到最近一段并切换。
 * - 减少动态 → 位置直接到位，只留透明度。
 * onOptionIntent：鼠标或笔移上一项、键盘焦点移到一项时先通知（给使用方预加载那一项的数据）；
 * 当前项、禁用项不发；触屏不发（触屏没有悬停，点一下就是选中，不能先通知一次再选中一次）；指针按下引起的聚焦不算。
 */
function Segmented({
  className,
  value,
  onValueChange,
  items,
  group,
  onOptionIntent,
  "aria-label": ariaLabel,
}: {
  className?: string
  value: string
  onValueChange: (value: string) => void
  items: readonly { value: string; label: React.ReactNode; ariaLabel?: string; disabled?: boolean }[]
  /** 胶囊的名字（写在 data-group 上），页面内唯一 */
  group: string
  /** 用户可能要换到这一项（悬停、键盘聚焦）：先预加载它的数据 */
  onOptionIntent?: (value: string) => void
  "aria-label": string
}) {
  const compact = useDensity() === "compact"
  const intent = (next: string, disabled?: boolean) => {
    if (!disabled && next !== value) onOptionIntent?.(next)
  }
  return (
    <ToggleGroupPrimitive.Root
      data-slot="segmented"
      type="single"
      value={value}
      onValueChange={(next) => next && onValueChange(next)}
      aria-label={ariaLabel}
      className={cn(
        // w-fit：轨道只包住选项；放进 grid / 竖排 flex 里也不会被拉满、右边空出一截凹槽（2026-10-04 周历、收入瀑布）。要铺满时传 w-full（各段平分）
        "relative isolate inline-flex w-fit h-(--ds-h-md) touch-pan-y items-center rounded-full bg-well shadow-inset",
        compact ? "p-0.5" : "p-1",
        className
      )}
    >
      <LiftedCard
        group={group}
        variant="raised"
        className="rounded-full"
        onPick={(el) => {
          const next = el.dataset.value
          if (next && next !== value) onValueChange(next)
        }}
      />
      {items.map((item) => (
        <ToggleGroupPrimitive.Item
          key={item.value}
          value={item.value}
          data-slot="segmented-item"
          data-value={item.value}
          aria-label={item.ariaLabel}
          disabled={item.disabled}
          onPointerEnter={(e) => e.pointerType !== "touch" && intent(item.value, item.disabled)}
          onFocus={(e) => e.currentTarget.matches(":focus-visible") && intent(item.value, item.disabled)}
          // flex-1：轨道 w-full 时各段平分，不在右边空出一截凹槽；w-fit 时没有多余空间，宽度仍按字（2026-10-06 检查器「对齐」行空 52px）
          className={cn(liftItem, "h-full flex-1")}
        >
          <LiftLabel>{item.label}</LiftLabel>
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  )
}

export { Segmented }
