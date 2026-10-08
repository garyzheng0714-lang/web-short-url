"use client"

import { nextFrame } from "@/components/ui/frame"

import * as React from "react"
import { CircleAlert } from "lucide-react"
import { animate, motionValue, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DUR, EASE_OUT, SPRINGS } from "@/components/ui/ease"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { useSurface } from "@/components/ui/chart-surface"
import { useInvariant } from "@/components/ui/invariant"
import { Skeleton } from "@/components/ui/skeleton"
import { usePressScale } from "@/components/ui/stretch"

/**
 * 图表底座（视觉规则草案 docs/研究/图表.md）：折线、柱状、迷你图共用的东西都在这里、chart-axis（坐标与光标）和 chart-scale（数字、颜色、刻度、形状），
 * 图表自己只管几何。
 * - 量宽：ResizeObserver 量绘图区的真实像素，按像素重画，不拉伸；宽为 0（藏起来）时不画。
 * - 状态（§4.1）：加载 400ms 后才出现——有旧图时旧图变淡（不闪骨架、不跳高度），没图时一条呼吸的灰带；空是一句话；出错是一句话 + 重试。
 *   三种状态都在绘图区原位，高度不变。
 * - 读屏：figure 有名字，图形 aria-hidden，绘图区是 role="slider"（键盘逐点走、aria-valuetext 读当前点），另有一张隐藏表格列全部数据。
 *
 * 动效（DESIGN.md §5.1、§5.2；谁引起 → 用哪条 → 减少动态时）：
 * - 数据变了（指针点了范围、系统刷新）→ useMorph：从屏幕上此刻的样子形变到新数据，量程、格线同拍，smooth（从不过冲：数据弹过头就是画错了）；
 *   中途再变从当前形状、当前速度接着走（carry）→ 键盘引起、减少动态时直接到位。第一次出现不动；从「没有数据」到有数据只淡入 200。
 * - 指针扫过、键盘走点（useScrub）→ 光标见 chart-axis 的 ChartCursor；读数直接换数字（悬停预览这类高频切换不滚，rolling-number 的 still）。
 * - 图例开关（指针）→ 按压 0.97 + 颜色 150；被关掉的系列压回基线并淡出（数据形变，同上）→ 键盘 0ms。
 * - 加载变淡、恢复 → 透明度 200 / 150 → 减少动态时相同（只有透明度）。
 */

/** 绘图区的真实宽度（ResizeObserver）；宽为 0 时图表不画 */
function useChartWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null)
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // contentRect 保留分数像素且不含祖先 zoom / scale，轴与 SVG 共用布局坐标。
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** 把一个状态里的所有数摊平成「路径 → 数」（形变带速度时做投影用） */
function flat(x: unknown, path = "", out = new Map<string, number>()) {
  if (typeof x === "number") {
    if (Number.isFinite(x)) out.set(path, x)
  } else if (Array.isArray(x)) x.forEach((v, i) => flat(v, `${path}.${i}`, out))
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) flat(v, `${path}.${k}`, out)
  return out
}

/**
 * 中途换目标时把旧形变此刻的速度带进新形变（DESIGN.md §5.3 可打断：从当前位置、当前速度接着走）。
 * 旧形变在形状空间里的速度 = d at / dt × dt/ds；投影到新形变的方向（目标 − 此刻）上，得到新进度的初速度。
 * 正好反向（切回去）时就是「先顺着惯性多走一点再折回」，不会急停。
 */
function carry<S>(prev: { at: (t: number) => S; t: number; v: number }, next: (t: number) => S) {
  const eps = 1e-3
  const t1 = prev.t < 1 - eps ? prev.t + eps : prev.t - eps
  const a = flat(prev.at(prev.t))
  const b = flat(prev.at(t1))
  const s0 = flat(next(0))
  const s1 = flat(next(1))
  let num = 0
  let den = 0
  for (const [k, end] of s1) {
    const start = s0.get(k)
    if (start === undefined) continue
    const d = end - start
    den += d * d
    const pa = a.get(k)
    const pb = b.get(k)
    if (pa !== undefined && pb !== undefined) num += ((pb - pa) / (t1 - prev.t)) * prev.v * d
  }
  return den > 1e-9 ? Math.max(-20, Math.min(20, num / den)) : 0
}

