import * as React from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { EXIT, SPRINGS } from "@/components/ui/ease"
import { FluidHoverHighlight, useFluidHover, type ItemRect } from "@/components/ui/fluid-hover"

/**
 * 一组导航项的两块底（DESIGN.md K2、K6、§4.3「当前」）：导航、分页、标签栏、落地页胶囊共用。
 * - 悬停：整组只有一块跟随悬停底（ui/fluid-hover），指针在空隙、内边距、末项之后也落在最近一项；键盘焦点（:focus-visible）移到哪项，底跟到哪项。
 *   指向当前项时只画当前底，避免 fast 与 moderate 两块底在换页途中错位叠影。
 * - 当前：一块在项之间滑动的底（moderate 0.16s，临界阻尼不过冲）；同一项只是因为别处折叠、换行而挪了位置时直接到位，不追着它滑。
 *   第一次量好之前，当前项自己画一块静态底（NavHighlightItem 的 staticCurrent），首帧就有当前项、不闪。
 * - 项按 DOM 顺序登记，看不见的（display: none，例如容器查询藏起来的页码）不登记，容器尺寸变了重排一次。
 * - 冻结：同一侧栏（或同一组）里有弹层开着（[aria-haspopup] 的触发器处于打开）时，指针移动不换悬停项。
 * - 减少动态：当前底直接到位；悬停底由 fluid-hover 自己处理（位置直接到位，只留淡入淡出）。
 * 用法：容器 relative isolate，摊开 handlers，把 overlays 放进容器（列表容器里包一层 <li aria-hidden className="contents">），
 * 用 NavHighlightContext.Provider 包住项；项里调用 useNavHighlightItem(current) 拿 ref。
 */

type NavHighlightOptions = {
  /** y：竖排（默认）· x：横排 */
  axis?: "x" | "y"
  /** 两块底共用的圆角类（rounded-row、rounded-control、rounded-full…） */
  radius: string
  /** 当前底的颜色类，默认 bg-nav-current */
  current?: string
}

type Scope = {
  register: (element: HTMLElement) => () => void
  setCurrent: (element: HTMLElement, current: boolean) => void
  /** 两块底已经量好：之后项不再画自己的静态当前底 */
  measured: boolean
}

const NavHighlightContext = React.createContext<Scope | null>(null)

const byDomOrder = (a: HTMLElement, b: HTMLElement) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
/** 弹层开着：它的触发器带 aria-haspopup，处于打开（Radix 写 data-state=open，原生写 aria-expanded=true） */
const POPUP_OPEN = "[aria-haspopup]:not([aria-haspopup=false]):is([data-state=open],[aria-expanded=true])"

function useNavHighlight<T extends HTMLElement>(containerRef: React.RefObject<T | null>, { axis = "y", radius, current = "bg-nav-current" }: NavHighlightOptions) {
  const hover = useFluidHover(containerRef, { axis })
  const reduce = useReducedMotion() ?? false
  const elements = React.useRef(new Set<HTMLElement>())
  const currents = React.useRef(new Map<HTMLElement, boolean>())
  const ordered = React.useRef<HTMLElement[]>([])
  const [currentEl, setCurrentEl] = React.useState<HTMLElement | null>(null)
  const frame = React.useRef<number | null>(null)
  const { registerItem, setActiveIndex } = hover

  // 登记合并到下一帧排一次：排序要读可见性（布局），不在 ref 回调里同步读（DESIGN.md「首次布局」）
  const sync = React.useCallback(() => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const visible = [...elements.current].filter((el) => el.isConnected && el.getClientRects().length > 0).sort(byDomOrder)
      visible.forEach((el, i) => registerItem(i, el))
      for (let i = visible.length; i < ordered.current.length; i++) registerItem(i, null)
      ordered.current = visible
      setCurrentEl(visible.find((el) => currents.current.get(el)) ?? null)
    })
  }, [registerItem])

  React.useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(sync)
    ro.observe(container)
    return () => {
      ro.disconnect()
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [containerRef, sync])

  const register = React.useCallback(
    (element: HTMLElement) => {
      elements.current.add(element)
      sync()
      return () => {
        elements.current.delete(element)
        currents.current.delete(element)
        sync()
      }
    },
    [sync]
  )
  const setCurrent = React.useCallback(
    (element: HTMLElement, on: boolean) => {
      if (currents.current.get(element) === on) return
      currents.current.set(element, on)
      // 当前状态本帧回传，不等排序帧：aria-current 已经换行时不能仍把新行当成独立悬停项。
      if (on) setCurrentEl(element)
      sync()
    },
    [sync]
  )

  const [everMeasured, setEverMeasured] = React.useState(false)
  if (hover.isMeasured && !everMeasured) setEverMeasured(true)
  const context = React.useMemo<Scope>(() => ({ register, setCurrent, measured: everMeasured }), [register, setCurrent, everMeasured])

  // 当前底：重量的那一两帧里序号和尺寸可能对不上，留着上一次量好的位置
  const index = currentEl ? ordered.current.indexOf(currentEl) : -1
  const last = React.useRef<{ row: HTMLElement; rect: ItemRect } | null>(null)
  const measuredRect = hover.isMeasured && index >= 0 ? hover.itemRects[index] : undefined
  const rect = currentEl ? (measuredRect ?? (last.current?.row === currentEl ? last.current.rect : undefined)) : undefined
  // 换了一项才滑；同一项挪了位置（别处折叠、换行、窗口变宽）直接到位。和上一次提交比，不和上一次渲染比
  const rowChanged = Boolean(currentEl && last.current && last.current.row !== currentEl)
  React.useLayoutEffect(() => {
    last.current = currentEl && rect ? { row: currentEl, rect } : currentEl ? last.current : null
  })

  const popupOpen = () => {
    const container = containerRef.current
    const root = container?.closest("[data-slot=sidebar-wrapper]") ?? container
    return Boolean(root?.querySelector(POPUP_OPEN))
  }
  const handlers = {
    ...hover.handlers,
    onPointerMove: (event: React.PointerEvent) => {
      if (!popupOpen()) hover.handlers.onPointerMove(event)
    },
    // 键盘移动和指针共用同一块悬停底
    onFocus: (event: React.FocusEvent) => {
      const target = event.target as HTMLElement
      const i = ordered.current.findIndex((el) => el === target || el.contains(target))
      if (i >= 0 && target.matches(":focus-visible")) setActiveIndex(i)
    },
    onBlur: (event: React.FocusEvent) => {
      if (!containerRef.current?.contains(event.relatedTarget as Node | null) && !containerRef.current?.matches(":hover")) setActiveIndex(null)
    },
  }

  const overlays = (
    <>
      <AnimatePresence initial={false}>
        {everMeasured && rect ? (
          <motion.div
            key="current"
            aria-hidden
            data-slot="nav-current"
            className={cn("pointer-events-none absolute top-0 left-0 -z-10", radius, current)}
            initial={false}
            animate={{ x: rect.left, y: rect.top, width: rect.width, height: rect.height, opacity: 1 }}
            exit={{ opacity: 0, transition: EXIT.moderate }}
            transition={rowChanged && !reduce ? { ...SPRINGS.moderate, opacity: SPRINGS.fast } : { duration: 0 }}
          />
        ) : null}
      </AnimatePresence>
      {hover.activeIndex !== index ? <FluidHoverHighlight hover={hover} from={index >= 0 ? index : null} className={radius} /> : null}
    </>
  )

  return { context, handlers, overlays, hover }
}

