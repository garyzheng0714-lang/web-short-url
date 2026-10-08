"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from "motion/react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

import { EXIT, FROM_FIRST_FRAME, SPRINGS } from "@/components/ui/ease"
import { nextFrame, useSizeCache } from "@/components/ui/frame"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { SwapText } from "@/components/ui/popup"
import { usePortalContainer } from "@/components/ui/portal-scope"

/** 第一个提示等多久（DESIGN.md §2.4「说明」）；上一个关掉后这么久内移到相邻触发器，直接出、不再等 */
const DELAY = 200
const SKIP_DELAY = 300
/** 外面有没有应用级的 TooltipProvider：有就共用它的计时（成组）；没有时每个提示自带一个，照样能用，只是不成组 */
const Grouped = React.createContext(false)

/** 整个应用（或一块区域）放一个：第一个提示等 200ms，之后 300ms 内移到相邻触发器的提示直接出、不再等（成组）。 */
function TooltipProvider({ delayDuration = DELAY, skipDelayDuration = SKIP_DELAY, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <Grouped value>
      <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...props} />
    </Grouped>
  )
}

/** 最近一次指针按下的时间（全页一个监听）：用来认出「指针关掉菜单后焦点被还回来」这一种聚焦 */
let lastPointerDown = -Infinity
if (typeof document !== "undefined") document.addEventListener("pointerdown", () => (lastPointerDown = performance.now()), true)

/** 正在退场的提示：相邻的提示直接出现时，让它们立刻消失，不和新提示叠在一起。 */
const leaving = new Set<() => void>()

/** 朝触发器方向 4px（DESIGN.md §2.4）：按 Radix 翻转后的实际一侧，上方的从下面滑上来、下方的从上面滑下来 */
const SLIDE = 4
const slideFrom = (side: string | undefined) =>
  side === "top" ? { x: 0, y: SLIDE } : side === "left" ? { x: SLIDE, y: 0 } : side === "right" ? { x: -SLIDE, y: 0 } : { x: 0, y: -SLIDE }

/**
 * 提示的外壳（Radix 内容层 asChild 到这里，进出场交给 motion，不叠 Radix 的 CSS 动画）。动效（DESIGN.md K3、§2.4、§4.2；键盘与指针同一套）：
 * - 出现（悬停 200ms、成组时直接、键盘聚焦）→ 透明度 + 朝触发器方向 4px，fast（0.08s）；挂载那一帧钉在起点，下一帧开播，
 *   animate 合进 FROM_FIRST_FRAME（挂载的长任务不算进动画：改前第一帧就到 70%）。还在退场的上一个立刻消失，不和新提示叠在一起。
 * - 消失（指针移开、焦点移走、Esc）→ 只淡出，EXIT.fast（0.06s），淡完即卸载。
 * - 开着时换字（「复制」→「已复制」）→ 新字从 blur 4 淡入 80、旧字淡出 60 并变糊（SwapText）；外框宽度从旧宽度弹到新宽度，fast。
 * - followCursor：沿一条轴跟着指针（又高又窄、又宽又矮的触发器），每次移动只写 MotionValue，不重渲染。
 * - 减少动态 → 不位移，只淡入淡出；换字直接换、宽度直接到位。
 */
