"use client"

import { nextFrame } from "@/components/ui/frame"

import * as React from "react"
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, usePresence, useReducedMotion, useTransform, type MotionValue } from "motion/react"
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react"
import { toast as sonner, useSonner, type Action, type ToasterProps, type ToastT } from "sonner"

import { cn } from "@/lib/utils"
import { EXIT, SPRINGS, exitFallbackMs } from "@/components/ui/ease"
import { Elevated, ELEVATION } from "@/components/ui/elevated"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { Spinner } from "@/components/ui/spinner"
import { useSwipe } from "@/components/ui/toast-swipe"

/**
 * 轻提示：操作完成后的一句话反馈，底部居中，可带一个撤销类操作。调用照旧用 sonner 的 toast()，这里只负责画和动。
 * 多条叠成一摞、指上去展开。最小高 36（左右 16），宽 356，圆角 rounded-popover。
 * 面（DESIGN.md §4.1「面的层级」）：每条是一个弹层（Elevated + ELEVATION.popover：比所在层高 2 层，阴影固定第 3 层），浅色白底。
 * 键盘：每条提示可以聚焦（读屏念出「类型：标题」）；Esc 收起聚焦的那一条，焦点交给下一条，没有了就回到进通知区之前的地方；
 * Alt+T 把焦点移进最前一条（aria-keyshortcuts）。超出可见数的、正在离开的提示 inert。
 * 警告、错误默认多停一半时间（读的东西多）。
 *
 * 动效（DESIGN.md K3、§4.2；一条提示是 moderate 档）：
 * - 出现（系统）→ 从自己一个身位之下（屏幕下沿）升起：位移 SPRINGS.moderate（0.16s、不回弹），透明度 SPRINGS.fast（0.08s），不抢焦点。
 * - 堆叠 → 新的一条在最前；后面的每往后一层上移 12、缩小 5%、高度收成和最前一条一样、文字淡出（只露一条边）
 *   → 位置、缩放、高度、文字透明度同一条 SPRINGS.moderate，同时开始；超出可见数的淡出 EXIT.fast，回到可见的淡入 fast。
 * - 展开：鼠标指上去、触屏点一下卡片 → SPRINGS.moderate 展开成一列、间距 12，移开 / 再点 / 点外面收回；中途来回从当前位置、当前速度接着走。
 *   键盘焦点进来（Tab、Alt+T）也展开（才能够到操作按钮），但 0ms 直接到位；键盘离开同样直接收回。
 * - 拖走（指针直接操作，toast-swipe.ts）→ 横向或向下 1:1 跟手；向上按橡皮筋越拉越紧。松手时拖过 45px 或平均速度超过 0.11px/ms，
 *   就带着松手速度飞出去（SPRINGS.moderate）并 EXIT.moderate 淡出；不够就带着速度弹回原位（SPRINGS.moderate）。
 * - 离开（到时、撤销、Esc、toast.dismiss）→ 不回放进场：下沉一个身位并淡出，EXIT.moderate（0.12s 短过渡）；后面那条 SPRINGS.moderate 补上来。
 *   兜底：离开后 exitFallbackMs(EXIT.moderate)（220ms）一定交还移除，不等动画回调（后台标签页停住 rAF 时不留下隐形的提示）。
 * - 原位更新（toast.promise、同一个 id 再调一次）→ 外框高度 SPRINGS.moderate 过渡，图标和文字在 blur 4px 里交叉替换：
 *   新的走 fast 全长（0.08s、easeOut），旧的走 EXIT.fast（0.06s、easeIn），出现总比消失长；
 *   类型、标题、说明任一变了都算；淡出的旧文字 aria-hidden，读屏只念新的。
 * - 进度线（时间）→ 匀速：底边 1px，在停留时长内 linear 收短；指针在提示上、按住、焦点在里面、页面切到后台时和计时一起暂停。
 * - 减少动态效果：升起、堆叠、滑走都瞬间到位，只保留透明度（出现淡入 fast、离开淡出 EXIT.moderate）；不画进度线。
 * 只支持底部居中（position 等 sonner 的布局参数不生效）；同屏最多 3 条（visibleToasts）。
 */
