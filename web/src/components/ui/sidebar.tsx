import * as React from "react"
import { PanelLeft, PanelRight } from "lucide-react"
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue, type Transition } from "motion/react"

import { cn } from "@/lib/utils"
import { EXIT, FROM_FIRST_FRAME, SPRINGS } from "@/components/ui/ease"
import { nextFrame } from "@/components/ui/frame"
import { isComposing, isEditable } from "@/components/ui/hotkeys"
import { useGeometryInvariant } from "@/components/ui/invariant"
import { SidebarDrawer } from "@/components/ui/sidebar-drawer"
import { SIDEBAR_MAX, SidebarRail } from "@/components/ui/sidebar-rail"

import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"

/**
 * 侧栏（DESIGN.md K3、K4、§3.9）：宽 256（工具栏 400），左右内边距 8，组间 12。
 * - 折叠钮永远在第一栏的右上角（用户 2026-10-08：「永远都在第一栏的右上角」），由侧栏自己画，使用方放不错：
 *   展开时指向侧栏或键盘聚焦才淡入（L2），收起后侧栏留一条 56 宽的窄栏，折叠钮常驻在窄栏顶部。
 *   正文里的 SidebarTrigger 只在窄屏出现，用来打开抽屉。
 * - 不做悬停浮出（用户 2026-10-08：「我鼠标移动到侧边栏为什么会自动弹出，这是什么垃圾」）：收起就是收起，只有点折叠钮或按 [ 才展开。
 * - 展开时右边线外侧有把手（ui/sidebar-rail）：拖动调宽 160–360，往外拖过最小宽 56 预演收起，拖回取消，松手才算数；不动直接点 = 收起。
 * - 快捷键 [（不带修饰键，⌘[ 留给浏览器后退；在输入框里打字、输入法组字时不触发）。页面上有几个侧栏时，焦点在哪个侧栏里就由它响应，
 *   焦点不在任何侧栏里时由最外层的响应。
 * - 桌面的开合记进 cookie sidebar_state（7 天，persist）；服务端渲染的布局可以读它当 defaultOpen。窄屏抽屉不记。
 * - 窄于断点（视口 768；嵌在页面一块里的外框 responsive="container" 按外框自己的宽度，默认 640）换成从左边滑出的抽屉。
 * 动效（档位见 ui/ease）：
 * - 开合：占位列宽度、面板平移、内容淡出同一个进度，进场 slow（0.24s · 回弹 0.12），收起 EXIT.slow（0.16s）。可打断。
 *   折叠钮钉在面板右上角，跟着右边线滑到窄栏里，来去同路。
 * - 拖动调宽：1:1 跟手（时长 0）；拖动途中预演收起 / 拖回展开走 moderate（收起 EXIT.moderate）。
 * - 窄屏抽屉：滑进 moderate、滑出 EXIT.moderate；遮罩随 PopupScrim。
 * - 减少动态：直接到位；抽屉不位移，只淡入（fast）淡出（EXIT.fast）。键盘与指针同一套档位。
 * 有通栏顶栏时在 SidebarProvider 上设 --ds-sidebar-top（顶栏高度）：面板从它往下排；抽屉是模态的，盖住顶栏。
 */
