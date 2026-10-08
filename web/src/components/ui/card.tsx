"use client"

import { nextFrame } from "@/components/ui/frame"

import * as React from "react"
import { animate, motion, useMotionValue, useReducedMotion, type HTMLMotionProps } from "motion/react"

import { cn } from "@/lib/utils"
import { transparentInset, useGeometryInvariant } from "@/components/ui/invariant"
import { EASE_OUT, SPRINGS } from "@/components/ui/ease"
import { FluidHoverHighlight, useFluidHover, type FluidHover } from "@/components/ui/fluid-hover"
import { fromKeyboard } from "@/components/ui/hotkeys"

/**
 * 卡片：只用于正在处理的内容（编辑中的设置、唯一的摘要），一个视图最多一两张，不嵌套。默认透明、无框（页级），弹层内白面柔影（DESIGN.md §2.3、§4.3）。
 * 间距由卡片自己的宽度算（和 ui/surface 同一套）：内边距 inset = 8 + 宽 ÷ 24，头 / 内容 / 底之间 gap-group，标题和描述之间 gap-part。
 * K5：页级透明时内边距为 0，沿宿主列线；弹层内的实色面、能点的卡、CardGroup 里的卡按自身宽度留内边距（悬停底不贴字）。
 * 正文用 text-fg（两行以上的段落不整段灰），只有 CardDescription 是次级墨。
 * 所在的面：浮层里提成白面时声明 --ds-surface = 卡片底色（ds-theme.css），里面的吸顶分组名、头像外圈直接读它；页级透明时沿用外面的面。
 * 卡里的图片（照片、截图）画 1px 内描边：浅色纯黑 10%、深色纯白 10%，不改盒子尺寸；svg 标志不描（DESIGN.md §4.5）。
 *
 * 能点的卡（传 href 或 onClick）：
 * - 整张卡是一个点击目标：一层盖满的链接 / 按钮（z-20，焦点环沿卡片圆角内收 2px）；CardAction、CardFooter 浮在它上面（z-30），各自能点，不嵌套交互元素。
 *   label 给这层一个名字（读屏念它）；disabled 时拿掉这一层（键盘也到不了），整卡 40% 透明。
 * - selected：选中底（bg-selected）铺满卡片，标题 500 → 600（隐形 600 副本占宽，80ms）；悬停只靠底，不变粗。
 * - 单独一张：自己的悬停底 bg-hover（80ms）。放进 CardGroup：整组只有一块跟随悬停底（ui/fluid-hover），信息卡（不能点）不登记——亮了也点不到。
 * CardGroup：一组卡（columns 列，默认 1），卡与卡之间 1px 细线（divided，默认开）；亮着或选中的卡旁边的线隐藏（80ms），底读起来是干净的一块。
 *   横竖两条线相交处竖线短 1px，交点只画一次。多列时跟随悬停按直线距离找最近的卡（axis xy）；点在卡之间的空隙里只在离亮着的卡 16px 内才转成点它。
 *
 * 动效（DESIGN.md §4.2）：
 * - 悬停底 fast（0.08s）跟随、淡出 0.06s；线、字重 80ms。
 * - 传 layoutId 时成为「展开源」：指针点击让同一个 layoutId 的两张卡片互换（摘要 ↔ 明细），或这张卡片里多出、少了一块 → 外框的位置、尺寸、圆角走 moderate
 *   （0.16s、不过冲，可中途反悔），里面的字反向校正不拉伸 → 减少动态时外框直接到位。
 * - 新出现的部分 → 晚 80ms 淡入 80ms（和外框同时落定），带 blur 4px → 0，留下来的部分不动 → 减少动态时只淡入、不模糊。
 * - 键盘触发（Enter / 空格按下的按钮）→ 0ms，外框和内容直接到位。
 */
const BODY = "flex flex-col gap-group py-[calc(var(--ds-inset)*var(--ds-panel-padding))]"
/** 照片、截图的 1px 内描边（svg 标志不描） */
const IMAGE_EDGE = "[&_img:not([src$=svg])]:outline-1 [&_img:not([src$=svg])]:-outline-offset-1 [&_img:not([src$=svg])]:outline-[color-mix(in_srgb,var(--base-tint)_10%,transparent)]"

