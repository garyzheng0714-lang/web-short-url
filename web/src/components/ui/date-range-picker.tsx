import * as React from "react"
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react"
import { AnimatePresence, motion, useIsPresent } from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  addDays,
  addMonths,
  CalendarWeekdays,
  CalendarWeeks,
  clampDate,
  dayKey,
  monthTitle,
  moveDay,
  sameDay,
  startOfDay,
  startOfMonth,
  useSlideVariants,
  type DayRange,
  type Slide,
} from "@/components/ui/calendar"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { useFieldControl } from "@/components/ui/field"
import { fieldSurface } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useOpenState } from "@/components/ui/popup"
import { Tooltip } from "@/components/ui/tooltip"

/**
 * 日期范围：报表筛选、请假、预订这类一次选起止两天的场合。触发器同日期选择（凹槽，右侧日历图标），
 * 点开是从触发器长出的弹出层：宽屏左侧快捷范围、右侧两个月并排；视口窄于 712 时一个月，快捷范围横排在上方。
 * 月格复用 Calendar 的 CalendarWeeks：第一次点是起点，指针移动时区间即时跟到指针，第二次点是终点（早于起点时自动交换）；
 * 两端是主题色实心圆，中间一条灰带（bg-active）。面板里选的是草稿：底部写区间与天数，「应用」才写回，「取消」、Esc、点外面丢弃。
 * 键盘：打开时焦点落在区间起点（没有就落在今天）；方向键 / Home / End / PageUp / PageDown 同 Calendar，移出两个月时视图跟着换；
 * 选了起点后键盘移动也带着区间预览；Enter / 空格选起点、终点；Tab 依次到快捷范围、上下月、日期、取消、应用。
 *
 * 动效（DESIGN.md §5.1、§5.2）：
 * - 指针点开 / 应用 / 取消 / 点外面 → 照 Popover（ui/popup）：以触发器为原点 scale .95→1、原路缩回，snappy；透明度进 200、出 150ms ease-ds。
 * - 键盘打开、Esc 关闭、键盘应用 → 0ms。
 * - 指针点上下月、点快捷范围导致换月 → 两个月一起照 Calendar 滑 16px（smooth，可打断）；键盘换月 0ms。
 * - 选起点、终点、悬停预览、快捷范围的当前态 → 即时（区间属于高频指针，不拉伸、不滑）。
 * - 减少动态效果 → 不缩放、不滑，只淡入淡出。
 */
type DateRange = DayRange
type DateRangePreset = { label: string; range: (today: Date) => DateRange }

