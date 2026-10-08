import * as React from "react"
import {
  AnimatePresence,
  animate,
  motion,
  useComposedRefs,
  useMotionValue,
  usePresence,
  usePresenceData,
  useReducedMotion,
  type AnimationPlaybackControls,
  type MotionValue,
  type Transition,
} from "motion/react"

import { cn } from "@/lib/utils"

import { EXIT, FROM_FIRST_FRAME, SPRINGS, exitFallbackMs } from "@/components/ui/ease"
import { nextFrame } from "@/components/ui/frame"

/**
 * 弹出层共用的进出场（菜单、弹出层、右键菜单、悬停名片、选择器、对话框、命令面板；DESIGN.md K3、§2.4、§4.2）。
 * Radix 的 Presence 只认 CSS keyframes，所以内容层一律 forceMount，交给 motion 的 AnimatePresence 管挂载；两套机制不叠在同一个元素上。
 * 动效（键盘与指针同一套档位，K3）：
 * - 进场：挂载那一帧钉在起点（透明），下一帧开播；animate(独立 MotionValue, …) 合进 FROM_FIRST_FRAME，从第一帧开始计时，
 *   挂载内容的长任务不算进动画（改前第一帧就到 70%）。透明度走 SPRINGS.fast（0.08s），位移与缩放走调用方给的 spring（默认 fast）。
 * - anchored（挂在锚点上的弹层：菜单、弹出层、悬停名片）：起点 = 透明 + scaleY 0.96 + 朝锚点方向 4px；方向读 Radix 翻转后的实际一侧
 *   （data-side：下方的从上往下滑、上方的从下往上滑、左右的横向滑），原点用 Radix 给的 transform-origin（贴锚点的那条边）。
 * - 退场：不回放进场，比进场快一档的短过渡（EXIT）：透明度 EXIT.fast（0.06s），位移与缩放用 spring 对应档的 EXIT；退场期间不接指针。
 *   退场途中又打开 → 从当前值、当前速度接着走进场的弹簧。
 * - 剪掉（AnimatePresence custom={POPUP_CUT}）：被同类的新一个替换（右键菜单换位置、名片成组切换）→ 直接消失，两个不同时出现。
 * - 减少动态：组件自己读 useReducedMotion()，不缩放、不位移，只留透明度。
 */

/**
 * 根组件的开关状态：受控、非受控两种写法照旧；同时放进 context，内容层据此挂载或播退场。
 * resting：由 defaultOpen 静止打开、还没人开关过（展示台、说明页里一直开着的菜单）。这时内容层不抢焦点：
 * 键盘在示例标签上换到这个示例，焦点留在标签上（2026-10-06 第三轮：dropdown-menu 载入、换示例后焦点都被拉进菜单）。
 */
const PopupContext = React.createContext<{ open: boolean; setOpen: (open: boolean) => void; resting?: boolean }>({ open: false, setOpen: () => {} })
const usePopup = () => React.useContext(PopupContext)

function useOpenState(open: boolean | undefined, defaultOpen: boolean | undefined, onOpenChange?: (open: boolean) => void) {
  const [inner, setInner] = React.useState(defaultOpen ?? false)
  const [touched, setTouched] = React.useState(false)
  const value = open ?? inner
  const setOpen = React.useCallback(
    (next: boolean) => {
      setTouched(true)
      if (open === undefined) setInner(next)
      onOpenChange?.(next)
    },
    [open, onOpenChange]
  )
  return { open: value, setOpen, resting: Boolean(defaultOpen) && open === undefined && !touched }
}

/**
 * 模态的 Radix 浮层（Select、模态的 DropdownMenu）挂着时给 body 写 pointer-events: none，页面别处的按下全落到 <html> 上被吞掉。
 * 关闭已经定下、面板还挂着（指针点选后停 300ms、Select 的退场）时，调用返回的函数把 body 还原成打开前的值：紧接着的按下
 * 落到真正的目标上，Radix 照样当作「点外面」立刻关。打开前 body 已经是 none（外面还有模态对话框）就不动；Radix 卸载内容层时
 * 写回的也是打开前的值。2026-10-07 展位图：选完马上在画布上拖框，第一笔被吞（选中后约 640ms 整页不接指针）。
 */