/**
 * 数据形变：shown 是屏幕上此刻的样子。目标变了 → mix(此刻, 目标) 给出 t ∈ [0, 1] 的中间态，smooth 弹簧推着 t 走，每一帧交给 paint
 * 直接写 DOM（不重新渲染 React）。mix 返回 null 表示不形变（例如从空到有）。keys 是此刻要在页面上的元素（新旧两份的并集，落定后只剩新的）。
 * 中途再变：新形变从此刻的样子出发，并带着旧形变此刻的速度（carry）。
 */
/** instant：这次变化要不要直接到位（默认：最近一次输入是键盘）。数据只由系统推来的图（实时流）传 () => false：用户刚按过键，新读数照样 smooth */
function useMorph<S>(target: S, mix: (from: S, to: S) => ((t: number) => S) | null, paint: (s: S) => void, keysOf: (s: S) => string[], instant: () => boolean = fromKeyboard) {
  const shown = React.useRef(target)
  const fns = React.useRef({ mix, paint, keysOf })
  fns.current = { mix, paint, keysOf }
  const [keys, setKeys] = React.useState(() => keysOf(target))
  const reduce = useReducedMotion()
  const live = React.useRef<{ at: (t: number) => S; t: number; v: number } | null>(null)
  const first = React.useRef(true)
  React.useLayoutEffect(() => {
    const prev = live.current
    live.current = null
    const { mix, paint, keysOf } = fns.current
    const settle = () => {
      shown.current = target
      setKeys(keysOf(target))
      paint(target)
    }
    const at = first.current || reduce || instant() ? null : mix(shown.current, target)
    first.current = false
    if (!at) return settle()
    setKeys([...new Set([...keysOf(shown.current), ...keysOf(target)])])
    shown.current = at(0)
    paint(shown.current)
    const progress = motionValue(0)
    const off = progress.on("change", (t) => {
      shown.current = at(t)
      fns.current.paint(shown.current)
    })
    let done = false
    const cancel = nextFrame(() => {
      const anim = animate(progress, 1, {
        ...SPRINGS.smooth,
        velocity: prev && prev.v ? carry(prev, at) : 0,
        onComplete: () => {
          done = true
          settle()
        },
      })
      return () => anim.stop()
    })
    return () => {
      // 被新目标打断：记下此刻的进度和速度，下一次形变接着用
      if (!done) live.current = { at, t: progress.get(), v: progress.getVelocity() }
      cancel()
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduce])
  const repaint = React.useCallback(() => fns.current.paint(shown.current), [])
  return { keys, repaint, shown }
}

type Active = { index: number; keyboard: boolean } | null

/**
 * 扫读：指针悬停扫、触屏按住拖、键盘逐点走，三种入口同一个当前点。pick 把绘图区里的 (x, y)（像素）换成第几个点；返回 null 表示这里没有东西
 * （环形图的环心、树图的标题条外），指针在那里时放开。
 * 触屏：按下才开始（setPointerCapture），抬手、取消就放开；绘图区 touch-action: pan-y，竖着滑照常滚页面。
 * 键盘：←↓ 上一个、→↑ 下一个（还没开始时从最新一个起）、PageUp / PageDown 约 1/6、Home / End、Esc 放开。
 * move：按图的形状改方向键（热力图 ←→ 一周、↑↓ 一天）：返回新的序号，返回 undefined 用默认的。
 */
function useScrub(
  count: number,
  pick: (x: number, y: number) => number | null,
  onChange?: (index: number | null) => void,
  move?: (key: string, from: number | undefined, count: number) => number | undefined
) {
  const [active, setActive] = React.useState<Active>(null)
  const touching = React.useRef(false)
  const last = React.useRef<number | null>(null)
  const current = active && active.index < count ? active : null
  const set = (next: Active) => {
    setActive(next)
    const index = next?.index ?? null
    if (index !== last.current) onChange?.(index)
    last.current = index
  }
  const at = (e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    // 指针坐标是屏幕上的像素；pick 用的是布局像素。祖先有 CSS zoom 或缩放时两者不等（布局页展示台就是 zoom），按比例换回来
    const kx = el.offsetWidth ? r.width / el.offsetWidth : 1
    const ky = el.offsetHeight ? r.height / el.offsetHeight : 1
    return pick((e.clientX - r.left) / kx, (e.clientY - r.top) / ky)
  }
  const props = {
    role: "slider",
    tabIndex: count ? 0 : -1,
    "aria-valuemin": 0,
    "aria-valuemax": Math.max(0, count - 1),
    "aria-valuenow": current?.index ?? Math.max(0, count - 1),
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (!count || (e.pointerType === "touch" && !touching.current)) return
      const index = at(e)
      if (index === null) return current && !current.keyboard ? set(null) : undefined
      if (index !== current?.index || current?.keyboard) set({ index, keyboard: false })
    },
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (!count || e.pointerType !== "touch") return
      touching.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      const index = at(e)
      set(index === null ? null : { index, keyboard: false })
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "touch") return
      touching.current = false
      set(null)
    },
    onPointerCancel: () => {
      touching.current = false
      set(null)
    },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "touch" && !current?.keyboard) set(null)
    },
    onBlur: () => set(null),
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (!count) return
      const end = count - 1
      const from = current?.index
      const page = Math.max(1, Math.round(count / 6))
      const next: Record<string, number | null> = {
        ArrowLeft: from === undefined ? end : Math.max(0, from - 1),
        ArrowDown: from === undefined ? end : Math.max(0, from - 1),
        ArrowRight: from === undefined ? end : Math.min(end, from + 1),
        ArrowUp: from === undefined ? end : Math.min(end, from + 1),
        PageDown: Math.max(0, (from ?? end) - page),
        PageUp: Math.min(end, (from ?? end) + page),
        Home: 0,
        End: end,
      }
      if (e.key === "Escape" && current) {
        e.preventDefault()
        return set(null)
      }
      const custom = move?.(e.key, from, count)
      if (custom !== undefined) {
        e.preventDefault()
        return set({ index: Math.min(end, Math.max(0, custom)), keyboard: true })
      }
      if (!(e.key in next)) return
      e.preventDefault()
      set({ index: next[e.key]!, keyboard: true })
    },
  }
  return { active: current, props }
}