const DAY = 864e5
const WIDE = 712
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)
const ordered = (a: Date, b: Date): DateRange => (a <= b ? { start: a, end: b } : { start: b, end: a })
const sameRange = (a?: DateRange | null, b?: DateRange | null) => Boolean(a && b && sameDay(a.start, b.start) && sameDay(a.end, b.end))
const days = (r: DateRange) => Math.round((startOfDay(r.end).getTime() - startOfDay(r.start).getTime()) / DAY) + 1
const monthsBetween = (a: Date, b: Date) => (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth()
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/** 「2026年9月25日 – 10月1日」：同一年时后一半省掉年份；同一天只写一天 */
function formatRange(r: DateRange) {
  const full = (d: Date) => `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
  if (sameDay(r.start, r.end)) return full(r.start)
  const tail = r.start.getFullYear() === r.end.getFullYear() ? `${r.end.getMonth() + 1} 月 ${r.end.getDate()} 日` : full(r.end)
  return `${full(r.start)} – ${tail}`
}

const DEFAULT_PRESETS: DateRangePreset[] = [
  { label: "今天", range: (t) => ({ start: t, end: t }) },
  { label: "最近 7 天", range: (t) => ({ start: addDays(t, -6), end: t }) },
  { label: "最近 30 天", range: (t) => ({ start: addDays(t, -29), end: t }) },
  { label: "本月", range: (t) => ({ start: startOfMonth(t), end: t }) },
  { label: "上个月", range: (t) => ({ start: startOfMonth(addMonths(t, -1)), end: endOfMonth(addMonths(t, -1)) }) },
  { label: "本季度", range: (t) => ({ start: new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1), end: t }) },
  { label: "今年", range: (t) => ({ start: new Date(t.getFullYear(), 0, 1), end: t }) },
]

/** 正在滑出的那一组月份：不接焦点、不被查询到，焦点只落在新的一组里 */
function MonthsBlock({ slide, children }: { slide: Slide; children: React.ReactNode }) {
  const present = useIsPresent()
  const variants = useSlideVariants()
  return (
    <motion.div
      data-slot="date-range-months"
      inert={!present || undefined}
      custom={slide}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      className="flex gap-6"
    >
      {children}
    </motion.div>
  )
}

function DateRangePicker({
  value: valueProp,
  defaultValue,
  onValueChange,
  presets = DEFAULT_PRESETS,
  months = "auto",
  placeholder = "选择日期范围",
  min: minProp,
  max: maxProp,
  weekStartsOn = 1,
  disabled = false,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  name,
  className,
  id,
  "aria-describedby": describedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: Omit<React.ComponentProps<"button">, "value" | "defaultValue" | "disabled"> & {
  /** 已应用的范围；传 null 表示受控且未选 */
  value?: DateRange | null
  defaultValue?: DateRange | null
  /** 点「应用」时回传，start ≤ end，都是本地日期的午夜 */
  onValueChange?: (range: DateRange) => void
  /** 快捷范围（range 收到的是本地的今天）；传 [] 不显示 */
  presets?: DateRangePreset[]
  /** 并排几个月：auto 时视口 ≥ 712 两个月，否则一个 */
  months?: "auto" | 1 | 2
  placeholder?: string
  min?: Date
  max?: Date
  weekStartsOn?: 0 | 1
  disabled?: boolean
  /** 进原生表单：提交 `${name}-start`、`${name}-end` 两个值（YYYY-MM-DD） */
  name?: string
  /** 受控：面板是否开着 */
  open?: boolean
  /** 非受控：挂载时就开着（静止展示，例如组件页舞台）；不抢焦点 */
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const uid = React.useId()
  const valueId = `${uid}-value`
  const { labelledBy: _, ...control } = useFieldControl({ id, "aria-describedby": describedBy, "aria-invalid": ariaInvalid })
  const min = minProp && startOfDay(minProp)
  const max = maxProp && startOfDay(maxProp)
  const [inner, setInner] = React.useState<DateRange | null>(defaultValue ?? null)
  const committed = valueProp !== undefined ? valueProp : inner

  const { open, setOpen } = useOpenState(openProp, defaultOpen, onOpenChange)
  // defaultOpen 挂载就开着（静止展示）：用户动它之前不把焦点放进面板（页面刚打开不抢焦点、不亮焦点环）
  const still = React.useRef(defaultOpen)
  const [count, setCount] = React.useState(2)
  const [view, setView] = React.useState(() => startOfMonth(new Date()))
  const [slide, setSlide] = React.useState<Slide>({ dir: 1, instant: true })
  const [draft, setDraft] = React.useState<DateRange | null>(null)
  const [anchor, setAnchor] = React.useState<Date | null>(null)
  const [hover, setHover] = React.useState<Date | null>(null)
  const [focusDay, setFocusDay] = React.useState<Date | null>(null)
  const panel = React.useRef<HTMLDivElement>(null)
  const pendingFocus = React.useRef(false)
  const today = startOfDay(new Date())

  const isDisabled = (d: Date) => Boolean((min && d < min) || (max && d > max))
  const fit = (n: number) => (months === "auto" ? (window.innerWidth >= WIDE ? 2 : 1) : n)
  const visible = Array.from({ length: count }, (_, i) => addMonths(view, i))
  const onScreen = (d: Date) => visible.some((m) => m.getFullYear() === d.getFullYear() && m.getMonth() === d.getMonth())
  // 这一组月份能看到这个范围的末尾：末尾那个月放在最右边；没有范围时，只能往后选（min ≥ 今天）今天在最左，否则在最右
  const viewFor = (r: DateRange | null, n: number) => {
    if (r) return startOfMonth(addMonths(r.end, -(n - 1)))
    return startOfMonth(min && min >= today ? today : addMonths(today, -(n - 1)))
  }

  const goTo = (next: Date, instant = fromKeyboard()) => {
    next = startOfMonth(next)
    const delta = monthsBetween(view, next)
    if (!delta) return
    setSlide({ dir: Math.sign(delta), instant })
    setView(next)
  }

  /** 快捷范围落到可选范围里（min / max 之外的部分截掉） */
  const presetRange = (p: DateRangePreset): DateRange => {
    const r = p.range(today)
    return { start: clampDate(startOfDay(r.start), min, max), end: clampDate(startOfDay(r.end), min, max) }
  }
  // 亮起的快捷范围 = 用户点的那一项（按 label 记），不从区间反推：月初几天「最近 7 天」「本月」「本季度」可能是同一段，
  // 反推只会亮第一个相同的（2026-10-07 收尾：点「本季度」亮的是「本月」）。应用后记住这一项，下次打开照旧亮它；
  // 只有区间不是从快捷范围来的（初值、外部受控改值）才按区间找第一个相同的，找不到就都不亮。
  const [picked, setPicked] = React.useState<string | null>(null)
  const applied = React.useRef<string | null>(null)
  const presetOf = (r: DateRange | null) => {
    const kept = presets.find((p) => p.label === applied.current)
    if (kept && sameRange(presetRange(kept), r)) return kept.label
    return presets.find((p) => sameRange(presetRange(p), r))?.label ?? null
  }

  // 每次打开（点触发器、defaultOpen、受控 open）都从已应用的范围重新开始：渲染时就换好，第一帧不是旧草稿
  const [opened, setOpened] = React.useState(false)
  if (open !== opened) {
    setOpened(open)
    if (open) {
      const n = typeof window === "undefined" ? 2 : fit(months === "auto" ? 2 : months)
      setCount(n)
      setDraft(committed)
      setPicked(presetOf(committed))
      setAnchor(null)
      setHover(null)
      setSlide({ dir: 1, instant: true })
      setView(viewFor(committed, n))
      setFocusDay(committed?.start ?? clampDate(today, min, max))
    }
  }
  // 只有用户打开时焦点进日历；静止展示不抢焦点
  const openChange = (next: boolean) => {
    still.current = false
    if (next) pendingFocus.current = true
    setOpen(next)
  }

  // 窗口变宽变窄时换成一个 / 两个月，不动画
  React.useEffect(() => {
    if (!open || months !== "auto") return
    const onResize = () => setCount(fit(2))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, months])

  React.useEffect(() => {
    if (!pendingFocus.current || !open || !focusDay) return
    const el = panel.current?.querySelector<HTMLElement>(`[data-slot=date-range-months]:not([inert]) [data-day="${dayKey(focusDay)}"]`)
    if (!el) return
    pendingFocus.current = false
    el.focus({ preventScroll: true })
  })

  const pick = (d: Date) => {
    if (isDisabled(d)) return
    setFocusDay(d)
    setPicked(null)
    if (!anchor) {
      setAnchor(d)
      setHover(d)
      setDraft(null)
      return
    }
    setDraft(ordered(anchor, d))
    setAnchor(null)
    setHover(null)
  }

  const choosePreset = (p: DateRangePreset) => {
    const next = presetRange(p)
    setDraft(next)
    setPicked(p.label)
    setAnchor(null)
    setHover(null)
    setFocusDay(next.start)
    if (!onScreen(next.start) || !onScreen(next.end)) goTo(viewFor(next, count))
  }

  const apply = () => {
    const next = anchor ? { start: anchor, end: anchor } : draft
    if (!next) return
    applied.current = anchor ? null : picked
    if (valueProp === undefined) setInner(next)
    onValueChange?.(next)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const day = (e.target as HTMLElement).dataset.day
    if (!day) return
    const [y, m, d] = day.split("-").map(Number)
    const moved = moveDay(e.key, new Date(y, m - 1, d), weekStartsOn, e.shiftKey)
    if (!moved) return
    e.preventDefault()
    const next = clampDate(moved, min, max)
    setFocusDay(next)
    if (anchor) setHover(next)
    pendingFocus.current = true
    if (next < view) goTo(next)
    else if (!onScreen(next)) goTo(addMonths(startOfMonth(next), -(count - 1)))
  }

  const shown = anchor ? ordered(anchor, hover ?? anchor) : draft
  const current = anchor ? -1 : presets.findIndex((p) => p.label === picked)
  const tabbable = [focusDay, shown?.start, today].find((d): d is Date => Boolean(d && onScreen(d))) ?? visible[0]
  const prevOff = Boolean(min && startOfMonth(min) >= view)
  const nextOff = Boolean(max && startOfMonth(max) <= visible[visible.length - 1])
  const status = anchor ? `开始 ${formatRange({ start: anchor, end: anchor })}，选择结束日期` : shown ? `${formatRange(shown)}，共 ${days(shown)} 天` : ""
  const wide = count === 2

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-slot="date-range-picker-trigger"
          data-placeholder={committed ? undefined : ""}
          id={control.id}
          aria-invalid={control["aria-invalid"]}
          aria-describedby={[valueId, control["aria-describedby"]].filter(Boolean).join(" ")}
          className={cn(
            fieldSurface,
            "flex h-(--ds-h-md) w-full min-w-0 items-center justify-between gap-2 rounded-control px-3 text-left text-sm text-fg outline-none",
            "data-placeholder:text-fg-muted",
            className
          )}
          {...props}
        >
          <span id={valueId} className="truncate tabular-nums">
            {committed ? formatRange(committed) : placeholder}
          </span>
          <CalendarRange className="size-4 shrink-0 text-fg-muted" aria-hidden />
        </button>
      </PopoverTrigger>
      {name && committed ? (
        <>
          <input type="hidden" name={`${name}-start`} value={ymd(committed.start)} />
          <input type="hidden" name={`${name}-end`} value={ymd(committed.end)} />
        </>
      ) : null}
      <PopoverContent
        ref={panel}
        align="start"
        aria-label="选择日期范围"
        data-slot="date-range-picker-content"
        // 高不过可用空间：手机上触发器在屏幕中间时上下都放不下一整个面板（540），超出的在面板里滚，不跑出屏幕（2026-10-04 复查：顶部被切掉 148）
        // 内边距同菜单（--ds-pad-popover）：贴边的快捷范围、翻月、「应用」用 rounded-popover-item = 面板圆角 − 这段内边距，四角同心（DESIGN.md §4.4）。
        // 2026-10-06 第四轮：原来 p-3，「应用」在右下角圆角 15，同心应为 21 − 12 = 9，刻度里没有这一档
        className="max-h-(--radix-popover-content-available-height) w-auto max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain p-(--ds-pad-popover)"
        onOpenAutoFocus={(e) => {
          // 内容层在 Portal 挂上之后才有日期格：在这一刻把焦点交给起点（没有就今天），不交给面板本身
          e.preventDefault()
          pendingFocus.current = false
          if (focusDay && !still.current) panel.current?.querySelector<HTMLElement>(`[data-day="${dayKey(focusDay)}"]`)?.focus({ preventScroll: true })
        }}
      >
        <div className={cn("flex", wide ? "gap-4" : "flex-col gap-3")}>
          {presets.length ? (
            <div
              role="group"
              aria-label="快捷范围"
              data-slot="date-range-presets"
              // 窄时放不下就换行：横向滚动没有任何「还能往右」的提示，最后一项被切一半（2026-10-05 排查：「本月」）
              className={cn("flex gap-0.5", wide ? "w-28 shrink-0 flex-col" : "w-0 min-w-full flex-wrap")}
            >
              {presets.map((p, i) => (
                <button
                  key={p.label}
                  type="button"
                  data-slot="date-range-preset"
                  aria-pressed={i === current}
                  onClick={() => choosePreset(p)}
                  className={cn(
                    "flex h-(--ds-h-sm) shrink-0 items-center rounded-popover-item px-2 text-left text-sm whitespace-nowrap text-fg outline-none",
                    "hover:bg-hover hover:text-fg focus-visible:focus-ring",
                    "aria-pressed:bg-selected aria-pressed:text-fg"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="grid gap-3">
            <div className="relative" onKeyDown={onKeyDown} onPointerLeave={() => anchor && setHover(null)}>
              <AnimatePresence mode="popLayout" initial={false} custom={slide}>
                <MonthsBlock key={`${dayKey(view)}-${count}`} slide={slide}>
                  {visible.map((m) => (
                    <div key={dayKey(m)} className="grid">
                      <div className="flex h-(--ds-h-md) items-center justify-center text-sm font-medium text-fg tabular-nums" id={`${uid}-${dayKey(m)}`}>
                        {monthTitle(m)}
                      </div>
                      <div role="grid" aria-labelledby={`${uid}-${dayKey(m)}`} className="mt-2">
                        <CalendarWeekdays weekStartsOn={weekStartsOn} />
                        <CalendarWeeks
                          month={m}
                          weekStartsOn={weekStartsOn}
                          today={today}
                          tabbable={tabbable}
                          isDisabled={isDisabled}
                          range={shown}
                          onSelect={pick}
                          onHover={(d) => anchor && setHover(d)}
                        />
                      </div>
                    </div>
                  ))}
                </MonthsBlock>
              </AnimatePresence>
              <Tooltip content="上个月">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="上个月"
                  aria-disabled={prevOff || undefined}
                  className="absolute top-0 left-0 rounded-popover-item!"
                  onClick={() => !prevOff && goTo(addMonths(view, -1))}
                >
                  <ChevronLeft />
                </Button>
              </Tooltip>
              <Tooltip content="下个月">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="下个月"
                  aria-disabled={nextOff || undefined}
                  className="absolute top-0 right-0 rounded-popover-item!"
                  onClick={() => !nextOff && goTo(addMonths(view, 1))}
                >
                  <ChevronRight />
                </Button>
              </Tooltip>
            </div>
            {/* 窄屏一个月只有 252 宽：区间一行、按钮一行（用网格：换行的 flex 会按一行的总宽撑开面板） */}
            {/* 宽屏底边对齐（items-end）：区间两行比按钮高，居中时「应用」离底 10、离右 6，角上的控件要离两边一样远（DESIGN.md §4.4） */}
            <div className={cn(wide ? "flex items-end gap-3" : "grid gap-3")}>
              {/* 窄屏贴面板左边：px-2 让字和上面快捷范围的字同一条竖线 */}
              <div className={cn("grid min-w-0", wide ? "flex-1" : "px-2")} data-slot="date-range-summary">
                <span className="truncate text-sm text-fg tabular-nums">
                  {anchor ? `${formatRange({ start: anchor, end: anchor })} –` : shown ? formatRange(shown) : "未选择"}
                </span>
                <span className="min-h-5 text-xs text-fg-muted tabular-nums">{shown && !anchor ? `${days(shown)} 天` : null}</span>
              </div>
              <div className="flex justify-end gap-3">
                {/* 同一行的两颗按钮同一个圆角：圆角档改了（R = 4）也不一颗圆一颗方 */}
                <Button variant="ghost" onClick={() => setOpen(false)} className="rounded-popover-item!">
                  取消
                </Button>
                <Button data-slot="date-range-apply" disabled={!shown} onClick={apply} className="rounded-popover-item!">
                  应用
                </Button>
              </div>
            </div>
          </div>
        </div>
        <span className="sr-only" aria-live="polite">
          {status}
        </span>
      </PopoverContent>
    </Popover>
  )
}

export { DateRangePicker, DEFAULT_PRESETS as dateRangePresets, formatRange }
export type { DateRange, DateRangePreset }