function useOutsidePointerRelease(open: boolean) {
  // 打开那一刻 body 的值（布局副作用先于 Radix 上锁的副作用）；没打开过、已经还原过是 null
  const before = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if (open) before.current = document.body.style.pointerEvents
  }, [open])
  return React.useCallback(() => {
    const value = before.current
    before.current = null
    if (value !== null && value !== "none") document.body.style.pointerEvents = value
  }, [])
}

/** 关闭时 Radix 把焦点还给触发器；停留或退场时用户已经按进了面板外的输入框，焦点就留在那里（pressedOutside：这次是不是按在了外面） */
function keepOutsideFocus(e: Event, pressedOutside: boolean) {
  const active = document.activeElement
  if (pressedOutside && active && active !== document.body && active.isConnected) e.preventDefault()
}

// Radix FocusScope 挂载时在内容层上派发的事件；先于它注册的监听 preventDefault 就不自动聚焦（Radix 自己的 onOpenAutoFocus 同样认 defaultPrevented）
const AUTOFOCUS_ON_MOUNT = "focusScope.autoFocusOnMount"

/**
 * 静止打开的锚定浮层（菜单、弹出层、选择器）不抢焦点。只管挂在触发点上的（Radix 的 popper 外壳里）：
 * 对话框由 defaultOpen 打开时仍把焦点收进去，模态内容要读屏和键盘先到那里。
 * 子组件的布局副作用先于 FocusScope 的副作用执行，所以这里的监听排在它前面。
 */
function useRestingFocus(node: React.RefObject<HTMLElement | null>) {
  const { resting } = usePopup()
  React.useLayoutEffect(() => {
    const el = node.current
    if (!resting || !el || !el.closest("[data-radix-popper-content-wrapper]")) return
    const hold = (e: Event) => e.preventDefault()
    el.addEventListener(AUTOFOCUS_ON_MOUNT, hold)
    return () => el.removeEventListener(AUTOFOCUS_ON_MOUNT, hold)
  }, [node, resting])
}

/** AnimatePresence 的 custom 传它：这次退场直接剪掉，不播（被同类的新一个替换） */
const POPUP_CUT = "cut"

type Offset = { x?: number; y?: number; scale?: number; scaleY?: number }

/** 锚定弹层的起点（DESIGN.md §2.4）：scaleY 0.96、朝锚点 4px，方向按实际一侧 */
const ANCHOR_SCALE_Y = 0.96
const ANCHOR_SLIDE = 4
const anchorFrom = (side: string | undefined): Offset => {
  if (side === "top") return { scaleY: ANCHOR_SCALE_Y, y: ANCHOR_SLIDE }
  if (side === "left") return { scaleY: ANCHOR_SCALE_Y, x: ANCHOR_SLIDE }
  if (side === "right") return { scaleY: ANCHOR_SCALE_Y, x: -ANCHOR_SLIDE }
  return { scaleY: ANCHOR_SCALE_Y, y: -ANCHOR_SLIDE }
}

/** 进场弹簧对应的退场：同档（K3「退场比进场快一档」） */
const exitOf = (spring: Transition) => (spring === SPRINGS.slow ? EXIT.slow : spring === SPRINGS.moderate ? EXIT.moderate : EXIT.fast)

type Values = { opacity: MotionValue<number>; x: MotionValue<number>; y: MotionValue<number>; scale: MotionValue<number>; scaleY: MotionValue<number> }

/**
 * 一层的进出场（PopupMotion、PopupScrim 共用）：独立 MotionValue，提交帧钉起点、下一帧开播；退场播完调 safeToRemove。
 * start() 每次进场时取起点（锚定弹层这时才读得到翻转后的 data-side）。
 */