type Id = ToastT["id"]
const PEEK = 12 // 收起时每往后一层露出的边
const GAP = 12 // 展开时两条之间的间距
const SHRINK = 0.05 // 每往后一层缩小的比例
const LONGER = 1.5 // 警告、错误的停留倍数
const KEYFRAMES = "@keyframes ds-toast-progress{from{transform:scaleX(1)}to{transform:scaleX(0)}}"
const TYPE_LABEL: Record<string, string> = { success: "成功：", info: "提示：", warning: "警告：", error: "错误：", loading: "进行中：" }

type Registry = Map<Id, { extent: () => number; visible: boolean }>

function Toaster({ duration = 4000, visibleToasts = 3, expand = false, icons, className, style }: ToasterProps) {
  const { toasts } = useSonner()
  const [heights, setHeights] = React.useState<Record<string, number>>({})
  const [hovered, setHovered] = React.useState(false)
  // 触屏没有悬停：点一下卡片展开，再点或点外面收起；键盘焦点在里面时也展开（指针点进来的焦点不算）
  const [tapped, setTapped] = React.useState(false)
  const [focused, setFocused] = React.useState(false)
  // 这次展开 / 收起是不是键盘焦点引起的：是就 0ms（DESIGN.md §5.1 键盘）
  const [instant, setInstant] = React.useState(false)
  const hover = (on: boolean) => (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !window.matchMedia("(hover: hover) and (pointer: fine)").matches || (!on && interacting)) return
    setInstant(false)
    setHovered(on)
  }
  const [interacting, setInteracting] = React.useState(false)
  const hidden = useDocumentHidden()
  const expanded = expand || hovered || tapped || focused
  const region = React.useRef<HTMLElement>(null)
  const list = React.useRef<HTMLOListElement>(null)
  // 进通知区之前焦点在哪：最后一条被 Esc 收起后把焦点还回去
  const returnFocus = React.useRef<HTMLElement | null>(null)
  // 列表的高度 = 这一叠提示实际占到的高度（由每条的弹簧算出）：它就是悬停热区，展开后条与条之间的空隙也算在里面
  const extent = useMotionValue(0)
  const registry = React.useRef<Registry>(new Map())
  const measure = React.useCallback(() => {
    let top = 0
    registry.current.forEach((item) => item.visible && (top = Math.max(top, item.extent())))
    extent.set(top)
  }, [extent])
  // h < 0：这条已经移走，忘掉它的高度
  const setHeight = React.useCallback(
    (id: Id, h: number) =>
      setHeights((all) => {
        if (all[id] === h || (h < 0 && !(id in all))) return all
        const next = { ...all, [id]: h }
        if (h < 0) delete next[id]
        return next
      }),
    []
  )
  /** 聚焦的那一条要离开：键盘用户落到下一条（没有就上一条），一条不剩时回到进来之前的地方 */
  const handOff = React.useCallback((leaving: HTMLElement) => {
    const items = [...(list.current?.children ?? [])] as HTMLElement[]
    const at = items.indexOf(leaving)
    const rest = items.filter((li) => li !== leaving && !li.inert)
    const next = rest.find((li) => items.indexOf(li) > at) ?? rest.at(-1)
    if (next) next.focus({ preventScroll: true })
    else if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true })
    else (leaving.ownerDocument.activeElement as HTMLElement | null)?.blur()
  }, [])

  React.useEffect(() => {
    if (toasts.length) return
    setHovered(false)
    setTapped(false)
    setFocused(false)
  }, [toasts.length])
  // 点外面收起
  React.useEffect(() => {
    if (!tapped) return
    const doc = region.current?.ownerDocument ?? document
    const down = (e: PointerEvent) => !region.current?.contains(e.target as Node) && setTapped(false)
    doc.addEventListener("pointerdown", down)
    return () => doc.removeEventListener("pointerdown", down)
  }, [tapped])
  // Alt+T：焦点移进最前一条（按物理键位认：macOS 上 ⌥T 打出来的是 †）
  React.useEffect(() => {
    const doc = region.current?.ownerDocument ?? document
    const key = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.code !== "KeyT" || e.isComposing) return
      const first = list.current?.querySelector<HTMLElement>(":scope > li:not([inert])")
      if (!first) return
      e.preventDefault()
      // focusVisible：带 Alt 的按键不算浏览器眼里的「键盘交互」，不写的话提示被聚焦了却没有焦点环
      first.focus({ preventScroll: true, focusVisible: true } as FocusOptions)
    }
    doc.addEventListener("keydown", key)
    return () => doc.removeEventListener("keydown", key)
  }, [])

  const front = toasts[0] ? (heights[toasts[0].id] ?? 0) : 0
  let before = 0
  return (
    <section ref={region} aria-label="通知" aria-keyshortcuts="Alt+T" aria-live="polite" aria-relevant="additions text" aria-atomic="false">
      <style href="ds-toast-progress" precedence="default">
        {KEYFRAMES}
      </style>
      <motion.ol
        ref={list}
        data-slot="toaster"
        data-expanded={expanded}
        tabIndex={-1}
        className={cn("fixed bottom-6 left-1/2 z-100 w-89 max-w-[calc(100vw-32px)] -translate-x-1/2 outline-none", className)}
        style={{ contain: "layout", ...style, height: extent }}
        onPointerEnter={hover(true)}
        onPointerMove={hover(true)}
        onPointerLeave={hover(false)}
        onFocus={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) returnFocus.current = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : null
          if (!fromKeyboard()) return
          setInstant(true)
          setFocused(true)
        }}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget)) return
          setInstant(fromKeyboard())
          setFocused(false)
        }}
        onPointerDown={() => setInteracting(true)}
        onPointerUp={() => setInteracting(false)}
        onPointerCancel={() => setInteracting(false)}
      >
        <AnimatePresence>
          {toasts.map((t, i) => {
            const offset = before
            before += (heights[t.id] ?? 0) + GAP
            const longer = t.type === "warning" || t.type === "error" ? LONGER : 1
            return (
              <ToastItem
                key={t.id}
                {...{ toast: t, index: i, count: toasts.length, visible: i < visibleToasts, expanded, instant, offset, front, icons, measure }}
                paused={expanded || interacting || hidden}
                duration={t.duration ?? duration * longer}
                registry={registry.current}
                onHeight={setHeight}
                onTap={() => (setInstant(false), setTapped((on) => !on))}
                onHandOff={handOff}
              />
            )
          })}
        </AnimatePresence>
      </motion.ol>
    </section>
  )
}

