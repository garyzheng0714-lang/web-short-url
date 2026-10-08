"use client"

import * as React from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { EXIT, SPRINGS } from "@/components/ui/ease"
import { useInvariant } from "@/components/ui/invariant"

/**
 * 跟随悬停（DESIGN.md K2、§4.3「悬停」、§5「高亮只有一个」）：一组可点的项只有一块悬停底。
 * - 选哪一项：指针在某项里面就是它；否则取中心最近的一项（y 列表比竖向、x 横条比横向、xy 网格比直线距离），并列取第一个。
 *   所以指针在空隙、内边距、末项之后也落在一项上，底不会在两项之间熄灭。
 * - 一块底：贴在容器内边距的左上角，只走 transform 跟过去；宽高只在目标项尺寸不同时才变。
 *   底在 -z-10：容器写 `relative isolate`，项不用另写定位（开发时容器写错会崩溃，见 useInvariant）。
 * - 指针重新进入：在最近的项（或 from 指定的项，例如已选中的那行）淡入，不从上次离开的地方滑过来。
 * - 亮的就是点到的：点在空隙里转成对亮着那项的真实 click；点在项里、点在两项之间的控件上、亮的是禁用项，都不转。
 * - 量取：登记、项与容器尺寸变化合并到一个 rAF；弹层还没有布局时最多重试 3 帧，不发布全零的尺寸；isMeasured 之前不画底。
 * - 只认鼠标与触控笔：触屏没有悬停（DESIGN.md §3.10），点一下不留底。
 * - 动效（DESIGN.md §4.2）：底跟过去与淡入都走 fast（0.08s、回弹 0），淡出走 EXIT.fast（0.06s）。
 * - 减少动态：组件自己读 useReducedMotion()，位置直接到位，只留淡入淡出。
 * - 登记：项有固定序号时用 itemRef(i)；序号由使用方自由摆放决定的（表格行、列表行、卡片组）用 useFluidHoverScan 按 DOM 顺序登记。
 * 只有可点的项登记；禁用项（disabled、aria-disabled="true"、data-disabled 或 isItemDisabled 为真）留在登记里但跳过。
 */

type Axis = "x" | "y" | "xy"

/** 项在容器坐标里的位置（相对容器内边距的左上角，不受 transform 与滚动影响） */
type ItemRect = { top: number; left: number; width: number; height: number }

type FluidHoverOptions = {
  /** y：竖向列表（默认）· x：横条 · xy：网格 */
  axis?: Axis
  /** 额外的禁用判断；每次指针移动都会调，要便宜 */
  isItemDisabled?: (element: HTMLElement) => boolean
  /** 点在空隙里是否转给亮着的项：默认 true；false 关掉；maxDistance 只转离亮着的项边缘这么多像素以内的点击 */
  gapClick?: boolean | { maxDistance?: number }
}

type FluidHover = {
  activeIndex: number | null
  setActiveIndex: React.Dispatch<React.SetStateAction<number | null>>
  /** 按登记的序号排；没登记的序号是空位 */
  itemRects: readonly (ItemRect | undefined)[]
  /** 全部登记项都量过、没有待量的一轮：之前不画底，免得从错的位置滑到对的位置 */
  isMeasured: boolean
  /** 指针每次进入容器加一；底按它换 key，重新进入时淡入而不是滑过来 */
  session: number
  /** 尺寸可能过期时（一直挂着的弹层再次打开）手动重量一轮；登记与尺寸变化已经自动量 */
  remeasure: () => void
  /** 登记一项：registerItem(序号, 元素)，卸载时传 null */
  registerItem: (index: number, element: HTMLElement | null) => void
  /** 同一序号返回同一个 ref 回调：<button ref={hover.itemRef(i)}> */
  itemRef: (index: number) => (element: HTMLElement | null) => void
  /** 摊在容器上 */
  handlers: {
    onPointerEnter: (event: React.PointerEvent) => void
    onPointerMove: (event: React.PointerEvent) => void
    onPointerLeave: (event: React.PointerEvent) => void
    onScroll: () => void
    onClick: (event: React.MouseEvent) => void
  }
}