type SidebarContextValue = {
  open: boolean; setOpen: (open: boolean) => void; desktop: boolean
  mobileOpen: boolean; setMobileOpen: (open: boolean) => void
  /** 侧栏里有没有 SidebarHeader：没有时内容区顶上让出一行给折叠钮 */
  hasHeader: boolean; setHasHeader: (has: boolean) => void
  /** instant：跳过动画（程序恢复状态时） */
  toggle: (opts?: { instant?: boolean }) => void
  /** 是否逐帧改变正文宽度；大型画布关闭后宽度一次到位，侧栏仍平滑位移 */
  animateLayout: boolean
  /** 这一次开合要不要跳过动画；由 toggle 写入，这一次提交之后清掉 */
  instant: React.RefObject<boolean>
  resizing: boolean; setResizing: (resizing: boolean) => void
  /** 拖出来的宽度（px）；没拖过是 null，用 width 档 */
  dragWidth: number | null; setDragWidth: (px: number) => void; maxWidth: number
  /** 快捷键；关掉时 null */
  shortcut: string | null
  /** responsive="container" 时抽屉挂在外框里，从外框左边滑出 */
  frame: React.RefObject<HTMLDivElement | null> | null
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

function useSidebar() {
  const ctx = React.useContext(SidebarContext)
  if (!ctx) throw new Error("useSidebar 必须在 <SidebarProvider> 里使用")
  return ctx
}

/** 侧栏宽度：256 放导航（默认）；400 给工具栏（侧栏里放导入、参数这类表单卡片）。拖动可在 160 与 max(360, 它) 之间调 */
type SidebarWidth = 256 | 400
const SIDEBAR_WIDTH: Record<SidebarWidth, string | undefined> = { 256: undefined, 400: "[--ds-sidebar-w:calc(var(--spacing)*100)]" }

const SIDEBAR_COOKIE = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SHORTCUT = "["

/** 从 cookie 字符串读上次的开合（服务端布局把请求头的 cookie 传进来，客户端不传读 document.cookie）；没记过返回 undefined */
function readSidebarCookie(cookie = typeof document === "undefined" ? "" : document.cookie): boolean | undefined {
  const value = cookie.match(/(?:^|;\s*)sidebar_state=(true|false)/)?.[1]
  return value === undefined ? undefined : value === "true"
}

function useWide(node: React.RefObject<HTMLDivElement | null>, breakpoint: number, container: boolean) {
  const query = `(min-width: ${breakpoint}px)`
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const mq = matchMedia(query)
      mq.addEventListener("change", onChange)
      return () => mq.removeEventListener("change", onChange)
    },
    [query]
  )
  const viewport = React.useSyncExternalStore(subscribe, () => matchMedia(query).matches, () => true)
  // 外框：第一次量到之前按宽屏，免得先闪一下抽屉按钮
  const [wide, setWide] = React.useState(true)
  React.useLayoutEffect(() => {
    const el = node.current
    if (!container || !el) return
    const ro = new ResizeObserver(([entry]) => setWide((entry.borderBoxSize?.[0]?.inlineSize ?? el.offsetWidth) >= breakpoint))
    ro.observe(el)
    return () => ro.disconnect()
  }, [node, breakpoint, container])
  return container ? wide : viewport
}

/** 挂着的侧栏（快捷键只让一个响应）：焦点在哪个里面就是最里层那个；焦点不在任何一个里面就是最外层那个 */
const mounted: HTMLElement[] = []
function answers(root: HTMLElement, target: Node) {
  const inside = mounted.filter((el) => el.contains(target))
  if (inside.length) return inside.find((el) => !inside.some((other) => other !== el && el.contains(other))) === root
  return mounted.find((el) => !mounted.some((other) => other !== el && other.contains(el))) === root
}

