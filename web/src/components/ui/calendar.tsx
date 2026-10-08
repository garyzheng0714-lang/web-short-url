"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DUR, EASE_OUT, SPRINGS } from "@/components/ui/ease"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { usePressScale } from "@/components/ui/stretch"
import { Tooltip } from "@/components/ui/tooltip"

/**
 * 日历：在一个月里挑一天。直接放在页面上，或放进弹出层（DatePicker）。日期一律按本地日期的午夜处理。
 * 表头：左边「2026年10月」，右边（showToday 时「今天」胶囊）上个月 / 下个月正圆，和日期格同形（› 线条窄，行末 edge-end 加 ink-inset 5）。
 * 星期行 13 号淡墨；日期格 36 正方，7 列 × 固定 6 行（换月高度不变），不显示相邻月份的日期。
 * 状态：选中是 bg-selected 实心圆；今天字重 600；悬停 bg-hover；不可选的淡墨、点不了。一个月里只有一个选中项，换选时实心圆直接出现在新日期，不滑。
 * 到 min / max 所在月时上下月按钮是 aria-disabled（不是 disabled）：焦点留在按钮上，点了没反应。换月由读屏播报（aria-live）。
 * 键盘（role="grid"，只有一格在 Tab 序列里）：方向键 ±1 / ±7 天，Home / End 本周首尾，PageUp / PageDown 上下月，
 * 加 Shift 上下年，Enter / 空格选中；移出当前月时视图跟着换。
 * 月格（CalendarWeekdays + CalendarWeeks）单独导出，DateRangePicker 用它画两个月和区间：区间两端是主色实心圆（bg-action，同主按钮），
 * 中间一条灰带（bg-active），在一周的首尾、一个月的首尾收成圆头。两端不用 bg-selected：它和灰带只差一点点，起点终点分不出来
 * （2026-10-06 共用层，date-range-picker 实测只能靠「今天」的字重认终点）。
 *
 * 动效（DESIGN.md §5.1、§5.2）：
 * - 指针点上一月 / 下一月 / 今天 → 新月份的网格和标题从去的那一侧滑进 16px 并淡入，旧的往另一侧滑出淡出（从哪来、到哪去）；
 *   网格与标题同一条 smooth（整块面板），连点或中途点回去都从当前位置、当前速度接着走，不跳。透明度进 200ms、出 150ms ease-ds。
 * - 键盘换月（方向键、PageUp / PageDown、在按钮上按回车）→ 0ms，直接换。
 * - 选中、今天、悬停、区间 → 即时（实心圆直接出现在新日期，不滑；悬停同列表行，不过渡）。
 * - 指针按下日期格 → 按压：snappy 缩到 0.95，松手 snappy 弹回（usePressScale）；键盘不缩放。
 * - 减少动态效果 → 不滑动，新旧月份只交叉淡入淡出；按压直接到位。
 */
const SHIFT = 16
const PRESSED = 0.95
const WEEKDAYS = "日一二三四五六"