/** 一组元素按 key 挂 ref（形变时由 paint 直接写属性） */
function useRefMap<T extends Element>() {
  const map = React.useRef(new Map<string, T>())
  const bind = React.useCallback(
    (key: string) => (el: T | null) => {
      if (el) map.current.set(key, el)
      else map.current.delete(key)
    },
    []
  )
  return [map, bind] as const
}

/**
 * 外层：figure（读屏的名字）+ 容器查询。--chart-surface 是图所在的底（圆点描边环、标签垫底、遮罩用它）：
 * 不传 surface 时自己认出所在的底（useSurface），传了就用传的。
 */
function ChartFigure({
  label,
  surface,
  busy,
  className,
  children,
  ref,
  ...props
}: React.ComponentProps<"figure"> & { label: string; surface?: "canvas" | "card"; busy?: boolean }) {
  const own = React.useRef<HTMLElement>(null)
  const fail = useInvariant("ChartFigure")
  useSurface(own, surface, fail)
  const bind = React.useCallback(
    (el: HTMLElement | null) => {
      own.current = el
      if (typeof ref === "function") ref(el as HTMLElement & HTMLDivElement)
      else if (ref) (ref as React.RefObject<HTMLElement | null>).current = el
    },
    [ref]
  )
  return (
    <figure
      ref={bind}
      aria-label={label}
      aria-busy={busy || undefined}
      className={cn(
        "@container/chart m-0 grid min-w-0 gap-4 text-fg",
        surface === "card" ? "[--chart-surface:var(--color-card)]" : "[--chart-surface:var(--color-canvas)]",
        className
      )}
      {...props}
    >
      {children}
    </figure>
  )
}