/** 亮着的项（布尔属性）；容器上写亮着的序号。开发者工具与验收脚本直接读 */
const ACTIVE_ATTR = "data-fluid-hover"
const INDEX_ATTR = "data-fluid-hover-index"
/** 弹层可能比登记晚一帧才有布局：最多等这么多帧，之后留着上一次完整的结果 */
const MEASURE_ATTEMPTS = 3
const DISABLED = ":disabled, [aria-disabled='true'], [data-disabled]"
/** 登记项只是外面一层盒子时，转发的 click 落到它里面的第一个可点元素上 */
const ACTIVATOR =
  "a[href], button, [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [role='option'], [role='radio'], [role='checkbox'], [role='tab'], [role='link'], [role='button']"
/** 两项之间的控件（菜单顶上的搜索框、底栏按钮）自己收点击 */
const CONTROL = "input, textarea, select, button, a, summary, [contenteditable], [role='textbox'], [role='searchbox'], [role='button']"

/** 指针（视口坐标）换到容器坐标：去掉容器的位置、祖先的缩放（弹层缩放进场中）、边框，加上滚动 */
function toLocal(container: HTMLElement, x: number, y: number) {
  const box = container.getBoundingClientRect()
  const sx = container.offsetWidth > 0 ? box.width / container.offsetWidth : 1
  const sy = container.offsetHeight > 0 ? box.height / container.offsetHeight : 1
  return {
    x: (x - box.left) / sx - container.clientLeft + container.scrollLeft,
    y: (y - box.top) / sy - container.clientTop + container.scrollTop,
  }
}

/** 选项规则：在里面的优先，否则中心最近；并列取第一个 */
function pickNearest(axis: Axis, point: { x: number; y: number }, rects: readonly (ItemRect | undefined)[], skip: (index: number) => boolean) {
  let inside: number | null = null
  let nearest: number | null = null
  let best = Infinity
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]
    if (!r || skip(i)) continue
    const inX = point.x >= r.left && point.x <= r.left + r.width
    const inY = point.y >= r.top && point.y <= r.top + r.height
    const dx = point.x - (r.left + r.width / 2)
    const dy = point.y - (r.top + r.height / 2)
    const hit = axis === "y" ? inY : axis === "x" ? inX : inX && inY
    const distance = axis === "y" ? Math.abs(dy) : axis === "x" ? Math.abs(dx) : Math.hypot(dx, dy)
    if (hit && inside === null) inside = i
    if (distance < best) {
      best = distance
      nearest = i
    }
  }
  return inside ?? nearest
}

/** 触屏没有悬停：点一下不留底 */
const hovers = (event: React.PointerEvent) => event.pointerType !== "touch"

function sameRects(a: readonly (ItemRect | undefined)[], b: readonly (ItemRect | undefined)[]) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const p = a[i]
    const q = b[i]
    if (p === q) continue
    if (!p || !q || p.top !== q.top || p.left !== q.left || p.width !== q.width || p.height !== q.height) return false
  }
  return true
}