type Slide = { dir: number; instant: boolean }
type DayRange = { start: Date; end: Date }

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
/** 加减月份，日子超出新月份的天数时落到月末（1月31日 + 1 月 = 2月28日） */
const addMonths = (d: Date, n: number) => {
  const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate()
  return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last))
}
const sameDay = (a?: Date | null, b?: Date | null) => Boolean(a && b && a.toDateString() === b.toDateString())
const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
const monthTitle = (d: Date) => `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
const clampDate = (d: Date, min?: Date, max?: Date) => (min && d < min ? min : max && d > max ? max : d)
const daysIn = (month: Date) => new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()

/** 日历网格里的一次按键要移到哪一天；不是移动键返回 null */
function moveDay(key: string, from: Date, weekStartsOn: 0 | 1, shift = false): Date | null {
  const offset = (from.getDay() - weekStartsOn + 7) % 7
  const moves: Record<string, () => Date> = {
    ArrowLeft: () => addDays(from, -1),
    ArrowRight: () => addDays(from, 1),
    ArrowUp: () => addDays(from, -7),
    ArrowDown: () => addDays(from, 7),
    Home: () => addDays(from, -offset),
    End: () => addDays(from, 6 - offset),
    PageUp: () => addMonths(from, shift ? -12 : -1),
    PageDown: () => addMonths(from, shift ? 12 : 1),
  }
  return moves[key]?.() ?? null
}

/** 换月滑动：出场、入场都读 AnimatePresence 的 custom，退场中的网格拿到的是最新一次换月的方向 */
function useSlideVariants() {
  const reduce = useReducedMotion()
  return {
    enter: ({ dir, instant }: Slide) => (instant ? { x: 0, opacity: 1 } : { x: reduce ? 0 : dir * SHIFT, opacity: 0 }),
    center: { x: 0, opacity: 1, pointerEvents: "auto" as const, transition: { x: SPRINGS.smooth, opacity: { duration: DUR.base, ease: EASE_OUT } } },
    exit: ({ dir, instant }: Slide) => ({
      x: instant || reduce ? 0 : -dir * SHIFT,
      opacity: 0,
      pointerEvents: "none" as const,
      transition: instant ? { duration: 0 } : { x: SPRINGS.smooth, opacity: { duration: DUR.fast, ease: EASE_OUT } },
    }),
  }
}

type CalendarProps = Omit<React.ComponentProps<"div">, "defaultValue" | "onChange"> & {
  /** 选中的日期；传 null 表示受控且未选 */
  value?: Date | null
  defaultValue?: Date | null
  onValueChange?: (date: Date) => void
  /** 显示的月份（取其中任意一天） */
  month?: Date
  defaultMonth?: Date
  onMonthChange?: (month: Date) => void
  min?: Date
  max?: Date
  /** 返回 true 的日期不可选 */
  disabled?: (date: Date) => boolean
  /** 一周从哪天开始：0 周日，1 周一 */
  weekStartsOn?: 0 | 1
  /** 挂载时把焦点放到可聚焦的那一格（放进弹出层时用） */
  autoFocus?: boolean
  /** 表头加「今天」：回到本月并选中今天（今天不可选时只回到本月） */
  showToday?: boolean
}

function Calendar({
  value: valueProp,
  defaultValue,
  onValueChange,
  month: monthProp,
  defaultMonth,
  onMonthChange,
  min: minProp,
  max: maxProp,
  disabled,
  weekStartsOn = 1,
  autoFocus = false,
  showToday = false,
  className,
  ...props
}: CalendarProps) {
  const today = startOfDay(new Date())
  const min = minProp && startOfDay(minProp)
  const max = maxProp && startOfDay(maxProp)

  const [innerValue, setInnerValue] = React.useState(defaultValue ?? null)
  const value = valueProp !== undefined ? valueProp && startOfDay(valueProp) : innerValue
  const [innerMonth, setInnerMonth] = React.useState(() => startOfMonth(defaultMonth ?? value ?? clampDate(today, min, max)))
  const view = startOfMonth(monthProp ?? innerMonth)
  const [focused, setFocused] = React.useState(() => value ?? clampDate(today, min, max))
  const [slide, setSlide] = React.useState<Slide>({ dir: 1, instant: true })
  // 读屏播报：只在真的换了月之后才写进 live 区域（首次渲染不念）
  const [announce, setAnnounce] = React.useState("")

  const root = React.useRef<HTMLDivElement>(null)
  const pendingFocus = React.useRef(autoFocus)

  const isDisabled = (d: Date) => Boolean((min && d < min) || (max && d > max) || disabled?.(d))

  const changeMonth = (next: Date) => {
    next = startOfMonth(next)
    if (sameMonth(next, view)) return
    setSlide({ dir: next > view ? 1 : -1, instant: fromKeyboard() })
    setAnnounce(monthTitle(next))
    if (monthProp === undefined) setInnerMonth(next)
    onMonthChange?.(next)
  }

  const prevOff = Boolean(min && startOfMonth(min) >= view)
  const nextOff = Boolean(max && startOfMonth(max) <= view)

  const step = (months: number) => {
    // aria-disabled：按钮还能聚焦、能点，到头了什么都不做
    if ((months < 0 && prevOff) || (months > 0 && nextOff)) return
    changeMonth(addMonths(view, months))
    setFocused(clampDate(addMonths(sameMonth(focused, view) ? focused : view, months), min, max))
  }

  const select = (d: Date) => {
    if (isDisabled(d)) return
    if (valueProp === undefined) setInnerValue(d)
    setFocused(d)
    onValueChange?.(d)
  }

  const goToday = () => {
    changeMonth(today)
    setFocused(clampDate(today, min, max))
    if (!isDisabled(today)) select(today)
  }

  // 可以 Tab 进来的那一格：焦点所在（键盘可以停在不可选的日子上）→ 选中 → 今天 → 本月第一个可选的日子
  const days = Array.from({ length: daysIn(view) }, (_, i) => addDays(view, i))
  const tabbable =
    (sameMonth(focused, view) ? focused : undefined) ??
    [value, today].find((d) => d && sameMonth(d, view) && !isDisabled(d)) ??
    days.find((d) => !isDisabled(d)) ??
    days[0]

  React.useEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    root.current?.querySelector<HTMLElement>(`[data-day="${dayKey(tabbable)}"]`)?.focus({ preventScroll: true })
  })

  const onKeyDown = (e: React.KeyboardEvent) => {
    const day = (e.target as HTMLElement).dataset.day
    if (!day) return
    const [y, m, d] = day.split("-").map(Number)
    const moved = moveDay(e.key, new Date(y, m - 1, d), weekStartsOn, e.shiftKey)
    if (!moved) return
    e.preventDefault()
    const next = clampDate(moved, min, max)
    pendingFocus.current = true
    setFocused(next)
    changeMonth(next)
  }

  const variants = useSlideVariants()
  const motionProps = { custom: slide, variants, initial: "enter", animate: "center", exit: "exit" } as const
  const key = monthTitle(view)

  return (
    <div ref={root} data-slot="calendar" data-view={key} className={cn("w-fit select-none", className)} {...props}>
      <div className="mb-2 flex h-(--ds-h-md) items-center">
        <div className="relative flex flex-1 items-center self-stretch">
          <AnimatePresence mode="popLayout" initial={false} custom={slide}>
            <motion.span key={key} data-slot="calendar-caption" className="text-sm font-medium text-fg tabular-nums" {...motionProps}>
              {key}
            </motion.span>
          </AnimatePresence>
        </div>
        {showToday ? (
          <Button variant="ghost" size="sm" data-slot="calendar-today" className="rounded-full" onClick={goToday}>
            今天
          </Button>
        ) : null}
        <Tooltip content="上个月" side="top">
          <Button variant="ghost" size="icon" aria-label="上个月" aria-disabled={prevOff || undefined} className={cn("rounded-full", NAV_OFF)} onClick={() => step(-1)}>
            <ChevronLeft />
          </Button>
        </Tooltip>
        <Tooltip content="下个月" side="top">
          <Button
            variant="ghost"
            size="icon"
            aria-label="下个月"
            aria-disabled={nextOff || undefined}
            className={cn("edge-end rounded-full [--ds-ink-inset:5px]", NAV_OFF)}
            onClick={() => step(1)}
          >
            <ChevronRight />
          </Button>
        </Tooltip>
      </div>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
      <div role="grid" aria-label={key}>
        <CalendarWeekdays weekStartsOn={weekStartsOn} />
        <div className="relative" onKeyDown={onKeyDown}>
          <AnimatePresence mode="popLayout" initial={false} custom={slide}>
            <motion.div key={key} data-slot="calendar-grid" data-month={key} {...motionProps}>
              <CalendarWeeks
                month={view}
                weekStartsOn={weekStartsOn}
                today={today}
                tabbable={tabbable}
                isDisabled={isDisabled}
                selected={value}
                onSelect={select}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

/** 到头的上下月按钮：40% 由 Button 的禁用外观给（aria-disabled 同 disabled），这里只让它不接指针（不出「上个月」提示）；aria-disabled 不是 disabled，键盘焦点不丢 */
const NAV_OFF = "aria-disabled:pointer-events-none"

/** 星期行：7 列，13 号淡墨 */
function CalendarWeekdays({ weekStartsOn = 1 }: { weekStartsOn?: 0 | 1 }) {
  return (
    <div role="row" className="grid grid-cols-[repeat(7,var(--ds-h-md))]">
      {Array.from({ length: 7 }, (_, i) => {
        const name = WEEKDAYS[(i + weekStartsOn) % 7]
        return (
          <div key={name} role="columnheader" aria-label={`星期${name}`} className="flex h-7 items-center justify-center text-xs text-fg-muted">
            {name}
          </div>
        )
      })}
    </div>
  )
}

type CalendarWeeksProps = {
  /** 这个月（取其中任意一天） */
  month: Date
  weekStartsOn?: 0 | 1
  today: Date
  /** 可以 Tab 进来的那一天（不在这个月就整月都不在 Tab 序列里） */
  tabbable?: Date
  isDisabled: (date: Date) => boolean
  /** 单选：选中的那天 */
  selected?: Date | null
  /** 区间：两端实心圆，中间灰带；start 与 end 已排好序 */
  range?: DayRange | null
  onSelect: (date: Date) => void
  /** 指针移上一天（区间预览用） */
  onHover?: (date: Date) => void
}

/** 一个月的 6 行日期（rowgroup）。不处理键盘：方向键由外层的网格统一处理（单月、双月写法不同） */
function CalendarWeeks({ month, weekStartsOn = 1, today, tabbable, isDisabled, selected, range, onSelect, onHover }: CalendarWeeksProps) {
  const first = startOfMonth(month)
  const count = daysIn(first)
  const lead = (first.getDay() - weekStartsOn + 7) % 7
  const cells: (Date | null)[] = Array.from({ length: 42 }, (_, i) => (i >= lead && i < lead + count ? addDays(first, i - lead) : null))
  const lo = range?.start
  const hi = range?.end
  return (
    <div role="rowgroup" data-month={monthTitle(first)}>
      {Array.from({ length: 6 }, (_, row) => (
        <div key={row} role="row" className="grid grid-cols-[repeat(7,var(--ds-h-md))]">
          {cells.slice(row * 7, row * 7 + 7).map((d, col) => {
            if (!d) return <div key={col} role="gridcell" className="size-(--ds-h-md)" />
            const inRange = Boolean(lo && hi && d >= lo && d <= hi)
            const isStart = sameDay(d, lo)
            const isEnd = sameDay(d, hi)
            // 灰带：起点只画右半、终点只画左半；一周或一个月的首尾收成圆头；起止同一天不画
            const band =
              inRange && !sameDay(lo, hi)
                ? {
                    from: isStart ? "half" : "full",
                    to: isEnd ? "half" : "full",
                    roundL: !isStart && (col === 0 || d.getDate() === 1),
                    roundR: !isEnd && (col === 6 || d.getDate() === count),
                    // 起点落在一周最后一格、终点落在一周第一格时，这一行没有带子
                    none: (isStart && (col === 6 || d.getDate() === count)) || (isEnd && (col === 0 || d.getDate() === 1)),
                  }
                : null
            return (
              <CalendarDay
                key={col}
                date={d}
                selected={sameDay(d, selected)}
                edge={isStart || isEnd}
                inRange={inRange}
                band={band}
                today={sameDay(d, today)}
                disabled={isDisabled(d)}
                tabbable={sameDay(d, tabbable)}
                onSelect={onSelect}
                onHover={onHover}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

type Band = { from: string; to: string; roundL: boolean; roundR: boolean; none: boolean }

function CalendarDay({
  date,
  selected,
  edge,
  inRange,
  band,
  today,
  disabled,
  tabbable,
  onSelect,
  onHover,
}: {
  date: Date
  selected: boolean
  /** 区间的起点或终点 */
  edge: boolean
  inRange: boolean
  band: Band | null
  today: boolean
  disabled: boolean
  tabbable: boolean
  onSelect: (date: Date) => void
  onHover?: (date: Date) => void
}) {
  const { node, press, release } = usePressScale<HTMLButtonElement>(PRESSED)
  return (
    <div
      role="gridcell"
      aria-selected={selected || edge || inRange}
      aria-disabled={disabled || undefined}
      data-in-range={inRange && !edge ? "" : undefined}
      data-range-edge={edge ? "" : undefined}
      className="relative size-(--ds-h-md)"
    >
      {band && !band.none ? (
        <span
          aria-hidden
          data-slot="calendar-band"
          className={cn(
            "absolute inset-y-0 bg-active",
            band.from === "half" ? "left-1/2" : "left-0",
            band.to === "half" ? "right-1/2" : "right-0",
            band.roundL && "rounded-l-full",
            band.roundR && "rounded-r-full"
          )}
        />
      ) : null}
      <button
        ref={node}
        type="button"
        data-slot="calendar-day"
        data-day={dayKey(date)}
        tabIndex={tabbable ? 0 : -1}
        aria-label={`${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 星期${WEEKDAYS[date.getDay()]}`}
        aria-current={today ? "date" : undefined}
        aria-disabled={disabled || undefined}
        className={cn(
          "relative inline-flex size-full items-center justify-center rounded-full text-sm text-fg tabular-nums outline-none",
          "hover:bg-hover focus-visible:z-10 focus-visible:focus-ring",
          today && "font-semibold",
          selected && !edge && "bg-selected text-fg hover:bg-tertiary-hover",
          edge && "bg-action text-action-fg hover:bg-action-hover",
          disabled && "pointer-events-none text-fg-muted"
        )}
        onClick={() => onSelect(date)}
        onPointerEnter={() => !disabled && onHover?.(date)}
        onPointerDown={(e) => !disabled && press(e)}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
      >
        {date.getDate()}
      </button>
    </div>
  )
}

export {
  addDays,
  addMonths,
  Calendar,
  CalendarWeekdays,
  CalendarWeeks,
  clampDate,
  dayKey,
  monthTitle,
  moveDay,
  sameDay,
  sameMonth,
  startOfDay,
  startOfMonth,
  useSlideVariants,
}
export type { CalendarProps, CalendarWeeksProps, DayRange, Slide }