type GroupState = { hover: FluidHover; columns: number; count: number; selected: number; divided: boolean }
const GroupContext = React.createContext<GroupState | null>(null)
const IndexContext = React.createContext<number>(-1)
/** 卡片里的各部分要知道：这张卡能不能点、选没选中（标题按它变粗） */
const CardState = React.createContext<{ interactive: boolean; selected: boolean; padded: boolean }>({ interactive: false, selected: false, padded: false })
/** 有悬停底或在一组里的卡按自身宽度留内边距（底不贴字），不受「透明面不留内边距」约束 */
const noCheck = () => null

/** 一组卡：columns 列的网格，整组一块跟随悬停底，卡与卡之间细线 */
function CardGroup({
  columns = 1,
  divided = true,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & { columns?: number; divided?: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const hover = useFluidHover(ref, { axis: columns > 1 ? "xy" : "y", gapClick: { maxDistance: 16 } })
  const items = React.Children.toArray(children).filter(React.isValidElement)
  const selected = items.findIndex((child) => (child.props as { selected?: boolean }).selected)
  const state = React.useMemo(() => ({ hover, columns, count: items.length, selected, divided }), [hover, columns, items.length, selected, divided])
  return (
    <GroupContext.Provider value={state}>
      <div
        ref={ref}
        data-slot="card-group"
        className={cn("relative isolate grid [--ds-panel-padding:1]", className)}
        style={{ gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))`, ...style }}
        {...hover.handlers}
        {...props}
      >
        <FluidHoverHighlight hover={hover} className="rounded-card" />
        {items.map((child, i) => (
          <IndexContext.Provider key={child.key ?? i} value={i}>
            {child}
          </IndexContext.Provider>
        ))}
      </div>
    </GroupContext.Provider>
  )
}

type CardProps = Omit<React.ComponentProps<"div">, "onClick"> & {
  layoutId?: string
  /** 整张卡是一个链接 */
  href?: string
  /** 整张卡是一个按钮 */
  onClick?: () => void
  /** 盖满卡片的那层链接 / 按钮的名字（读屏） */
  label?: string
  selected?: boolean
  disabled?: boolean
}

function Card({ className, layoutId, children, href, onClick, label, selected, disabled = false, ref, ...props }: CardProps) {
  const group = React.useContext(GroupContext)
  const index = React.useContext(IndexContext)
  const interactive = Boolean(href || onClick)
  const on = Boolean(selected)
  const classes = cn(
    "rounded-card bg-panel text-fg shadow-panel",
    IMAGE_EDGE,
    (interactive || group) && "relative isolate [--ds-panel-padding:1]",
    group && "bg-transparent shadow-none",
    interactive && !group && !disabled && "transition-colors duration-(--ds-dur-fast) ease-ds hover:bg-hover",
    disabled && "opacity-40",
    className
  )
  // 只有能点的卡登记跟随悬停；回调要稳定（itemRef 按序号缓存），否则每次渲染都重量一轮
  const itemRef = group && interactive && !disabled && index >= 0 ? group.hover.itemRef(index) : undefined
  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      itemRef?.(el)
      if (typeof ref === "function") ref(el)
      else if (ref) ref.current = el
    },
    [itemRef, ref]
  )
  const state = React.useMemo(() => ({ interactive, selected: on, padded: interactive || Boolean(group) }), [interactive, on, group])
  const extras = (
    <>
      {on ? <span aria-hidden data-slot="card-selected" className="pointer-events-none absolute inset-0 -z-10 rounded-inherit bg-selected" /> : null}
      {group ? <Dividers group={group} index={index} /> : null}
      {interactive && !disabled ? (
        href ? (
          <a href={href} onClick={onClick} aria-label={label} data-slot="card-link" className="absolute inset-0 z-20 rounded-inherit outline-none focus-visible:focus-ring" />
        ) : (
          <button type="button" onClick={onClick} aria-label={label} aria-pressed={selected} data-slot="card-link" className="absolute inset-0 z-20 rounded-inherit outline-none focus-visible:focus-ring" />
        )
      ) : null}
    </>
  )
  const attrs = { "data-selected": on || undefined, "aria-disabled": disabled || undefined, "data-clickable": interactive || undefined }
  if (layoutId)
    return (
      <CardState value={state}>
        <MorphCard ref={setRef} layoutId={layoutId} className={classes} extras={extras} {...attrs} {...props}>
          {children}
        </MorphCard>
      </CardState>
    )
  return (
    <CardState value={state}>
      <div ref={setRef} data-slot="card" data-space data-surface className={classes} {...attrs} {...props}>
        {extras}
        <div data-slot="card-body" className={BODY}>
          {children}
        </div>
      </div>
    </CardState>
  )
}

/** 卡与卡之间的细线：画向下面和右边的邻居；挨着亮着或选中的卡时隐藏。两条线相交时竖线短 1px，交点只画一次 */
function Dividers({ group, index }: { group: GroupState; index: number }) {
  const { columns, count, selected, divided, hover } = group
  if (!divided || index < 0) return null
  const active = hover.activeIndex ?? -1
  const below = index + columns < count
  const right = index % columns < columns - 1 && index + 1 < count
  const touchesBelow = (i: number) => i === index || i === index + columns
  const touchesRight = (i: number) => i === index || i === index + 1
  const line = "pointer-events-none absolute -z-10 bg-line transition-opacity duration-(--ds-dur-fast) ease-ds"
  const showBottom = below && !touchesBelow(active) && !touchesBelow(selected)
  const showRight = right && !touchesRight(active) && !touchesRight(selected)
  return (
    <>
      {below ? <span aria-hidden data-slot="card-divider" className={cn(line, "inset-x-0 bottom-0 h-px", !showBottom && "opacity-0")} /> : null}
      {right ? <span aria-hidden data-slot="card-divider" className={cn(line, "top-0 right-0 w-px", below ? "bottom-px" : "bottom-0", !showRight && "opacity-0")} /> : null}
    </>
  )
}

const INSTANT = { duration: 0 } as const
/** 新出现的部分：等外框走到一半（moderate 0.16s 的一半）再淡入 fast 档的 0.08s，和外框同时落定 */
const REVEAL = { duration: 0.08, ease: EASE_OUT, delay: 0.08 } as const
/** 每个 layoutId 此刻挂着几张卡片：新卡片渲染时另一张还在，说明是互换，内容要淡入；首次出现不动。 */
const live = new Map<string, number>()
/** 变形卡片告诉里面的各部分：此刻新挂上来的部分要不要淡入 */
const MorphContext = React.createContext<React.RefObject<boolean> | null>(null)

function MorphCard({ layoutId, className, children, extras, ref, ...props }: React.ComponentProps<"div"> & { layoutId: string; extras?: React.ReactNode }) {
  const reduce = useReducedMotion()
  const still = fromKeyboard() || reduce
  const frame = React.useRef<HTMLDivElement>(null)
  const [swapped] = React.useState(() => (live.get(layoutId) ?? 0) > 0)
  // 首帧：互换来的卡片，里面各部分都淡入；首次出现的卡片不动。挂上之后，新出现的部分一律淡入。
  const reveal = React.useRef(swapped)
  // 圆角交给 motion 做缩放校正（变形途中圆角不被拉扁）：动画开始时读出 CSS 里的圆角，结束后交还给 CSS
  const radius = useMotionValue<number | string>("")

  React.useEffect(() => {
    reveal.current = true
    live.set(layoutId, (live.get(layoutId) ?? 0) + 1)
    return () => void live.set(layoutId, (live.get(layoutId) ?? 1) - 1)
  }, [layoutId])

  return (
    <motion.div
      ref={(el: HTMLDivElement | null) => {
        frame.current = el
        if (typeof ref === "function") ref(el)
        else if (ref) ref.current = el
      }}
      data-slot="card"
      data-space
      data-surface
      layoutId={layoutId}
      transition={still ? INSTANT : SPRINGS.moderate}
      onLayoutAnimationStart={() => frame.current && radius.set(parseFloat(getComputedStyle(frame.current).borderTopLeftRadius))}
      onLayoutAnimationComplete={() => radius.set("")}
      style={{ borderRadius: radius }}
      className={className}
      {...(props as HTMLMotionProps<"div">)}
    >
      {extras}
      {/* 内容一层单独参与 layout：外框缩放时它被反向校正，字不会被拉宽压扁 */}
      <motion.div layout="position" transition={still ? INSTANT : SPRINGS.moderate} data-slot="card-body" className={BODY}>
        <MorphContext.Provider value={reveal}>{children}</MorphContext.Provider>
      </motion.div>
    </motion.div>
  )
}

/** 卡片的一部分：在变形卡片里新出现时，晚 80ms 从 blur 4px 里淡入（80ms）。 */
function usePart() {
  const reveal = React.useContext(MorphContext)
  const { padded } = React.useContext(CardState)
  const reduce = useReducedMotion()
  const ref = React.useRef<HTMLDivElement>(null)
  useGeometryInvariant("Card", ref, padded ? noCheck : transparentInset)
  // 渲染时就定下来（开发模式下副作用会跑两遍，那时卡片已经挂上了）
  const [enter] = React.useState(() => Boolean(reveal?.current) && !fromKeyboard())
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el || !enter) return
    el.style.opacity = "0"
    el.style.willChange = "opacity, filter"
    return nextFrame(() => {
      const controls = animate(el, reduce ? { opacity: [0, 1] } : { opacity: [0, 1], filter: ["blur(4px)", "blur(0px)"] }, REVEAL)
      controls.then(() => { el.style.filter = ""; el.style.willChange = "" })
      return () => { controls.stop(); el.style.willChange = "" }
    })
    // 只在挂上时判断一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return ref
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  const ref = usePart()
  return (
    <div
      ref={ref}
      data-slot="card-header"
      className={cn(
        "grid auto-rows-min grid-rows-[auto_auto] items-start gap-part px-[calc(var(--ds-inset)*var(--ds-panel-padding))]",
        "has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-action]:gap-x-4",
        className
      )}
      {...props}
    />
  )
}

/** 标题：信息卡 600；能点的卡平时 500，选中 600，隐形的 600 副本占住宽度（变粗不挤动旁边、不改换行） */
function CardTitle({ className, children, ...props }: React.ComponentProps<"div">) {
  const { interactive, selected } = React.useContext(CardState)
  if (!interactive)
    return (
      <div data-slot="card-title" className={cn("text-lg font-semibold text-fg", className)} {...props}>
        {children}
      </div>
    )
  return (
    <div data-slot="card-title" className={cn("grid grid-cols-[minmax(0,1fr)] text-lg text-fg", className)} {...props}>
      <span aria-hidden className="invisible col-start-1 row-start-1 font-semibold">{children}</span>
      <span className={cn("col-start-1 row-start-1 transition-[font-weight] duration-(--ds-dur-fast) ease-ds", selected ? "font-semibold" : "font-medium")}>{children}</span>
    </div>
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-description" className={cn("text-sm text-fg-muted", className)} {...props} />
}

/**
 * 右上角的操作（DESIGN.md §3.3 行尾动作的竖向位置）：与标题、描述并排，纵跨两行。
 * 标题 + 描述共两行 → 中线对整个文字块中线；文字折到 ≥ 3 行 → 顶对标题行（高 28 与标题行同中线）。
 * 行数只在文字块尺寸变化时量一次（ResizeObserver），不订阅滚动或视口。
 */
function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [tall, setTall] = React.useState(false)
  React.useLayoutEffect(() => {
    const header = ref.current?.parentElement
    if (!header) return
    const text = [...header.children].filter((el): el is HTMLElement => el instanceof HTMLElement && /^card-(title|description)$/.test(el.dataset.slot ?? ""))
    const lines = (el: HTMLElement) => Math.round(el.offsetHeight / (parseFloat(getComputedStyle(el).lineHeight) || el.offsetHeight || 1))
    const check = () => setTall(text.reduce((n, el) => n + lines(el), 0) >= 3)
    check()
    const observer = new ResizeObserver(check)
    text.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      data-slot="card-action"
      data-align={tall ? "start" : "center"}
      className={cn("relative z-30 col-start-2 row-span-2 row-start-1 flex items-center justify-end justify-self-end", tall ? "h-7 self-start" : "self-center", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  const ref = usePart()
  return <div ref={ref} data-slot="card-content" className={cn("empty:hidden px-[calc(var(--ds-inset)*var(--ds-panel-padding))] text-sm text-fg", className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  const ref = usePart()
  return <div ref={ref} data-slot="card-footer" className={cn("relative z-30 flex items-center empty:hidden gap-2 px-[calc(var(--ds-inset)*var(--ds-panel-padding))]", className)} {...props} />
}

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardGroup, CardHeader, CardTitle }