function useFluidHover<T extends HTMLElement>(containerRef: React.RefObject<T | null>, options: FluidHoverOptions = {}): FluidHover {
  const { axis = "y", isItemDisabled, gapClick = true } = options
  const fail = useInvariant("FluidHover")
  const items = React.useRef(new Map<number, HTMLElement>())
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)
  const active = React.useRef<number | null>(null)
  active.current = activeIndex
  const [itemRects, setItemRects] = React.useState<readonly (ItemRect | undefined)[]>([])
  const rects = React.useRef<readonly (ItemRect | undefined)[]>([])
  const [isMeasured, setIsMeasured] = React.useState(false)
  const [session, setSession] = React.useState(0)
  const pointer = React.useRef<{ x: number; y: number } | null>(null)
  const pickFrame = React.useRef<number | null>(null)
  const measureFrame = React.useRef<number | null>(null)
  const checked = React.useRef(false)

  const disabled = React.useCallback(
    (element: HTMLElement) => element.matches(DISABLED) || (isItemDisabled?.(element) ?? false),
    [isItemDisabled]
  )

  /** 量一轮；有项还没有布局盒子（弹层未布局、display:none）时整轮作废，返回 false，上一次的结果留着 */
  const measure = React.useCallback(() => {
    const container = containerRef.current
    if (!container) return false
    if (!checked.current) {
      checked.current = true
      const style = getComputedStyle(container)
      if (style.position === "static" || (style.isolation !== "isolate" && style.zIndex === "auto"))
        fail(`容器要写 relative isolate（现在 position: ${style.position}、isolation: ${style.isolation}）：底在 -z-10，没有定位它不贴容器，没有层叠上下文它会沉到容器底色下面`)
    }
    const next: (ItemRect | undefined)[] = []
    for (const [index, element] of items.current) {
      if (element.offsetParent === null && element.offsetWidth === 0 && element.offsetHeight === 0) return false
      if (!container.contains(element)) {
        fail(`第 ${index} 项不在容器里：底只能贴在容器坐标上`)
        return false
      }
      // offsetTop / offsetLeft 是布局值，不受 transform（弹层缩放进场）影响；项包在容器里另一个定位盒子里时逐层加上去
      let top = element.offsetTop
      let left = element.offsetLeft
      let parent = element.offsetParent as HTMLElement | null
      while (parent && parent !== container && container.contains(parent)) {
        top += parent.offsetTop + parent.clientTop
        left += parent.offsetLeft + parent.clientLeft
        parent = parent.offsetParent as HTMLElement | null
      }
      next[index] = { top, left, width: element.offsetWidth, height: element.offsetHeight }
    }
    if (!sameRects(rects.current, next)) {
      rects.current = next
      setItemRects(next)
    }
    return true
  }, [containerRef, fail])

  /** 唯一报「量好了」的地方：所有触发合并到下一帧的一轮 */
  const schedule = React.useCallback(
    (attempts: number) => {
      if (measureFrame.current !== null) cancelAnimationFrame(measureFrame.current)
      measureFrame.current = requestAnimationFrame(() => {
        measureFrame.current = null
        if (measure()) setIsMeasured(true)
        else if (attempts > 1) schedule(attempts - 1)
      })
    },
    [measure]
  )

  const remeasure = React.useCallback(() => {
    setIsMeasured(false)
    schedule(MEASURE_ATTEMPTS)
  }, [schedule])

  const itemObserver = React.useRef<ResizeObserver | null>(null)
  const observer = React.useCallback(() => {
    if (!itemObserver.current && typeof ResizeObserver !== "undefined") itemObserver.current = new ResizeObserver(() => schedule(MEASURE_ATTEMPTS))
    return itemObserver.current
  }, [schedule])

  const registerItem = React.useCallback(
    (index: number, element: HTMLElement | null) => {
      const previous = items.current.get(index)
      if (element) {
        if (previous === element) return
        if (previous) itemObserver.current?.unobserve(previous)
        items.current.set(index, element)
        observer()?.observe(element)
        if (index === active.current) element.setAttribute(ACTIVE_ATTR, "")
      } else {
        if (!previous) return
        itemObserver.current?.unobserve(previous)
        previous.removeAttribute(ACTIVE_ATTR)
        items.current.delete(index)
        // 亮着的那项没了：在这次提交的登记都做完之后再判断，只是换了序号的行会把高亮交给现在这个序号上的行
        if (index === active.current) setActiveIndex((current) => (current === index && !items.current.has(index) ? null : current))
      }
      remeasure()
    },
    [observer, remeasure]
  )

  // 同一序号给同一个回调：每次渲染换新函数的话，React 会先传 null 再传元素，每次渲染都重量一轮
  const refs = React.useMemo(() => new Map<number, (element: HTMLElement | null) => void>(), [registerItem])
  const itemRef = React.useCallback(
    (index: number) => {
      let ref = refs.get(index)
      if (!ref) {
        ref = (element) => registerItem(index, element)
        refs.set(index, ref)
      }
      return ref
    },
    [refs, registerItem]
  )

  /** 按最后的指针位置选一项；同一帧里多次移动只算一次 */
  const pick = React.useCallback(() => {
    if (pickFrame.current !== null) cancelAnimationFrame(pickFrame.current)
    pickFrame.current = requestAnimationFrame(() => {
      pickFrame.current = null
      const container = containerRef.current
      const at = pointer.current
      if (!container || !at) return
      const point = toLocal(container, at.x, at.y)
      setActiveIndex(pickNearest(axis, point, rects.current, (i) => {
        const element = items.current.get(i)
        return !element || disabled(element)
      }))
    })
  }, [axis, containerRef, disabled])

  const onPointerEnter = React.useCallback((event: React.PointerEvent) => {
    if (!hovers(event)) return
    setSession((n) => n + 1)
  }, [])

  const onPointerMove = React.useCallback(
    (event: React.PointerEvent) => {
      if (!hovers(event)) return
      pointer.current = { x: event.clientX, y: event.clientY }
      pick()
    },
    [pick]
  )

  const onPointerLeave = React.useCallback((event: React.PointerEvent) => {
    if (!hovers(event)) return
    pointer.current = null
    if (pickFrame.current !== null) cancelAnimationFrame(pickFrame.current)
    pickFrame.current = null
    setActiveIndex(null)
  }, [])

  /** 容器自己滚动时指针下的项换了，指针不动也要重选 */
  const onScroll = React.useCallback(() => {
    if (pointer.current) pick()
  }, [pick])

  const maxDistance = typeof gapClick === "object" ? (gapClick.maxDistance ?? Infinity) : Infinity
  const onClick = React.useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as Element | null
      const container = containerRef.current
      if (!target || !container || gapClick === false) return
      for (const element of items.current.values()) if (element.contains(target)) return
      // 行在自己的点击冒泡途中被卸载（点「新建」后变成真的一项）：那次点击已经落地，不是空隙
      if (!target.isConnected) return
      const control = target.closest(CONTROL)
      if (control && control !== container && container.contains(control)) return
      const index = active.current
      const element = index === null ? undefined : items.current.get(index)
      if (!element || disabled(element)) return
      if (maxDistance !== Infinity) {
        const r = element.getBoundingClientRect()
        const dx = Math.max(r.left - event.clientX, 0, event.clientX - r.right)
        const dy = Math.max(r.top - event.clientY, 0, event.clientY - r.bottom)
        if (Math.hypot(dx, dy) > maxDistance) return
      }
      // 真的 DOM click：项自己的处理函数（和包着它的原件）照常跑，和指针点在里面一样
      const activator = element.matches(ACTIVATOR) || element.hasAttribute("tabindex") ? element : (element.querySelector<HTMLElement>(ACTIVATOR) ?? element)
      activator.click()
    },
    [containerRef, disabled, gapClick, maxDistance]
  )

  // 亮着的状态写进 DOM：React 不管这两个属性，不会被覆盖
  React.useEffect(() => {
    const container = containerRef.current
    if (activeIndex === null) container?.removeAttribute(INDEX_ATTR)
    else container?.setAttribute(INDEX_ATTR, String(activeIndex))
    const element = activeIndex === null ? undefined : items.current.get(activeIndex)
    element?.setAttribute(ACTIVE_ATTR, "")
    return () => {
      element?.removeAttribute(ACTIVE_ATTR)
      if (activeIndex !== null) items.current.get(activeIndex)?.removeAttribute(ACTIVE_ATTR)
    }
  }, [activeIndex, containerRef])

  // 容器尺寸变了（换行、窄屏）项会挪位：重量，但不撤 isMeasured——项还是那些，撤了底会闪
  React.useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === "undefined") return
    const resize = new ResizeObserver(() => schedule(MEASURE_ATTEMPTS))
    resize.observe(container)
    return () => resize.disconnect()
  }, [containerRef, schedule])

  React.useEffect(
    () => () => {
      if (pickFrame.current !== null) cancelAnimationFrame(pickFrame.current)
      if (measureFrame.current !== null) cancelAnimationFrame(measureFrame.current)
      itemObserver.current?.disconnect()
      itemObserver.current = null
    },
    []
  )

  return {
    activeIndex,
    setActiveIndex,
    itemRects,
    isMeasured,
    session,
    remeasure,
    registerItem,
    itemRef,
    handlers: { onPointerEnter, onPointerMove, onPointerLeave, onScroll, onClick },
  }
}

