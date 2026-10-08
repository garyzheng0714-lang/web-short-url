import * as React from "react"
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react"
import { useReducedMotion } from "motion/react"

import { contentWidth, useGeometryInvariant } from "@/components/ui/invariant"
import { cn } from "@/lib/utils"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { RollingNumber } from "@/components/ui/rolling-number"
import { SwapText } from "@/components/ui/popup"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * 指标：一个数字的摘要——名称、数值（逐位滚动）、较上期变化（方向箭头着色、文字灰阶）、迷你趋势线、一行补充。
 * 它不是白卡：指标平放在页面上（DESIGN.md §4.0「卡片是状态」，一屏常有四五个指标）；一排指标用 MetricGroup：
 * 1px 外框（fg-subtle）+ 上下缩进的格间竖线（line-strong），不用底色（DESIGN.md §9.2「关键数字只画线」）。
 * - 数值传数字，format 是 Intl.NumberFormat 的选项（千分位、小数位、百分比），prefix / suffix 放单位；读屏念完整的一句，不念滚动中的半截。
 * - change 是小数（0.184 = 上升 18.4%）；upIsGood=false 时上升是坏事（退款率），箭头变红。颜色只在箭头上，文字保持灰阶，并写出「上升 / 下降」给读屏。
 * - trend 是一串数：在最下面画一条撑满宽度、高 32 的折线（线宽 1.5），末点一个实心点；一个点、全相同、有负数都不出界、不除零。
 * - loading：名称照常显示；数值、变化行、趋势线 400ms 后一起出骨架，各占真实内容的位置（数值行高固定 1lh，到了不跳）。
 *
 * 动效（DESIGN.md §4.2；谁引起 → 用哪条 → 减少动态时）：
 * - 数值变了（系统刷新、指针切换时间范围）→ 每一位朝数值变化的方向滚到新数字（RollingNumber，fast）；位数变了，新增的那一位淡入；
 *   中途又变了从当前位置、当前速度接着滚，最终停在对的数 → 减少动态时直接换。
 * - 键盘引起的变化（例如方向键切时间范围）→ 0ms，直接换。
 * - 变化的百分比换字 → blur 4 交叉（SwapText：淡入 fast / 淡出 EXIT.fast）→ 减少动态时只淡入淡出。第一次出现不滚、不从 0 涨上来。
 * - 骨架（400ms 后才出）→ 淡入 80ms（--ds-dur-fast）。
 */

