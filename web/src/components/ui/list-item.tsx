import * as React from "react"
import { AnimatePresence, motion, useIsPresent, useReducedMotion, type HTMLMotionProps } from "motion/react"

import { cn } from "@/lib/utils"
import { EXIT as EXIT_TIER, SPRINGS } from "@/components/ui/ease"
import { FluidHoverHighlight, useFluidHover, useFluidHoverScan } from "@/components/ui/fluid-hover"
import { LiftedCard } from "@/components/ui/lifted-card"
import { fromKeyboard } from "@/components/ui/hotkeys"

/**
 * 列表行，两种排法：
 * - stacked（默认）：标题（至多两行）+ 一行元信息。内边距 12，标题 15，元信息 13。
 * - inline：一行与控件同高（36 · 紧凑 28）——未读点 · 来源（112）· 标题（截断）· 时间。行窄于 448 时自动换成 stacked
 *   （390 宽实测：来源列 64 截成「FoodT…」、标题只剩 6 个字；2026-10-06 共用层）。未读时加蓝点；标题统一 500、文字色。
 * - stacked 的未读：传了 unread（true / false）才有未读位——蓝点在元信息行末尾、时间后面，已读留同宽空位，各行时间右缘对齐。
 * - 窄时元信息只截断、不折行（150 宽实测「王 / 芳」竖排），时间不收缩。
 * 当前行用 aria-current="true"（读屏念「当前」），不用 aria-pressed（会念成「切换按钮，已按下」）。
 * 选中时中性加深底直接换到这一行（LiftedCard fill，不滑动）。
 * 悬停（DESIGN.md K2、§4.3）：放进 ListGroup 时整组只有一块跟随悬停底（ui/fluid-hover），行按 DOM 顺序登记，
 *   指针在行间空隙、组的内边距、末行之下也落到最近的一行，点空隙 = 点亮着的那行；重新进入时从选中的那行淡入。
 *   单独放的 ListItem（不在 ListGroup 里）自己画 bg-hover（80ms）。
 *
 * 动效（DESIGN.md §4.2；行高不变）：
 * - 悬停底 fast（0.08s）跟随、淡出 EXIT.fast（0.06s）；选中 → 灰底直接换到这一行，不滑动。
 * - ListGroup 插入（系统 / 指针）→ 新行 opacity 0 → 1（fast）、scale .98 → 1，其余行 layout 让位，同一条 moderate（0.16s）→ 减少动态时只淡入。
 * - ListGroup 删除 → 原地 EXIT.fast 淡出并缩到 .98，同时弹出文档流、让出悬停序号，下面的行 moderate 补位 → 减少动态时只淡出、补位直接到位。
 * - ListGroup 重排 → layout moderate，可中途反向 → 减少动态时直接到位。
 * - 键盘触发（例如按 Delete 删行）→ 0ms。
 */
/**
 * ListGroup 里此刻有哪些行、什么顺序（key 连成的串）；不在组里是 null。
 * 行的 layoutDependency 用它：只有增删、重排时才量位置。否则删掉的行退场完卸载时 AnimatePresence 重渲染一次，
 * 正在补位的行被重新量一遍，弹簧从错的位置重来，一帧跳 20px（2026-10-01 实测）。
 */
const ListGroupContext = React.createContext<string | null>(null)

const INSTANT = { duration: 0 } as const
const ENTER = { ...SPRINGS.moderate, opacity: SPRINGS.fast, layout: SPRINGS.moderate } as const
/** 减少动态效果：位置、缩放直接到位，透明度照常淡入 */
const GENTLE = { opacity: SPRINGS.fast, layout: INSTANT, scale: INSTANT } as const
const EXIT = { opacity: 0, scale: 0.98, transition: EXIT_TIER.fast } as const
const ROWS = ":scope > [data-slot=list-item]"

/**
 * 会增删、重排的一组 ListItem：子项要带稳定的 key。删掉的行弹出文档流（popLayout），其余行同时补位。
 * 位置以这一组为参照（layoutRoot）：整组被外面的布局挤动时行跟着走，只有组内换位才动。
 * 默认 grid、行间距 2。整组一块跟随悬停底。
 */
function ListGroup({ className, children, ...props }: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement>(null)
  const hover = useFluidHover(ref)
  useFluidHoverScan(hover, ref, ROWS)
  const items = React.Children.toArray(children)
  const members = items.map((child) => (React.isValidElement(child) ? String(child.key) : "")).join("|")
  // 重新进入时从选中的那行淡入
  const selected = items.findIndex((child) => React.isValidElement(child) && (child.props as { selected?: boolean }).selected)
  return (
    <motion.div ref={ref} layout layoutRoot data-slot="list-group" className={cn("relative isolate grid gap-0.5", className)} {...hover.handlers} {...(props as HTMLMotionProps<"div">)}>
      <FluidHoverHighlight hover={hover} from={selected >= 0 ? selected : null} className="rounded-row" />
      <ListGroupContext.Provider value={members}>
        <AnimatePresence initial={false} mode="popLayout">
          {items}
        </AnimatePresence>
      </ListGroupContext.Provider>
    </motion.div>
  )
}