function usePresenceMotion(values: Values, start: () => Offset, spring: Transition, instant: boolean) {
  const reduce = useReducedMotion() ?? false
  const [present, safeToRemove] = usePresence()
  const cut = usePresenceData() === POPUP_CUT
  const running = React.useRef<AnimationPlaybackControls[]>([])
  const from = React.useRef<Offset>({})
  const entered = React.useRef(false)
  // 每次开合换一代：退场途中又打开时，上一次退场的完成回调不再卸载它
  const generation = React.useRef(0)
  const stop = () => {
    running.current.forEach((a) => a.stop())
    running.current = []
  }
  React.useLayoutEffect(() => {
    const { opacity, ...transforms } = values
    const gen = ++generation.current
    const rest = { x: 0, y: 0, scale: 1, scaleY: 1 }
    if (present) {
      // 开发时 StrictMode 会把副作用跑两遍：「第一次进场」记在真正开播的那一刻，不记在副作用里
      const first = !entered.current
      if (first && instant) {
        entered.current = true
        opacity.jump(1)
        return
      }
      return nextFrame(() => {
        stop()
        entered.current = true
        if (first) {
          from.current = reduce ? {} : start()
          for (const [k, v] of Object.entries(from.current)) transforms[k as keyof typeof transforms].jump(v)
        }
        const enter = { ...spring, ...FROM_FIRST_FRAME }
        running.current = [
          animate(opacity, 1, { ...SPRINGS.fast, ...FROM_FIRST_FRAME }),
          ...(Object.keys(rest) as (keyof typeof rest)[]).map((k) => animate(transforms[k], rest[k], enter)),
        ]
      })
    }
    stop()
    if (cut) {
      opacity.jump(0)
      // AnimatePresence 在自己的 layout effect 里才登记退场，比这里晚：同步调用会被忽略，元素永远留在页面上（决策日志「退场的两个坑」）
      queueMicrotask(() => safeToRemove?.())
      return
    }
    const leave = exitOf(spring)
    const remove = () => gen === generation.current && safeToRemove?.()
    const fallback = window.setTimeout(remove, exitFallbackMs(leave))
    const back = reduce ? {} : from.current
    running.current = [
      animate(opacity, 0, EXIT.fast),
      ...(Object.keys(back) as (keyof typeof rest)[]).map((k) => animate(transforms[k], back[k] ?? rest[k], leave)),
    ]
    Promise.all(running.current).then(() => {
      window.clearTimeout(fallback)
      remove()
    })
    return () => window.clearTimeout(fallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present])
  React.useEffect(() => stop, [])
  return present
}

/**
 * 进出场的外壳：替代 Radix 内容层本身（asChild）。
 * - anchored：挂在锚点上的弹层（菜单、弹出层、悬停名片），起点见 anchorFrom。
 * - from：没有锚点的（对话框、命令面板：原地 scale）出现前的样子。
 * - spring：进场弹簧（默认 fast）；退场自动取同档的 EXIT。
 * - instant：直接出现、不播进场（静止展示的名片）。
 * - leaving：关闭已经定下、面板还要停一会儿（选择器点选后停 300ms）：从这一刻起和退场一样不接指针。
 */
function PopupMotion({
  from,
  anchored = false,
  spring = SPRINGS.fast,
  instant = false,
  leaving = false,
  style,
  ref,
  ...props
}: Omit<React.ComponentProps<typeof motion.div>, "style"> & {
  style?: React.CSSProperties
  from?: Offset
  anchored?: boolean
  spring?: Transition
  instant?: boolean
  leaving?: boolean
}) {
  const node = React.useRef<HTMLDivElement>(null)
  const refs = useComposedRefs(node, ref)
  useRestingFocus(node)
  // 起点在第一次渲染就写好（挂载那一帧透明，看不见位置）；锚定弹层的方向到开播时再按 data-side 定
  const reduce = useReducedMotion() ?? false
  const seed = instant || reduce ? {} : anchored ? { scaleY: ANCHOR_SCALE_Y } : (from ?? {})
  const values: Values = {
    opacity: useMotionValue(instant ? 1 : 0),
    x: useMotionValue(seed.x ?? 0),
    y: useMotionValue(seed.y ?? 0),
    scale: useMotionValue(seed.scale ?? 1),
    scaleY: useMotionValue(seed.scaleY ?? 1),
  }
  const present = usePresenceMotion(values, () => (anchored ? anchorFrom(node.current?.dataset.side) : (from ?? {})), spring, instant)
  // 停留（leaving）与退场期间不接收指针，Radix 的定位外壳也一起放开：按下穿到下面的元素（2026-10-07 展位图：选完马上在面板
  // 原来的位置上拖框，落到了正在淡出的选项上）。在场时用 Radix 给的值（模态层显式 auto，非模态不写）
  const idle = leaving || !present
  React.useLayoutEffect(() => {
    const shell = node.current?.parentElement
    if (shell?.hasAttribute("data-radix-popper-content-wrapper")) shell.style.pointerEvents = idle ? "none" : ""
  }, [idle])
  return <motion.div ref={refs} style={{ ...style, ...values, pointerEvents: idle ? "none" : style?.pointerEvents }} {...props} />
}

/** 遮罩：只淡入淡出，和面板同时开始（进 fast 档、出 EXIT.fast）。退场期间不接指针（2026-10-02：遮罩还盖着整页时点页面会落空）。 */
function PopupScrim({ className, style, ...props }: Omit<React.ComponentProps<typeof motion.div>, "style"> & { style?: React.CSSProperties }) {
  const values: Values = {
    opacity: useMotionValue(0),
    x: useMotionValue(0),
    y: useMotionValue(0),
    scale: useMotionValue(1),
    scaleY: useMotionValue(1),
  }
  const present = usePresenceMotion(values, () => ({}), SPRINGS.fast, false)
  return (
    <motion.div
      className={cn("fixed inset-0 z-50 bg-scrim scrim-blur", className)}
      style={{ ...style, opacity: values.opacity, ...(present ? null : { pointerEvents: "none" }) }}
      {...props}
    />
  )
}

/**
 * 换字（DESIGN.md §4.2「图标互换」同一套）：新字从 blur 4 淡入、旧字淡出并变糊，叠在同一格。
 * 出现的走 fast 的全长（0.08s，easeOut），消失的走 EXIT.fast（0.06s，easeIn）：出现总比消失长。
 * 两段都是短过渡不是弹簧：临界阻尼的弹簧提前落定，会把这个先后颠倒；blur 是 filter 字串，弹簧推不动。custom = 这次是否直接换。
 */
const APPEAR = { type: "tween", duration: 0.08, ease: "easeOut" } as const
const VANISH = { ...EXIT.fast, ease: "easeIn" } as const
const SWAP = {
  hidden: { willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 0, filter: "blur(4px)" },
  shown: { willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 1, filter: "blur(0px)", transition: APPEAR },
  gone: (still: boolean) =>
    still ? { opacity: 0, transition: { duration: 0 } } : { willChange: "filter", transitionEnd: { willChange: "auto" }, opacity: 0, filter: "blur(4px)", transition: VANISH },
}

// 换字的每一段（理由见 SwapText）
const SEGMENT = "inline-block max-w-full overflow-x-clip align-top [text-overflow:inherit]"

/**
 * 浮层里的一段字换成另一段（对话框分步时的标题与说明、提示里的「复制」→「已复制」）：两段叠在同一格里交叉，
 * 旧的一段脱离排版（popLayout），外层要 position: relative。只认文字；首次渲染不播；减少动态时直接换。
 * 每段是 inline-block：popLayout 按计算出的 height 把旧段钉成绝对定位，行内元素的 height 是 auto，量不到就不弹出，
 * 新旧两段在排版里并排，说明区临时多出一行（2026-10-06 对话框分步：说明 24 → 48 → 24，对话框跟着长高再缩回）。
 * 放在截断的外层里（truncate）照样出省略号：宽不超过外层、横向 overflow: clip（竖向不裁，字形高出行高也看得全）、text-overflow 跟外层；顶对齐，不用 inline-block 的底边当基线。
 */
function SwapText({ children, className }: { children: React.ReactNode; className?: string }) {
  const still = useReducedMotion() ?? false
  if (typeof children !== "string" && typeof children !== "number") return <>{children}</>
  return (
    // 离开的那段用的是它最后一次渲染时的属性，「这次要不要直接换」经 custom 传给它
    <AnimatePresence mode="popLayout" initial={false} custom={still}>
      <motion.span key={String(children)} className={cn(SEGMENT, className)} variants={SWAP} custom={still} initial={still ? false : "hidden"} animate="shown" exit="gone">
        {children}
      </motion.span>
    </AnimatePresence>
  )
}

export { POPUP_CUT, PopupContext, PopupMotion, PopupScrim, SwapText, keepOutsideFocus, useOpenState, useOutsidePointerRelease, usePopup }