/** 400ms 后才为真（§4.1 加载）：400ms 内结束的加载什么都不显示 */
function useLate(on: boolean) {
  const [late, setLate] = React.useState(false)
  React.useEffect(() => {
    if (!on) return setLate(false)
    const t = window.setTimeout(() => setLate(true), 400)
    return () => window.clearTimeout(t)
  }, [on])
  return on && late
}

/** 绘图区里的状态：没数据时加载是呼吸的灰带、空是一句话、出错是一句话 + 重试；有旧图时加载由图表自己变淡 */
function ChartStatus({ loading, empty, error, emptyLabel, onRetry }: { loading?: boolean; empty: boolean; error?: React.ReactNode; emptyLabel: string; onRetry?: () => void }) {
  const late = useLate(Boolean(loading) && empty && !error)
  if (error)
    return (
      <div data-slot="chart-error" className="absolute inset-0 grid place-content-center justify-items-center gap-2 text-sm text-fg-muted">
        <span className="flex items-center gap-1.5">
          <CircleAlert aria-hidden className="size-4 text-danger" />
          {error === true ? "加载失败" : error}
        </span>
        {onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            重试
          </Button>
        ) : null}
      </div>
    )
  if (loading)
    return late ? <Skeleton data-slot="chart-skeleton" className="absolute inset-x-0 top-1/3 bottom-0" /> : null
  if (empty)
    return (
      <p data-slot="chart-empty" className="absolute inset-0 m-0 grid place-content-center text-sm text-fg-muted">
        {emptyLabel}
      </p>
    )
  return null
}

/** 有旧图时的加载：400ms 后整块变淡（透明度 200 进 / 150 出），读屏经 aria-busy 知道 */
function useDim(loading?: boolean) {
  const late = useLate(Boolean(loading))
  return cn("transition-opacity ease-ds", late ? "opacity-40 duration-(--ds-dur-base)" : "duration-(--ds-dur-fast)")
}

/**
 * 读屏替身：一张隐藏表格列全部数据（图形本身 aria-hidden，不会念两遍）。
 * sr-only 放在外面一层 div 上：表格按内容撑宽、不认 width: 1px，直接给表格 sr-only 会把窄屏页面撑出横向滚动（390 宽实测多出 32px）。
 */
/** 色键：线（虚线系列是虚线）或方块（柱） */
function ChartKey({ color, dashed, bar }: { color: string; dashed?: boolean; bar?: boolean }) {
  return (
    <span
      aria-hidden
      data-slot="chart-key"
      className={cn("inline-block shrink-0", bar ? "size-2 rounded-full" : "h-0.5 w-3 rounded-full")}
      style={{ background: dashed ? `repeating-linear-gradient(to right, ${color} 0 3px, transparent 3px 5px)` : color }}
    />
  )
}

/** bar：面积类的图（河流、堆叠）色键画成圆点，线类画成短线 */
type LegendItem = { key: string; label: string; color: string; dashed?: boolean; bar?: boolean }

function LegendButton({ item, shown, onToggle }: { item: LegendItem; shown: boolean; onToggle: () => void }) {
  const { node, press, release } = usePressScale<HTMLButtonElement>(0.97)
  return (
    <button
      ref={node}
      type="button"
      aria-pressed={shown}
      data-slot="chart-legend-item"
      onClick={onToggle}
      onPointerDown={press}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      className={cn(
        "hit-area relative inline-flex h-(--ds-h-sm) pointer-coarse:min-h-(--ds-h-md) items-center gap-2 rounded-sm px-2 text-sm whitespace-nowrap outline-none select-none",
        "text-fg-muted transition-colors duration-(--ds-dur-fast) ease-ds hover:bg-hover hover:text-fg aria-[pressed=false]:text-fg-muted",
        "group/legend focus-visible:focus-ring focus-visible:transition-none"
      )}
    >
      <span className={cn("inline-flex transition-opacity duration-(--ds-dur-fast) ease-ds group-focus-visible/legend:transition-none", !shown && "opacity-30")}>
        <ChartKey color={item.color} dashed={item.dashed} bar={item.bar} />
      </span>
      {item.label}
    </button>
  )
}