/**
 * 项里用：拿到登记用的 ref（和使用方传进来的 ref 合在一起，渲染之间保持同一个函数）；
 * 不在任何一组里时 scoped 为 false（项自己画 :hover 底与静态当前底）
 */
function useNavHighlightItem<T extends HTMLElement>(current: boolean, external?: React.Ref<T>) {
  const scope = React.useContext(NavHighlightContext)
  const node = React.useRef<HTMLElement | null>(null)
  const latest = React.useRef(current)
  latest.current = current
  const register = scope?.register
  const setCurrent = scope?.setCurrent
  const own = React.useCallback(
    (element: HTMLElement | null) => {
      node.current = element
      if (!element || !register || !setCurrent) return
      const off = register(element)
      // 重新挂上（外面的 ref 换了）时把当前状态一起带上，不等下一次 current 变化
      setCurrent(element, latest.current)
      return () => {
        node.current = null
        off()
      }
    },
    [register, setCurrent]
  )
  const ref = React.useMemo(() => composeRefs<T>(own as React.Ref<T>, external), [own, external])
  React.useLayoutEffect(() => {
    if (node.current && setCurrent) setCurrent(node.current, current)
  }, [current, setCurrent])
  return { ref, scoped: Boolean(scope), staticCurrent: current && !scope?.measured }
}

/** 合并 ref：组件自己的 ref 与使用方传进来的 ref 都要拿到元素 */
function composeRefs<T>(...refs: (React.Ref<T> | undefined)[]) {
  return (value: T | null) => {
    const cleanups = refs.map((ref) => {
      if (typeof ref === "function") return ref(value)
      if (ref) (ref as React.RefObject<T | null>).current = value
    })
    return () => {
      cleanups.forEach((cleanup, i) => {
        if (typeof cleanup === "function") cleanup()
        else {
          const ref = refs[i]
          if (typeof ref === "function") ref(null)
          else if (ref) (ref as React.RefObject<T | null>).current = null
        }
      })
    }
  }
}

/**
 * 当前、选中时字重 600，不挤动旁边（DESIGN.md §4.1）：可见的字和一份隐形的 600 副本叠在同一格，格宽取 600 的宽；
 * 字重随 aria-current / aria-selected / data-state=active 变，80ms。截断时两份一起截。
 */
function WeightLabel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span data-slot="weight-label" className={cn("inline-grid min-w-0 grid-cols-[minmax(0,1fr)]", className)}>
      {/* 字重 80ms；焦点由键盘移动时（键盘展开目录、方向键换标签）0ms */}
      <span className="col-start-1 row-start-1 min-w-0 truncate transition-[font-weight] duration-(--ds-dur-fast) ease-ds group-aria-[current=page]/nav:font-semibold group-aria-selected/nav:font-semibold group-data-[state=active]/nav:font-semibold [:root:has(:focus-visible)_&]:transition-none">
        {children}
      </span>
      <span aria-hidden data-weight-ghost="" className="invisible col-start-1 row-start-1 min-w-0 truncate font-semibold">
        {children}
      </span>
    </span>
  )
}

export { NavHighlightContext, WeightLabel, composeRefs, useNavHighlight, useNavHighlightItem }
export type { NavHighlightOptions }