/** 在 ListGroup 里换成 motion.button，其余情况是普通 button，不挂任何动画。 */
function Row(props: React.ComponentProps<"button">) {
  const members = React.useContext(ListGroupContext)
  const reduce = useReducedMotion()
  const present = useIsPresent()
  if (members === null) return <button type="button" {...props} />
  const keyboard = fromKeyboard()
  return (
    <motion.button
      type="button"
      data-exiting={present ? undefined : ""}
      layout="position"
      layoutDependency={members}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={keyboard ? { opacity: 0, transition: INSTANT } : reduce ? { opacity: 0 } : EXIT}
      transition={keyboard ? INSTANT : reduce ? GENTLE : ENTER}
      {...(props as HTMLMotionProps<"button">)}
    />
  )
}
/** inline 行放得下来源列 112 + 标题的最窄宽度（Tailwind @md） */
const INLINE_MIN = 448

/** 行比 min 窄吗：布局提交后、绘制前量一次，之后跟着尺寸变（换排法不改行宽，不会来回跳） */
function useNarrow(ref: React.RefObject<HTMLElement | null>, enabled: boolean, min: number) {
  const [narrow, setNarrow] = React.useState(false)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!enabled || !el) return setNarrow(false)
    const read = () => setNarrow(el.getBoundingClientRect().width < min)
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, enabled, min])
  return narrow
}

/** 未读点 6px；已读留同宽空位 */
function UnreadDot({ unread }: { unread: boolean }) {
  return (
    <>
      <span aria-hidden data-slot="list-item-unread" className={cn("size-1.5 shrink-0 rounded-full", unread ? "bg-accent" : "bg-transparent")} />
      {unread ? <span className="sr-only">未读</span> : null}
    </>
  )
}

function ListItem({
  className,
  title,
  meta,
  trailing,
  selected = false,
  unread,
  layout = "stacked",
  group = "list",
  ref,
  ...props
}: Omit<React.ComponentProps<"button">, "title"> & {
  title: React.ReactNode
  meta?: React.ReactNode
  trailing?: React.ReactNode
  selected?: boolean
  /** inline：左侧蓝点；stacked：传了才有未读位（元信息行末尾） */
  unread?: boolean
  /** inline 在行窄于 448 时自动按 stacked 排 */
  layout?: "stacked" | "inline"
  group?: string
}) {
  const node = React.useRef<HTMLButtonElement>(null)
  const setRef = (el: HTMLButtonElement | null) => {
    node.current = el
    if (typeof ref === "function") ref(el)
    else if (ref) ref.current = el
  }
  const narrow = useNarrow(node, layout === "inline", INLINE_MIN)
  const grouped = React.useContext(ListGroupContext) !== null
  // 未读不加粗：加粗会让同一行的时间和来源标记移动 1.5–3px（layout-shift 审计实测），未读靠蓝点区分
  const base = cn(
    // min-w-0：放进 grid / flex 时能按容器收窄（单行式的标题是 nowrap，不加会把整组撑出容器，390 宽实测溢出 50px）
    "relative isolate w-full min-w-0 rounded-row text-left outline-none",
    // 组里由跟随悬停画底；单独放时自己画
    !grouped && "transition-colors duration-(--ds-dur-fast) ease-ds not-aria-[current=true]:hover:bg-hover",
    "focus-visible:focus-ring",
    "disabled:pointer-events-none disabled:opacity-40"
  )
  const current = selected ? "true" : undefined
  if (layout === "inline" && !narrow) {
    return (
      <Row ref={setRef} data-slot="list-item" data-layout="inline" aria-current={current} className={cn(base, "flex h-(--ds-h-row) pointer-coarse:min-h-(--ds-h-md) items-center pr-3 pl-2", className)} {...props}>
        {selected ? <LiftedCard group={group} className="-z-10 rounded-inherit" /> : null}
        <span className="relative flex w-full min-w-0 items-center gap-3 text-sm text-fg">
          <UnreadDot unread={Boolean(unread)} />
          <span className="flex w-28 shrink-0 items-center gap-1.5 truncate text-fg-muted">{meta}</span>
          <span data-slot="list-item-title" className="min-w-0 flex-1 truncate font-medium text-fg">{title}</span>
          {trailing ? <span className="shrink-0 text-xs whitespace-nowrap text-fg-muted tabular-nums">{trailing}</span> : null}
        </span>
      </Row>
    )
  }
  return (
    <Row ref={setRef} data-slot="list-item" data-layout="stacked" aria-current={current} className={cn(base, "grid p-3", className)} {...props}>
      {selected ? <LiftedCard group={group} className="-z-10 rounded-inherit" /> : null}
      <span className="relative grid gap-1">
        <span data-slot="list-item-title" className="line-clamp-2 text-sm font-medium text-pretty text-fg">{title}</span>
        {meta || trailing || unread !== undefined ? (
          <span className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
            <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">{meta}</span>
            {trailing || unread !== undefined ? (
              <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap tabular-nums">
                {trailing}
                {unread !== undefined ? <UnreadDot unread={unread} /> : null}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </Row>
  )
}

/**
 * 分组名（按日期或类别），滚动时吸顶，与上一组相隔 24。
 * 吸顶必须有实底、而且和所在的面同色：透明时滚上去的行从字底下穿过（reader「Gl今天obal」、list-canvas 压住「4 人」），
 * 不同色时是一块补丁（白卡片里的画布色）。底色读 --ds-surface：实底的面（bg-card、bg-canvas、浮层里的 Card / Surface、Split 内容栏）
 * 自己声明（ds-theme.css），没有面时画布色；换主题跟着变量走，不在运行时量（2026-10-07 收尾）。
 */
function ListSection({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="list-section"
      className={cn("sticky top-0 z-20 bg-(--ds-surface,var(--ds-canvas)) px-3 pt-6 pb-2 text-xs font-medium text-fg-muted", className)}
      {...props}
    />
  )
}

export { ListGroup, ListItem, ListSection }