/** 迷你趋势线：viewBox 按点数和取值范围算，线宽不随缩放变 */
function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const W = 100
  const H = 32
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 2 - ((v - min) / span) * (H - 4)] as const)
  const [lx, ly] = pts.at(-1)!
  return (
    <svg aria-hidden data-slot="metric-sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("h-8 w-24 shrink-0 overflow-visible text-fg-muted", className)}>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {/* 末点：零长度的线 + 圆头，线宽不随拉伸变形，所以是正圆（circle 会被 preserveAspectRatio=none 压扁） */}
      <line x1={lx} y1={ly} x2={lx} y2={ly} className="stroke-fg" strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function MetricCard({
  label,
  value,
  format,
  prefix = "",
  suffix = "",
  change,
  upIsGood = true,
  changeLabel = "较上期",
  trend,
  context,
  loading = false,
  className,
}: {
  label: string
  value: number
  /** Intl.NumberFormat 的选项，例如 { maximumFractionDigits: 1 } */
  format?: Intl.NumberFormatOptions
  prefix?: string
  suffix?: string
  /** 较上期的变化，小数：0.184 是上升 18.4% */
  change?: number
  /** 上升是好事吗；退款率、流失率写 false */
  upIsGood?: boolean
  changeLabel?: string
  trend?: number[]
  /** 最后一行的补充，例如「近 30 天」 */
  context?: React.ReactNode
  loading?: boolean
  className?: string
}) {
  const reduce = useReducedMotion()
  const text = new Intl.NumberFormat("zh-CN", format).format(value)
  const [prev, setPrev] = React.useState(value)
  const [dir, setDir] = React.useState(1)
  if (value !== prev) {
    setPrev(value)
    setDir(value > prev ? 1 : -1)
  }
  const still = Boolean(reduce) || fromKeyboard()
  const [late, setLate] = React.useState(false)
  React.useEffect(() => {
    if (!loading) return setLate(false)
    const t = window.setTimeout(() => setLate(true), 400)
    return () => window.clearTimeout(t)
  }, [loading])
  const root = React.useRef<HTMLDivElement>(null)
  useGeometryInvariant("MetricCard", root, contentWidth)
  const up = (change ?? 0) >= 0
  // 显示成 0.0% 的变化就是持平：横箭头、淡墨，不说上升（2026-10-04 指标浏览「↗ 0.0%」）
  const flat = change !== undefined && Math.abs(change) < 0.0005
  const good = up === upIsGood
  const Arrow = flat ? ArrowRight : up ? ArrowUpRight : ArrowDownRight
  const pct = change === undefined ? "" : `${Math.abs(change * 100).toFixed(1)}%`

  return (
    <div ref={root} data-slot="metric-card" className={cn("@container/metric grid w-full min-w-0 content-start gap-1", className)}>
      <span className="truncate text-sm text-fg-muted">{label}</span>
      <div className="flex min-w-0 items-end">
        {/* inline-flex + items-start：数位是 overflow:hidden 的行内块，基线会落到盒子底；按盒子顶对齐，单位和数字才在同一条基线上 */}
        {/* min-h-lh：加载中只有骨架时这一行仍是一行字高（30 号字 38），数据到了不往下推 */}
        <span className="relative inline-flex min-h-lh items-start text-2xl font-semibold whitespace-nowrap text-fg tabular-nums @max-[160px]/metric:text-xl" data-slot="metric-value">
          {loading ? (
            <Skeleton className={cn("h-6 w-28 self-center transition-opacity duration-(--ds-dur-fast) ease-ds", !late && "opacity-0")} />
          ) : (
            <>
              <span className="sr-only">{`${prefix}${text}${suffix}`}</span>
              <span aria-hidden>{prefix}</span>
              <RollingNumber aria-hidden text={text} dir={dir} still={still} />
              <span aria-hidden>{suffix}</span>
            </>
          )}
        </span>
      </div>
      {change !== undefined || context ? (
        <span className="relative flex min-w-0">
          {/* 箭头贴百分比（4），说明离这一组 8（DESIGN.md §4.5：图标贴它说明的字，离别的组至少 2 倍） */}
          {/* 窄格里放不下就整段换行，不把「较上期」截成「较…」 */}
          <span className={cn("flex min-w-0 flex-wrap items-center gap-x-2 text-xs whitespace-nowrap text-fg-muted tabular-nums", loading && "invisible")}>
            {change !== undefined ? (
              <>
                <span className="flex shrink-0 items-center gap-1">
                  {/* 13 号字配 14 的图标（DESIGN.md §4.5） */}
                  <Arrow aria-hidden data-slot="metric-arrow" data-good={flat ? undefined : good} className={cn("size-3.5 shrink-0 glyph-start", flat ? "text-fg-muted" : good ? "text-success" : "text-danger")} />
                  <span className="sr-only">{`${changeLabel}${flat ? "持平" : up ? "上升" : "下降"}`}</span>
                  <span className="relative">
                    <SwapText>{pct}</SwapText>
                  </span>
                </span>
                <span>{changeLabel}</span>
              </>
            ) : null}
            {context ? (
              // 分隔点和补充是一块：换行时点不会孤零零留在行尾或打头
              <span className="flex items-center gap-2">
                {change !== undefined ? <span aria-hidden>·</span> : null}
                <span>{context}</span>
              </span>
            ) : null}
          </span>
          {loading ? <Skeleton className={cn("absolute inset-y-1.5 left-0 w-24 transition-opacity duration-(--ds-dur-fast) ease-ds", !late && "opacity-0")} /> : null}
        </span>
      ) : null}
      {trend ? (
        <div className="relative mt-1">
          <Sparkline values={trend} className={cn("h-8 w-full", loading && "invisible")} />
          {loading ? <Skeleton className={cn("absolute inset-0 transition-opacity duration-(--ds-dur-fast) ease-ds", !late && "opacity-0")} /> : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * 一排指标：1px 外框（fg-subtle）+ 上下缩进的格间竖线（line-strong），不用底色；内边距由这一排的宽度算。
 * 容器窄于 480 时竖着排，格间线换成左右缩进的横线。
 */
function MetricGroup({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="metric-group" className={cn("@container/mg w-full", className)} {...props}>
      {/* 格间线挂在「不是第一个」的格子上，不写 * + *：左右都是通配的相邻选择器会让浏览器在 body 开头插一个节点（弹出层的焦点哨兵）时
          重算整页样式，打开日期、颜色选择的那一帧多出约 40ms（4 倍降速，2026-10-04 复查第 11 条） */}
      <div
        data-space
        className={cn(
          "grid auto-cols-fr grid-flow-col rounded-control border border-fg-subtle @max-[480px]/mg:grid-flow-row",
          "*:relative *:p-inset",
          "[&>:not(:first-child)]:before:absolute [&>:not(:first-child)]:before:bg-line-strong",
          "[&>:not(:first-child)]:before:inset-y-inset [&>:not(:first-child)]:before:left-0 [&>:not(:first-child)]:before:w-px",
          "@max-[480px]/mg:[&>:not(:first-child)]:before:inset-x-inset @max-[480px]/mg:[&>:not(:first-child)]:before:top-0 @max-[480px]/mg:[&>:not(:first-child)]:before:bottom-auto @max-[480px]/mg:[&>:not(:first-child)]:before:h-px @max-[480px]/mg:[&>:not(:first-child)]:before:w-auto"
        )}
      >
        {children}
      </div>
    </div>
  )
}

export { MetricCard, MetricGroup }
