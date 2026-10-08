"use client"

import * as React from "react"
import { useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { formatNumber, splitScale, withUnit } from "@/components/ui/chart-scale"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { RollingNumber } from "@/components/ui/rolling-number"

/**
 * 图表的读数（和 chart 一起装，chart 里同名导出）：图上方的名字 · 大数字 · 补充，以及范围切换的唯一位置（action）。
 * 动效见 chart 的文件头：数据变了按位滚（rolling-number），扫读、键盘、减少动态时直接换。
 */

/**
 * 按位滚的数，基线能和旁边的字对齐：数位是裁切的行内块，自己的基线落在盒子底，旁边的单位会掉下去；
 * 所以底下垫一份看不见的同样文字撑出宽度和基线，滚动的数位叠在它上面（同字号、同行高，字形重合）。
 */
function RollingValue({ text, dir, still, slot, className }: { text: string; dir?: number; still: boolean; slot?: string; className?: string }) {
  return (
    <span aria-hidden data-slot={slot} className={cn("relative inline-block whitespace-nowrap tabular-nums", className)}>
      <span className="invisible">{text}</span>
      <span className="absolute inset-0 inline-flex items-start">
        <RollingNumber text={text} dir={dir} still={still} />
      </span>
    </span>
  )
}

/**
 * 读数：图上方的名字 · 大数字 · 补充。数字按位滚到新值（数据变了、指针点了范围）；扫读时直接换（still），键盘、减少动态时也直接换。
 * value 是数，format 把它变成字；读屏念 sr-only 的整句，不念滚动中的半截。
 * - 量级跟单位走：格式化出来以「万 / 亿」结尾时，万、亿并进后面的小字单位（4,164 + 「万次」），量级和单位不拆成一大一小。
 * - action：这张图的范围切换（年份、7 天 / 30 天）只有这一个位置——读数行右端，右缘对齐图的右缘；不在图上方另起一行、不再写一遍图名。
 *   放不下（窄屏、四项分段）时整块折到读数下面一行（flex-wrap，行距 12），不压住大数字、不把读数挤成省略号。
 */
function ChartReadout({ label, value, format = formatNumber, unit, sub, still, size = "lg", action }: { label: React.ReactNode; value: number | null; format?: (v: number) => string; unit?: string; sub?: React.ReactNode; still?: boolean; size?: "lg" | "sm"; action?: React.ReactNode }) {
  const reduce = useReducedMotion()
  const [prev, setPrev] = React.useState(value)
  const [dir, setDir] = React.useState(1)
  if (value !== prev) {
    setPrev(value)
    setDir((value ?? 0) >= (prev ?? 0) ? 1 : -1)
  }
  const full = value === null || !Number.isFinite(value) ? "—" : format(value)
  const [text, tail] = splitScale(full, unit)
  const body = (
    <div data-slot="chart-readout" className="grid min-w-0 content-start gap-1">
      <span className="truncate text-sm text-fg-muted">{label}</span>
      <span className={cn("flex items-baseline gap-1 whitespace-nowrap text-fg tabular-nums", size === "lg" ? "text-2xl font-semibold" : "text-lg font-semibold")}>
        <span className="sr-only">{withUnit(full, unit)}</span>
        <RollingValue slot="chart-readout-value" text={text} dir={dir} still={Boolean(still || reduce || fromKeyboard())} />
        {tail ? (
          <span aria-hidden data-slot="chart-readout-unit" className="text-sm font-normal text-fg-muted">
            {tail}
          </span>
        ) : null}
      </span>
      {sub ? <span className="truncate text-xs text-fg-muted tabular-nums">{sub}</span> : null}
    </div>
  )
  if (!action) return body
  return (
    <div data-slot="chart-readout-row" className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-3">
      {body}
      <div data-slot="chart-readout-action" className="shrink-0">
        {action}
      </div>
    </div>
  )
}

/**
 * 读数在图里面的图（环形图、华夫图：合计写在环心、占比写在图例）用的标题行：图名 · action。
 * action 同 ChartReadout：这张图的范围切换只有这一个位置，右缘对齐图例的右缘；放不下时折到下一行（行距 12）。
 * 图例在右边时它放在图例上面，名字和图例行的色键落在同一条列线上；图例在下面时它在图的上方。
 */
function ChartHeading({ label, action }: { label: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div data-slot="chart-readout-row" className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <span data-slot="chart-heading" className="min-w-0 truncate text-sm font-medium text-fg">
        {label}
      </span>
      {action ? (
        <div data-slot="chart-readout-action" className="shrink-0">
          {action}
        </div>
      ) : null}
    </div>
  )
}

export { ChartHeading, ChartReadout, RollingValue }