function TooltipBubble({
  className,
  ref,
  style,
  content,
  present,
  onExited,
  follow,
  followAxis,
  children,
  ...props
}: Omit<React.ComponentProps<typeof motion.div>, "content" | "children"> & {
  content: React.ReactNode
  /** false = 播退场，播完调 onExited 卸载 */
  present: boolean
  onExited: () => void
  /** followCursor：指针离触发器中心多远（只在 followAxis 那条轴上加） */
  follow: MotionValue<number>
  followAxis?: "x" | "y"
  children?: React.ReactNode
}) {
  const safeToRemove = onExited
  const reduce = useReducedMotion()
  const node = React.useRef<HTMLDivElement>(null)
  const opacity = useMotionValue(0)
  const slideX = useMotionValue(0)
  const slideY = useMotionValue(0)
  const x = useTransform(() => slideX.get() + (followAxis === "x" ? follow.get() : 0))
  const y = useTransform(() => slideY.get() + (followAxis === "y" ? follow.get() : 0))
  // 换字时外框宽度：平时 auto，换字那一刻从旧宽度弹到新宽度（fast），到位后交还给 auto
  const width = useMotionValue<number | string>("auto")
  const running = React.useRef<AnimationPlaybackControls[]>([])
  const key = typeof content === "string" || typeof content === "number" ? String(content) : "node"
  const lastKey = React.useRef(key)
  // 换字前的宽度：ResizeObserver 缓存（border-box、不含缩放），挂载时不读 offsetWidth，不强制排版（DESIGN.md §4.2「不掉帧」、地位与技术栈「首次布局」）
  const size = useSizeCache(node)
  // 这次换字是不是要直接换：减少动态
  const still = Boolean(reduce)
  // 换字用的 SwapText（AnimatePresence + motion.span）不跟着挂载那一拍一起挂：先放同样外观的纯 span，
  // 进场开播后的下一个空闲时刻再换成 SwapText（initial={false}，字不动）。挂载那一拍少两层 motion，4× 降速下约 3ms
  const [swappable, setSwappable] = React.useState(false)
  React.useEffect(() => {
    // 没有 requestIdleCallback 的浏览器（Safari）用 50ms 定时器；有的话最多等 300ms
    if (typeof window.requestIdleCallback !== "function") {
      const timer = window.setTimeout(() => setSwappable(true), 50)
      return () => window.clearTimeout(timer)
    }
    const id = window.requestIdleCallback(() => setSwappable(true), { timeout: 300 })
    return () => window.cancelIdleCallback(id)
  }, [])

  React.useLayoutEffect(() => {
    running.current.forEach((a) => a.stop())
    running.current = []
    if (present) {
      leaving.forEach((cut) => cut())
      return nextFrame(() => {
        // 从透明开始的（新挂上的）才从起点滑；退场途中又回来的从当前位置接着走
        if (opacity.get() === 0 && !reduce) {
          const from = slideFrom(node.current?.dataset.side)
          slideX.jump(from.x)
          slideY.jump(from.y)
        }
        const enter = { ...SPRINGS.fast, ...FROM_FIRST_FRAME }
        running.current = [animate(opacity, 1, enter), animate(slideX, 0, enter), animate(slideY, 0, enter)]
      })
    }
    const cut = () => {
      leaving.delete(cut)
      running.current.forEach((a) => a.stop())
      opacity.set(0)
      safeToRemove()
    }
    leaving.add(cut)
    const cancel = nextFrame(() => {
      const fade = animate(opacity, 0, EXIT.fast)
      running.current = [fade]
      fade.then(() => leaving.has(cut) && cut())
    })
    return () => { cancel(); leaving.delete(cut) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present])

  React.useLayoutEffect(() => {
    const el = node.current
    if (!el || lastKey.current === key) return
    lastKey.current = key
    const now = width.get()
    const from = typeof now === "number" ? now : size.current.width || null
    // 只有换字这一刻量新宽度（指针点了复制之后，不在悬停路径上）
    el.style.width = "auto"
    const to = el.offsetWidth
    if (from === null || still || Math.abs(from - to) < 0.5) {
      width.set("auto")
      return
    }
    el.style.width = `${from}px`
    width.jump(from)
    return nextFrame(() => { animate(width, to, { ...SPRINGS.fast, onComplete: () => width.set("auto") }) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Radix 通过 asChild 传进来的 ref（定位要用）和自己读 data-state 的 ref 合在一起
  const attach = (el: HTMLDivElement | null) => {
    node.current = el
    if (typeof ref === "function") ref(el)
    else if (ref) ref.current = el
  }

  return (
    <motion.div
      ref={attach}
      data-slot="tooltip-content"
      className={cn(
        "relative z-50 flex items-center justify-center gap-2 overflow-hidden rounded-control bg-inverse px-2 py-1 text-xs font-normal whitespace-nowrap text-inverse-fg select-none",
        className
      )}
      {...props}
      style={{ contain: "layout", ...style, opacity, x, y, width }}
    >
      {/* 换字：新字从 blur 4 淡入 80、旧字淡出 60 并变糊，叠在同一格（旧字 popLayout 脱离排版，不撑宽） */}
      {swappable ? <SwapText className="inline-flex items-center gap-2">{content}</SwapText> : <span className="inline-flex items-center gap-2">{content}</span>}
      {/* Radix 经 asChild 塞进来的读屏副本（role="tooltip"，aria-describedby 指向它） */}
      {children}
    </motion.div>
  )
}


/**
 * 文字提示（DESIGN.md §2.4「说明」）：一行说明，不能交互。图标按钮必须配 Tooltip，写清动作；有快捷键时可以带上键位（「加粗 ⌘B」）。
 * 反色气泡（bg-inverse 黑底白字，无阴影）：高 28（上下 4、左右 8），字 13 / 400，圆角 rounded-control；离触发器 8（sideOffset）、离屏幕四边 ≥ 8，
 * 放不下翻到对侧。时机：悬停 200ms 出现；300ms 内移到相邻触发器直接出、不再等（同一个 TooltipProvider 里成组）。动效见 TooltipBubble。
 * 不掉帧（2026-10-06 实测：改前 4× 降速下出现那一下是一整块 48–61ms 的同步任务）：
 * 挂内容层走 useDeferredValue（渲染可切片）；直接 createPortal（不用 Radix Portal 的二次挂载）；自己管退场挂载（不用 AnimatePresence）；
 * 挂载时不读布局；换字的 SwapText 空闲时再挂。剩下的是 Radix 定位层自己的同步连锁（Popper 回写 placement、floating-ui flushSync）。
 */
function Tooltip({
  content,
  side = "bottom",
  sideOffset = 8,
  delayDuration,
  followCursor,
  open: openProp,
  onOpenChange,
  children,
}: {
  content: React.ReactNode
  side?: "top" | "bottom" | "left" | "right"
  /** 离触发器多远 */
  sideOffset?: number
  /** 这一个提示等多久才出；不写时用 TooltipProvider 的（默认 200） */
  delayDuration?: number
  /** 沿一条轴跟着指针：又高又窄的触发器（侧栏竖条）用 y，又宽又矮的用 x；另一条轴仍按 side 贴着触发器 */
  followCursor?: "x" | "y"
  /** 受控：例如点了复制以后让「已复制」留在原处，不随按下收起 */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactElement
}) {
  const grouped = React.useContext(Grouped)
  // 指针离触发器中心多远：每次移动只写 MotionValue，不重渲染；键盘或受控打开时停在中间
  const follow = useMotionValue(0)
  const [inner, setInner] = React.useState(false)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const container = usePortalContainer()
  const open = openProp ?? inner
  // 提示挂着 = 开着或正在退场。自己管挂载，不用 AnimatePresence：少一层 PresenceChild，退场播完由气泡调 onExited
  // 挂 Radix 定位层那次渲染延后、可切片、让出主线程（4× 降速下整块同步要 40ms+，掉一帧）：提示本来就是透明度 0 挂上、下一帧才开播，
  // 晚几毫秒提交看不出来。只延后挂内容层，开关本身同步：原来整个打开走 startTransition，过渡被页面上别的渲染压住时（/templates/record
  // 实测 600ms+）焦点已经离开，Radix 受控模式看到 open 还是 false 就不发关闭，过渡随后提交成打开，提示卡在没有焦点的按钮上（2026-10-06 第四轮）
  const shown = React.useDeferredValue(open)
  const [mounted, setMounted] = React.useState(open)
  if (open && shown && !mounted) setMounted(true)
  const unmount = React.useCallback(() => setMounted(false), [])
  // 触发器自己的菜单 / 浮层收起的时刻（aria-expanded true → false）：收起时焦点被还回触发器，不当成聚焦弹出提示
  const collapsedAt = React.useRef(-Infinity)
  // 触发器的菜单 / 浮层打开（aria-expanded=true）→ 提示立刻卸掉，不播退场：键盘打开菜单时提示叠在菜单上，
  // Esc 只关掉提示、菜单还开着（2026-10-06 第四轮：/templates/record、/templates/reader 的「更多」）。
  // 每个提示一个只看 aria-expanded 的 MutationObserver，不读布局
  const close = React.useRef<() => void>(() => {})
  close.current = () => {
    if (openProp === undefined) setInner(false)
    else if (openProp) onOpenChange?.(false)
    setMounted(false)
  }
  React.useEffect(() => {
    const el = trigger.current
    if (!el) return
    const watch = new MutationObserver(() => {
      if (el.getAttribute("aria-expanded") === "true") close.current()
      else collapsedAt.current = performance.now()
    })
    watch.observe(el, { attributes: true, attributeFilter: ["aria-expanded"] })
    return () => watch.disconnect()
  }, [])
  const setOpen = (next: boolean) => {
    // 菜单、对话框、侧栏浮层被指针关上时会把焦点还给触发元素，Radix 把这当成聚焦弹出提示：指针点完菜单项，按钮上又冒出「更多」
    // （浏览器此时还把它算作 :focus-visible）。刚用指针按过（1 秒内）、指针又不在它上面、也不是键盘引起的聚焦 → 不开
    // （2026-10-04 复查：项目页头、邮件外框、应用外框）。键盘聚焦、悬停、脚本聚焦（审计）照常
    const el = trigger.current
    if (next && el && !el.matches(":hover") && !fromKeyboard() && performance.now() - lastPointerDown < 1000) return
    // 菜单开着时不开提示：悬停 400ms 的计时在菜单打开后才到点、键盘焦点在菜单和触发器之间往返，都在这里被拦下（Radix 的计时到点只会调到这里）。
    // 菜单刚收起（300ms 内）焦点被还回来、指针又不在它上面 → 也不开：Esc 关菜单后提示不再冒出来
    if (next && el && el.getAttribute("aria-expanded") === "true") return
    if (next && el && !el.matches(":hover") && performance.now() - collapsedAt.current < 300) return
    if (openProp === undefined) setInner(next)
    onOpenChange?.(next)
  }
  const tooltip = (
    <TooltipPrimitive.Root open={open} onOpenChange={setOpen} delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger
        ref={trigger}
        asChild
        onPointerMove={
          followCursor
            ? (e: React.PointerEvent<HTMLElement>) => {
                const r = e.currentTarget.getBoundingClientRect()
                follow.set(followCursor === "y" ? e.clientY - (r.top + r.height / 2) : e.clientX - (r.left + r.width / 2))
              }
            : undefined
        }
        onFocus={followCursor ? () => follow.set(0) : undefined}
      >
        {children}
      </TooltipPrimitive.Trigger>
      {/* 直接 createPortal，不用 TooltipPrimitive.Portal：它先渲染空、layout effect 里再 setState 挂内容，白多一轮同步渲染 + 提交。
          内容层 forceMount 已显式写在 Content 上，不依赖 Portal 的 context */}
      {mounted && typeof document !== "undefined"
        ? createPortal(
            // 读屏用的隐藏副本默认会把 children 再渲染一遍（连同动效外壳）；文字提示直接给它文字
            <TooltipPrimitive.Content
              forceMount
              asChild
              side={side}
              sideOffset={sideOffset}
              collisionPadding={8}
              aria-label={typeof content === "string" ? content : undefined}
            >
              <TooltipBubble content={content} present={open} onExited={unmount} follow={follow} followAxis={followCursor} />
            </TooltipPrimitive.Content>,
            container ?? document.body
          )
        : null}
    </TooltipPrimitive.Root>
  )
  // 没有应用级的 Provider（Radix 的 Root 离不开它）：自带一个，等待照样 200ms，只是和别的提示不成组
  return grouped ? tooltip : <TooltipPrimitive.Provider delayDuration={DELAY} skipDelayDuration={SKIP_DELAY}>{tooltip}</TooltipPrimitive.Provider>
}

export { Tooltip, TooltipProvider }