const ROOT_ATTR = "data-fluid-hover-root"

/**
 * 按 DOM 顺序登记：容器里匹配 selector 的元素依次是第 0、1、2… 项。给拿不到序号的组件用（表格行、列表行、时间线、树、卡片组）。
 * - 嵌在另一个用它的容器里的元素归那个容器；带 data-exiting 的（正在退场的行）不算，序号让给新来的行。
 * - 容器每次提交后、以及容器里增删元素或 data-exiting 变化时重扫一次，只重登记变了的序号。
 */
function useFluidHoverScan(hover: Pick<FluidHover, "registerItem">, containerRef: React.RefObject<HTMLElement | null>, selector: string) {
  const { registerItem } = hover
  const list = React.useRef<HTMLElement[]>([])
  const scan = React.useCallback(() => {
    const container = containerRef.current
    if (!container) return
    container.setAttribute(ROOT_ATTR, "")
    const next = [...container.querySelectorAll<HTMLElement>(selector)].filter(
      (el) => !el.closest("[data-exiting]") && el.parentElement?.closest(`[${ROOT_ATTR}]`) === container
    )
    const prev = list.current
    list.current = next
    for (let i = 0; i < Math.max(prev.length, next.length); i++) if (prev[i] !== next[i]) registerItem(i, next[i] ?? null)
  }, [containerRef, registerItem, selector])
  React.useLayoutEffect(scan)
  React.useEffect(() => {
    const container = containerRef.current
    if (!container || typeof MutationObserver === "undefined") return
    const observer = new MutationObserver(scan)
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-exiting", "data-clickable"] })
    return () => observer.disconnect()
  }, [containerRef, scan])
}