/**
 * 图例：两个以上系列才有；每项是开关按钮（aria-pressed = 显示中），至少留一个；放不下就换行。第一个色键落在图的左缘线上。
 * extra：不是系列、不能开关的说明项（区间带、参考范围），排在系列后面、同一行同一个换行容器里，不另起一行。
 */
function ChartLegend({ items, hidden, onHiddenChange, extra }: { items: LegendItem[]; hidden: string[]; onHiddenChange: (hidden: string[]) => void; extra?: React.ReactNode }) {
  const toggles = items.length >= 2
  if (!toggles && !extra) return null
  return (
    <div role="group" aria-label="系列" data-slot="chart-legend" className="-mx-2 flex min-w-0 flex-wrap gap-x-1">
      {toggles
        ? items.map((item) => {
            const shown = !hidden.includes(item.key)
            const lastShown = shown && items.every((o) => o.key === item.key || hidden.includes(o.key))
            return (
              <LegendButton
                key={item.key}
                item={item}
                shown={shown}
                onToggle={() => {
                  if (lastShown) return
                  onHiddenChange(shown ? [...hidden, item.key] : hidden.filter((k) => k !== item.key))
                }}
              />
            )
          })
        : null}
      {extra ? (
        <span data-slot="chart-legend-note" className="inline-flex h-(--ds-h-sm) items-center gap-2 px-2 text-sm whitespace-nowrap text-fg-muted">
          {extra}
        </span>
      ) : null}
    </div>
  )
}

/**
 * 环心、圆环里的大数字放不下时降一档字号（不缩放、不截断，DESIGN.md §3.0 律四）。sizes 是从大到小的几档字号（像素），
 * room 是能用的宽。按此刻量到的宽与字号推算每一档的宽，取放得下的最大一档；都放不下时用最小一档。
 * 返回 [挂在那一行上的 ref, 第几档]；text 变了（换数据）、room 变了（容器变宽变窄）才重算。
 */
function useFitText<T extends HTMLElement>(sizes: number[], room: number, text: string) {
  const ref = React.useRef<T>(null)
  const [step, setStep] = React.useState(0)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el || !(room > 0)) return
    const now = parseFloat(getComputedStyle(el).fontSize) || sizes[step]
    const width = el.scrollWidth
    const fit = sizes.findIndex((s) => (width * s) / now <= room)
    setStep(fit < 0 ? sizes.length - 1 : fit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, text])
  return [ref, step] as const
}

/** 从「没有数据」到有数据（加载完成）：整块淡入 200；第一次渲染就有数据时不播 */
function useFadeIn<T extends HTMLElement | SVGElement>(has: boolean) {
  const ref = React.useRef<T>(null)
  const was = React.useRef(has)
  const reduce = useReducedMotion()
  React.useLayoutEffect(() => {
    if (has && !was.current && ref.current && !fromKeyboard()) {
      const el = ref.current
      was.current = has
      el.style.opacity = "0"
      return nextFrame(() => { el.style.opacity = ""; el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR.base * 1000, easing: `cubic-bezier(${EASE_OUT.join(",")})` }) })
    }
    was.current = has
  }, [has, reduce])
  return ref
}

export { ChartHeading, ChartReadout, RollingValue } from "@/components/ui/chart-readout"
export {
  ChartFigure,
  ChartKey,
  ChartLegend,
  ChartStatus,
  useChartWidth,
  useDim,
  useFadeIn,
  useFitText,
  useMorph,
  useRefMap,
  useScrub,
}
export type { Active, LegendItem }