type ItemProps = {
  toast: ToastT
  index: number
  count: number
  visible: boolean
  expanded: boolean
  paused: boolean
  duration: number
  icons: ToasterProps["icons"]
  /** instant：这次叠放变化由键盘焦点引起，直接到位；offset：展开时前面各条的高度 + 间距之和；front：最前一条的高度（收起时后面各条都收成这么高） */
  instant: boolean
  offset: number
  front: number
  registry: Registry
  measure: () => void
  onHeight: (id: Id, h: number) => void
  /** onTap：触屏点了卡片（不是按钮），整叠展开或收起；onHandOff：聚焦的这一条要离开，把焦点交出去 */
  onTap: () => void
  onHandOff: (leaving: HTMLElement) => void
}

function ToastItem({ toast: t, index, count, visible, expanded, instant, paused, duration, offset, front, icons, registry, measure, onHeight, onTap, onHandOff }: ItemProps) {
  const reduce = useReducedMotion()
  const [isPresent, safeToRemove] = usePresence()
  const item = React.useRef<HTMLLIElement>(null)
  const content = React.useRef<HTMLDivElement>(null)
  const [natural, setNatural] = React.useState(0)
  const y = useMotionValue(0) // 在一叠里的位置（向上为负）
  const scale = useMotionValue(1)
  const opacity = useMotionValue(0)
  // 叠在后面时文字淡出（只露一条边）：和位置、缩放、高度同一条弹簧
  const textOpacity = useMotionValue(1)
  const height = useMotionValue<number | "auto">("auto")
  const swipeX = useMotionValue(0)
  const swipeY = useMotionValue(0)
  const shownY = useTransform(() => y.get() + swipeY.get())
  const entered = React.useRef(false)
  // 滑走时飞出去的那段淡出；有它就不再播普通的离开
  const flying = React.useRef<Promise<unknown> | null>(null)
  const autoClosed = React.useRef(false)

  // 自然高度：内容变了（等待 → 成功换了文案）就重新量，外框跟着弹过去
  React.useLayoutEffect(() => {
    const node = content.current
    if (!node) return
    const read = () => {
      setNatural(node.offsetHeight)
      onHeight(t.id, node.offsetHeight)
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(node)
    return () => ro.disconnect()
  }, [t.id, onHeight])

  // 登记到列表的热区计算里
  const entry = React.useRef({ extent: () => (typeof height.get() === "number" ? (height.get() as number) : natural) - shownY.get(), visible })
  entry.current.visible = visible && isPresent
  React.useLayoutEffect(() => {
    registry.set(t.id, entry.current)
    const off = [shownY.on("change", measure), height.on("change", measure)]
    return () => {
      registry.delete(t.id)
      off.forEach((f) => f())
      measure()
      onHeight(t.id, -1)
    }
  }, [registry, t.id, shownY, height, measure, onHeight])

  // 位置、缩放、高度、透明度的目标由在叠里的位置决定
  const collapsed = !expanded && index > 0
  const target = {
    y: expanded ? -offset : -PEEK * index,
    scale: expanded ? 1 : 1 - SHRINK * index,
    height: collapsed ? front : natural,
    opacity: visible ? 1 : 0,
  }
  React.useLayoutEffect(() => {
    if (!isPresent || flying.current || !natural) return
    const still = reduce || instant
    if (!entered.current) {
      entered.current = true
      // 出现：从自己一个身位之下升起；位移 moderate、透明度 fast（系统引起，不弹）
      height.jump(target.height)
      scale.jump(target.scale)
      textOpacity.jump(collapsed ? 0 : 1)
      // 起点同步写上：motion 的第一帧要等下一次刷新，不先写的话这一帧提示会停在终点（热区闪一下全高）
      y.jump(reduce ? target.y : natural)
      if (instant) { y.jump(target.y); opacity.jump(target.opacity); return }
      return nextFrame(() => {
        if (!reduce) animate(y, target.y, SPRINGS.moderate)
        animate(opacity, target.opacity, SPRINGS.fast)
      })
    }
    if (still) {
      y.jump(target.y); scale.jump(target.scale); height.jump(target.height)
      textOpacity.jump(collapsed ? 0 : 1)
      if (instant) { opacity.jump(target.opacity); return }
      return nextFrame(() => { animate(opacity, target.opacity, target.opacity ? SPRINGS.fast : EXIT.fast) })
    }
    return nextFrame(() => {
      animate(y, target.y, SPRINGS.moderate)
      animate(scale, target.scale, SPRINGS.moderate)
      animate(height as MotionValue<number>, target.height, SPRINGS.moderate)
      animate(textOpacity, collapsed ? 0 : 1, SPRINGS.moderate)
      animate(opacity, target.opacity, target.opacity ? SPRINGS.fast : EXIT.fast)
    })
  }, [isPresent, natural, target.y, target.scale, target.height, target.opacity, collapsed, reduce]) // eslint-disable-line react-hooks/exhaustive-deps

  // 离开：焦点在这一条里时先交出去、再变 inert，然后下沉一个身位并淡出（滑走的那条已经在飞，等它淡完）
  React.useLayoutEffect(() => {
    if (isPresent) return
    const node = item.current
    if (node?.contains(node.ownerDocument.activeElement)) onHandOff(node)
    if (node) node.inert = true
    if (!autoClosed.current) t.onDismiss?.(t)
    // 键盘收起的（Esc、回车按撤销）：0ms。等本轮提交结束再移除：AnimatePresence 自己的 layout effect 在子项之后才登记退场，同步调用会被忽略
    if (!flying.current && !autoClosed.current && fromKeyboard()) return void queueMicrotask(() => safeToRemove?.())
    // 兜底：动画回调靠 rAF，后台标签页里等不到；到时一定交还移除
    const fallback = window.setTimeout(() => safeToRemove?.(), exitFallbackMs(EXIT.moderate))
    if (flying.current) {
      void flying.current.then(() => (window.clearTimeout(fallback), safeToRemove?.()))
      return () => window.clearTimeout(fallback)
    }
    const cancel = nextFrame(() => {
      const fade = animate(opacity, 0, EXIT.moderate)
      if (!reduce) animate(y, y.get() + natural, EXIT.moderate)
      fade.then(() => (window.clearTimeout(fallback), safeToRemove?.()))
    })
    return () => (window.clearTimeout(fallback), cancel())
  }, [isPresent]) // eslint-disable-line react-hooks/exhaustive-deps

  // 停留计时：悬停、按住、焦点在里面、页面在后台时暂停，剩余时间接着算；等待中的不计时
  const remaining = React.useRef(duration)
  React.useEffect(() => void (remaining.current = duration), [duration, t.type])
  React.useEffect(() => {
    if (t.type === "loading" || duration === Infinity || paused || !isPresent) return
    const start = Date.now()
    const timer = window.setTimeout(() => {
      autoClosed.current = true
      t.onAutoClose?.(t)
      sonner.dismiss(t.id)
    }, remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current -= Date.now() - start
    }
  }, [paused, duration, t, isPresent])

  const swipe = useSwipe({ toast: t, swipeX, swipeY, opacity, natural, reduce, onFly: (fade) => (flying.current = fade) })

  const type = t.type ?? "default"
  const title = typeof t.title === "function" ? t.title() : t.title
  const description = typeof t.description === "function" ? t.description() : t.description
  const icon = t.icon ?? icons?.[type as keyof NonNullable<typeof icons>] ?? ICONS[type]
  // 换了类型、标题或说明才算换文案（文字之外的节点只按类型比）
  const copyKey = [type, title, description].map((x) => (typeof x === "string" || typeof x === "number" ? x : "")).join("|")
  const button = (a: Action | React.ReactNode) =>
    !isAction(a) ? a : (
      <button
        type="button"
        data-slot="toast-action"
        style={a.actionButtonStyle}
        className="-mr-3 ml-auto h-(--ds-h-sm) shrink-0 rounded-control px-2 text-sm font-medium text-fg outline-none transition-colors duration-(--ds-dur-fast) ease-ds first-of-type:ml-auto hover:bg-hover focus-visible:focus-ring [&+&]:ml-0"
        onClick={(e) => (a.onClick(e), !e.defaultPrevented && sonner.dismiss(t.id))}
      >
        {a.label}
      </button>
    )

  return (
    <Elevated asChild {...ELEVATION.popover}>
    <motion.li
      ref={item}
      data-slot="toast"
      data-type={type}
      data-front={index === 0}
      data-paused={paused}
      // 不会到时消失的（Infinity）没有进度线：一条不动的满线只像多出来的底边
      data-persistent={duration === Infinity || undefined}
      data-swiping={swipe.active}
      tabIndex={0}
      aria-hidden={!visible || undefined}
      inert={!visible}
      className={cn(
        "absolute inset-x-0 bottom-0 origin-top touch-none overflow-hidden rounded-popover text-sm text-fg outline-none select-none",
        "focus-visible:focus-ring",
        !visible && "pointer-events-none",
        // 进度线：底边 1px（键盘聚焦这一条时藏起：计时已停，线会压在内侧焦点环的下沿上），落在左右 16 的内容线之间，停留时长内匀速从右往左收短；暂停时一起停
        "before:absolute before:inset-x-4 before:bottom-0 before:h-px before:origin-left before:bg-line-strong",
        "before:animate-[ds-toast-progress_var(--ds-toast-duration)_linear_forwards] data-[paused=true]:before:[animation-play-state:paused]",
        "data-[type=loading]:before:hidden data-persistent:before:hidden focus-visible:before:hidden data-[swiping=true]:before:hidden motion-reduce:before:hidden",
        t.className
      )}
      style={{ contain: "layout", ...t.style, y: shownY, x: swipeX, scale, opacity, height, zIndex: count - index, ["--ds-toast-duration" as string]: `${duration}ms` }}
      {...swipe.handlers}
      onClick={(e) => {
        // 触屏点卡片空白处：整叠展开 / 收起；刚拖过、点在按钮上不算
        if (swipe.consumeClick() || swipe.pointer() === "mouse" || (e.target as Element).closest("button, a")) return
        onTap()
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.nativeEvent.isComposing) return
        e.stopPropagation()
        sonner.dismiss(t.id)
      }}
    >
      <motion.div
        ref={content}
        className={cn("relative", !t.jsx && "flex min-h-(--ds-h-md) items-center gap-2 px-4 py-2")}
        style={{ opacity: textOpacity }}
      >
        {t.jsx ?? (
          <>
            <AnimatePresence mode="popLayout" initial={false}>
              <Copy key={copyKey} reduce={reduce}>
                {icon ? <span aria-hidden className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">{icon}</span> : null}
                <div className="grid min-w-0">
                  <div data-slot="toast-title">
                    {TYPE_LABEL[type] ? <span className="sr-only">{TYPE_LABEL[type]}</span> : null}
                    {title}
                  </div>
                  {description ? <div className="text-fg-muted">{description}</div> : null}
                </div>
              </Copy>
            </AnimatePresence>
            {t.cancel ? button(t.cancel) : null}
            {t.action ? button(t.action) : null}
          </>
        )}
      </motion.div>
    </motion.li>
    </Elevated>
  )
}

/**
 * 换文案的两段（DESIGN.md §4.2「图标互换」同一套）：出现走 fast 的全长（0.08s，easeOut），消失走 EXIT.fast（0.06s，easeIn），出现总比消失长。
 * 都是短过渡不是弹簧：临界阻尼的弹簧提前落定，会把这个先后颠倒；blur 是 filter 字串，弹簧推不动。
 */
const APPEAR = { type: "tween", duration: 0.08, ease: "easeOut" } as const
const VANISH = { ...EXIT.fast, ease: "easeIn" } as const

/** 一份文案（图标 + 标题 + 说明）：换文案时新旧在 blur 4px 里交叉；淡出的旧文案 aria-hidden，读屏只念新的 */
function Copy({ reduce, children, ref }: { reduce: boolean | null; children: React.ReactNode; ref?: React.Ref<HTMLDivElement> }) {
  const present = useIsPresent()
  const blur = reduce ? "blur(0px)" : "blur(4px)"
  // ref 交给 motion 元素：popLayout 靠它量出旧文案、让它脱离文档流，新旧不会上下叠着把提示撑高
  return (
    <motion.div
      ref={ref}
      aria-hidden={present ? undefined : true}
      className="flex min-w-0 flex-1 items-center gap-2"
      initial={{ willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 0, filter: blur }}
      animate={{ willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 1, filter: "blur(0px)" }}
      exit={{ willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 0, filter: blur, transition: VANISH }}
      transition={APPEAR}
    >
      {children}
    </motion.div>
  )
}

/**
 * 滑走：横向随意、向下 1:1 跟手；向上按橡皮筋。松手够远或够快就带着速度飞出去，否则带着速度弹回。
 * 按在按钮上不算拖；选中了文字不拖；等待中的、不可关闭的提示不能拖。拖过之后的那次 click 不算点按（consumeClick）。
 */

const ICONS: Record<string, React.ReactNode> = {
  loading: <Spinner />,
  success: <CircleCheck className="text-success" />,
  info: <Info className="text-fg-muted" />,
  warning: <TriangleAlert className="text-warning" />,
  error: <CircleAlert className="text-danger" />,
}

const isAction = (a: unknown): a is Action => typeof a === "object" && a !== null && "label" in a && "onClick" in a

const onVisibility = (on: () => void) => (document.addEventListener("visibilitychange", on), () => document.removeEventListener("visibilitychange", on))
const useDocumentHidden = () => React.useSyncExternalStore(onVisibility, () => document.hidden, () => false)

export { Toaster }