/** 位移与淡入都是 fast 档（0.08s，回弹 0）；淡出是 fast 的退场（0.06s），比淡入快一档（DESIGN.md §4.2） */
const TRAVEL = SPRINGS.fast
const FADE_IN = SPRINGS.fast
const FADE_OUT = EXIT.fast
const SNAP = { duration: 0 } as const

const box = (r: ItemRect) => ({ x: r.left, y: r.top, width: r.width, height: r.height })

type FluidHoverHighlightProps = {
  hover: Pick<FluidHover, "activeIndex" | "itemRects" | "isMeasured" | "session">
  /** 重新进入时从哪里淡入：序号（已选中的那行）或位置；不写就在指针最近的项原地淡入 */
  from?: number | ItemRect | null
  /** 留着状态但不画（弹层关着、暂时停用）：走一次淡出 */
  hidden?: boolean
  /** 圆角写这里（列表行 rounded-row，菜单行 rounded-popover-item），底色默认 bg-hover */
  className?: string
}

function FluidHoverHighlight({ hover, from, hidden = false, className }: FluidHoverHighlightProps) {
  const reduce = useReducedMotion() ?? false
  const { activeIndex, itemRects, isMeasured, session } = hover
  const rect = !hidden && isMeasured && activeIndex !== null ? itemRects[activeIndex] : undefined
  const start = typeof from === "number" ? itemRects[from] : (from ?? undefined)
  return (
    <AnimatePresence>
      {rect && (
        <motion.div
          key={session}
          aria-hidden
          data-slot="fluid-hover-highlight"
          className={cn("pointer-events-none absolute top-0 left-0 -z-10 bg-hover", className)}
          initial={{ opacity: 0, ...box(start ?? rect) }}
          animate={{ opacity: 1, ...box(rect) }}
          exit={{ opacity: 0, transition: FADE_OUT }}
          transition={{ ...(reduce ? SNAP : TRAVEL), opacity: FADE_IN }}
        />
      )}
    </AnimatePresence>
  )
}

export { useFluidHover, useFluidHoverScan, FluidHoverHighlight }
export type { FluidHover, FluidHoverOptions, FluidHoverHighlightProps, ItemRect }