function SidebarProvider({
  width = 256,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  shortcut = true,
  animateLayout = true,
  persist,
  responsive = "viewport",
  breakpoint,
  className,
  style,
  children,
}: {
  /** 展开时的宽度档：256 / 400；拖动调宽后以拖出来的为准 */
  width?: SidebarWidth
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** 是否响应快捷键 [ */
  shortcut?: boolean
  /** 是否动画正文宽度。大型画布设 false，避免每帧 ResizeObserver 触发重投影与重绘；侧栏位移动效保留 */
  animateLayout?: boolean
  /** 桌面开合记进 cookie（7 天）。默认：整个应用（viewport）记，嵌在页面里的外框（container）不记 */
  persist?: boolean
  /** 宽窄按什么判断：viewport 视口；container 外框自己的宽度（嵌在页面一块里的外框） */
  responsive?: "viewport" | "container"
  /** 窄于它换成抽屉：默认视口 768、外框 640 */
  breakpoint?: number
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  const container = responsive === "container"
  const remember = persist ?? !container
  const [uncontrolled, setUncontrolled] = React.useState(() => (remember ? (readSidebarCookie() ?? defaultOpen) : defaultOpen))
  const open = openProp ?? uncontrolled
  const latest = React.useRef(open)
  latest.current = open
  const wrapper = React.useRef<HTMLDivElement>(null)
  const desktop = useWide(wrapper, breakpoint ?? (container ? 640 : 768), container)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  // 宽窄切换：抽屉收起，再变窄时不会自己弹出来
  React.useEffect(() => setMobileOpen(false), [desktop])
  const instant = React.useRef(false)
  // 子组件的 layout effect 先于这里执行：它们读完这一次的 instant，再清掉
  React.useLayoutEffect(() => {
    instant.current = false
  })
  const [resizing, setResizing] = React.useState(false)
  const [dragWidth, setDragWidth] = React.useState<number | null>(null)

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (next === latest.current) return
      if (openProp === undefined) setUncontrolled(next)
      onOpenChange?.(next)
      if (remember) document.cookie = `${SIDEBAR_COOKIE}=${next}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`
    },
    [openProp, onOpenChange, remember]
  )

  const [hasHeader, setHasHeader] = React.useState(false)

  const toggle = React.useCallback(
    (opts: { instant?: boolean } = {}) => {
      instant.current = Boolean(opts.instant)
      if (!desktop) return setMobileOpen((v) => !v)
      setOpen(!latest.current)
    },
    [desktop, setOpen]
  )

  const latestToggle = React.useRef(toggle)
  latestToggle.current = toggle
  // 快捷键 [：不带修饰键（⌘[ 是浏览器后退），输入时不触发；一个按键只让一个侧栏响应（关掉快捷键的不参与）
  React.useEffect(() => {
    const root = wrapper.current
    const view = root?.ownerDocument.defaultView
    if (!shortcut || !root || !view) return
    mounted.push(root)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== SHORTCUT || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
      if (isComposing(event) || isEditable(event.target) || !answers(root, event.target as Node)) return
      event.preventDefault()
      latestToggle.current()
    }
    view.addEventListener("keydown", onKeyDown)
    return () => {
      view.removeEventListener("keydown", onKeyDown)
      mounted.splice(mounted.indexOf(root), 1)
    }
  }, [shortcut])

  const maxWidth = Math.max(SIDEBAR_MAX, width)
  const value: SidebarContextValue = {
    open, setOpen, desktop, mobileOpen, setMobileOpen,
    hasHeader, setHasHeader,
    toggle, animateLayout, instant, resizing, setResizing, dragWidth, setDragWidth, maxWidth,
    shortcut: shortcut ? SHORTCUT : null,
    frame: container ? wrapper : null,
  }
  return (
    <SidebarContext.Provider value={value}>
      {/* 每个 Provider 先把 --ds-sidebar-top 归零：嵌在别的页面里时不继承外层顶栏的高度；要偏移时由 className 覆盖 */}
      <div
        ref={wrapper}
        data-slot="sidebar-wrapper"
        data-responsive={responsive}
        className={cn("flex min-h-svh w-full bg-canvas text-fg [--ds-sidebar-top:0px] [--ds-sidebar-rail:56px]", container && "relative", SIDEBAR_WIDTH[width], className)}
        style={dragWidth === null ? style : ({ ...style, "--ds-sidebar-w": `${dragWidth}px` } as React.CSSProperties)}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

const panelClass = "group/sidebar flex w-(--ds-sidebar-w) flex-col text-fg"

/** 侧栏不许横向滚：edge-end 的负外边距伸出内边距时，横滑、scrollIntoView 会让整列左移 */
function noSideScroll(el: HTMLElement) {
  return el.scrollWidth > el.clientWidth + 0.5
    ? `侧栏能横向滚 ${el.scrollWidth - el.clientWidth}px：有元素伸出了右内边距（多半是 edge-end 的负外边距大于头、脚的右内边距）`
    : null
}

/**
 * 外框分区（DESIGN.md §3.9）：整个应用的侧栏是一个区，指针在它上面只滚它，到头、内容不够长也不传给页面。
 * 嵌在页面一块里的外框（responsive="container"）属于正文，照 §5 滚到头交给页面，所以不加。
 */
function PanelScroll({ opacity, inert, children }: { opacity: MotionValue<number>; inert: boolean; children: React.ReactNode }) {
  const { frame, hasHeader } = useSidebar()
  const node = React.useRef<HTMLDivElement>(null)
  useGeometryInvariant("Sidebar", node, noSideScroll)
  return (
    <motion.div
      ref={node}
      data-slot="sidebar-scroll"
      inert={inert}
      style={{ opacity }}
      className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", !frame && "overscroll-y-contain", !hasHeader && "pt-(--ds-header-h)")}
    >
      {children}
    </motion.div>
  )
}

/** 进度 p（0–1）推到 to：transition 由调用方按起因选；null = 直接到位。onRest 只在自然停稳时调用 */
function drive(p: MotionValue<number>, to: number, transition: Transition | null, onRest?: () => void) {
  p.stop()
  if (!transition) {
    p.set(to)
    onRest?.()
    return
  }
  // 进度是 0–1 的小数，停稳阈值按 256px 宽换算到 0.1px 以内，免得最后一帧跳一下
  return nextFrame(() => {
    animate(p, to, { ...transition, ...FROM_FIRST_FRAME, restDelta: 0.0004, restSpeed: 0.004, onComplete: onRest })
  })
}

function Sidebar({ className, label = "侧栏", rail = true, children }: {
  className?: string
  label?: string
  /** 右边线外侧的把手：拖动调宽、点一下收起。false 时只能用触发器和快捷键开合 */
  rail?: boolean
  children: React.ReactNode
}) {
  const { desktop, mobileOpen, setMobileOpen, frame, instant } = useSidebar()
  if (!desktop) return <SidebarDrawer label={label} open={mobileOpen} onOpenChange={setMobileOpen} frame={frame} instant={instant} className={panelClass}>{children}</SidebarDrawer>
  return <DesktopSidebar className={className} label={label} rail={rail}>{children}</DesktopSidebar>
}

function DesktopSidebar({ className, label, rail, children }: { className?: string; label: string; rail: boolean; children: React.ReactNode }) {
  const s = useSidebar()
  const { open, resizing, frame, instant, animateLayout } = s
  const reduce = useReducedMotion()
  const aside = React.useRef<HTMLElement>(null)
  // 一个进度 p：占位列从窄栏 56 到整宽、面板从「只露右边 56」到全露、内容从透明到不透明，同一个数推着走
  const p = useMotionValue(open ? 1 : 0)
  const columnWidth = useTransform(p, (v) => `calc(var(--ds-sidebar-rail) + (var(--ds-sidebar-w) - var(--ds-sidebar-rail)) * ${v})`)
  const transform = useTransform(p, (v) => `translateX(calc((var(--ds-sidebar-rail) - var(--ds-sidebar-w)) * ${1 - v}))`)
  const contentOpacity = useTransform(p, [0, 0.5, 1], [0, 0.4, 1])

  const first = React.useRef(true)
  const prev = React.useRef(open)
  React.useLayoutEffect(() => {
    const was = prev.current
    prev.current = open
    if (first.current) {
      first.current = false
      return
    }
    if (was === open) return
    const snap = reduce || instant.current
    // 开合：slow / EXIT.slow；拖动途中的预演收起 / 拖回：moderate / EXIT.moderate
    const motion: Transition | null = snap ? null : resizing ? (open ? SPRINGS.moderate : EXIT.moderate) : open ? SPRINGS.slow : EXIT.slow
    return drive(p, open ? 1 : 0, motion)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <>
      <motion.div
        aria-hidden
        data-slot="sidebar-column"
        style={{ contain: "layout", width: animateLayout ? columnWidth : open ? "var(--ds-sidebar-w)" : "var(--ds-sidebar-rail)" }}
        className="shrink-0"
      />
      <motion.aside
        ref={aside}
        aria-label={label}
        data-slot="sidebar"
        data-state={open ? "expanded" : "collapsed"}
        style={{ transform }}
        className={cn(panelClass, frame ? "absolute z-40" : "fixed z-40", "top-(--ds-sidebar-top) bottom-0 left-0 bg-sidebar", className)}
      >
        {/* 拖动途中预演收起时内容还握着指针，不能 inert */}
        <PanelScroll opacity={contentOpacity} inert={!open && !resizing}>{children}</PanelScroll>
        <PanelToggle />
        {/* 拖动途中预演收起时把手还握着指针：收起了也留着，松手才卸 */}
        {rail && (open || resizing) ? (
          <SidebarRail
            max={s.maxWidth}
            shortcut={s.shortcut}
            panel={aside}
            onWidth={s.setDragWidth}
            onCollapse={(collapsed) => s.setOpen(!collapsed)}
            onToggle={() => s.toggle()}
            onResizing={s.setResizing}
          />
        ) : null}
      </motion.aside>
    </>
  )
}

/**
 * 侧栏自己的折叠钮：钉在面板右上角，盒子宽 = 窄栏宽（56），按钮在里面居中，所以收起后正好落在窄栏正中、展开时离右边线 10。
 * 展开时是附属工具（L2）：指向侧栏、键盘聚焦时 80ms 淡入，离开 60ms 淡出；收起后它是窄栏里唯一的东西，常驻。触屏常驻。
 */
function PanelToggle() {
  const { open, toggle, shortcut } = useSidebar()
  const name = open ? "收起侧栏" : "展开侧栏"
  return (
    <div
      data-slot="sidebar-toggle"
      className={cn(
        "absolute top-0 right-0 flex h-(--ds-header-h) w-(--ds-sidebar-rail) items-center justify-center",
        open && "opacity-0 transition-opacity duration-(--ds-dur-fast-exit) ease-ds group-hover/sidebar:opacity-100 group-hover/sidebar:duration-(--ds-dur-fast) focus-within:opacity-100 focus-within:duration-(--ds-dur-fast) [@media(hover:none)]:opacity-100"
      )}
    >
      <Tooltip content={shortcut ? <>{name}<kbd className="font-sans">{shortcut}</kbd></> : name}>
        <Button variant="ghost" size="icon" aria-label={name} aria-expanded={open} aria-keyshortcuts={shortcut ?? undefined} onClick={() => toggle()}>
          {open ? <PanelLeft /> : <PanelRight />}
        </Button>
      </Tooltip>
    </div>
  )
}

/**
 * 头、内容、脚三段共用一列的起止线（DESIGN.md §3.2）：行盒子在 8–(宽 − 16)，墨迹在 16–(宽 − 24)。
 * 内容区右边是滚动安全区 16（scroll-safe）；头里直接放墨迹（站名），左 16，桌面右边让出折叠钮那一格（56）；脚里放行，所以左 8、右 16。
 */
function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  const { desktop, setHasHeader } = useSidebar()
  React.useLayoutEffect(() => {
    setHasHeader(true)
    return () => setHasHeader(false)
  }, [setHasHeader])
  // 桌面：右上角是折叠钮的格（窄栏宽 56），头里的字、图标钮停在它左边
  return <div data-slot="sidebar-header" className={cn("flex h-(--ds-header-h) shrink-0 items-center gap-2 ps-4", desktop ? "pe-(--ds-sidebar-rail)" : "pe-6", className)} {...props} />
}

/** 滚动区：组间 12 留白 */
function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-content" className={cn("scroll-safe grid min-h-0 flex-1 content-start gap-3 overflow-y-auto pl-2 pt-2 pb-6", className)} {...props} />
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-footer" className={cn("grid shrink-0 gap-px ps-2 pe-4 pb-2", className)} {...props} />
}

/** 正文区：侧栏右侧的一切 */
function SidebarInset({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-inset" className={cn("flex min-w-0 flex-1 flex-col", className)} {...props} />
}

/**
 * 打开抽屉的图标按钮：只在窄屏出现，放在正文顶栏的起始端；桌面上折叠钮由侧栏自己画在第一栏右上角（PanelToggle），这里不渲染。
 */
function SidebarTrigger({ className, ...props }: React.ComponentProps<typeof Button>) {
  const { desktop, mobileOpen, toggle } = useSidebar()
  if (desktop) return null
  const name = mobileOpen ? "收起侧栏" : "展开侧栏"
  return (
    <Tooltip content={name}>
      <Button variant="ghost" size="icon" aria-label={name} aria-expanded={mobileOpen} data-slot="sidebar-trigger" onClick={() => toggle()} className={className} {...props}>
        {mobileOpen ? <PanelLeft /> : <PanelRight />}
      </Button>
    </Tooltip>
  )
}

export {
  readSidebarCookie,
  Sidebar,
  SidebarContent,
  SidebarContext,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
}
export type { SidebarWidth }
