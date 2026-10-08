import * as React from "react"
import { X } from "lucide-react"
import { animate, AnimatePresence, motionValue, useReducedMotion, type AnimationPlaybackControls } from "motion/react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { useDensity, useDensityProps } from "@/components/ui/density"
import { FROM_FIRST_FRAME, SPRINGS } from "@/components/ui/ease"
import { Elevated, ELEVATION } from "@/components/ui/elevated"
import { nextFrame } from "@/components/ui/frame"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { PopupContext, PopupMotion, PopupScrim, SwapText, useOpenState, usePopup } from "@/components/ui/popup"

/**
 * 对话框：只用于必须先回答才能继续、或不可逆且后果说不清的短流程（DESIGN.md §2.4）；阅读文章不用对话框。
 * 宽度三档（size）：sm 400（默认）· lg 540 · xl 880；在紧凑区域（Density compact）里打开时各窄一档：360 · 480 · 800。
 *   只改宽、不改内边距：内边距按默认档的宽度算（ds-tokens「间距由容器算」，400 → 24、540 → 32、880 → 44）。
 *   xl 是拼版用的画布（侧栏 + 面板），通常配 className="p-0" 和固定高度。窄屏宽 = 视口 − 32。
 * 位置（position）：center（默认）上下居中；top 离顶 12dvh、不居中——高度随内容变的面板（命令面板、搜索）用它，顶边不跳。
 * 限定在容器里（container）：挂进那个元素，遮罩和面板从 fixed 换成 absolute；容器要 position: relative + overflow: hidden，
 *   通常配 <Dialog modal={false}>（例如文档里的预览框）。
 * 面（DESIGN.md §4.1「面的层级」）：比所在层高 4 层（Elevated + ELEVATION.dialog），浅色是白底、阴影随层；对话框里打开的下拉自动再高一层。
 *   在 Density 区域里打开时内容节点带上那一档（useDensityProps），里面的控件跟着变。
 * 质感：圆角 rounded-card；标题 17 / 600、说明 15 用正文色（不发灰），标题到说明 8，到内容与按钮区 group。
 *   可在标题上方放一枚 32 的图标（icon），图标到标题 16。按钮区（DialogFooter）的按钮用默认档（36 / 28 随区域）。
 * 关闭按钮（showCloseButton，默认 true）：右上角 ghost 图标按钮，× 的线对齐右侧内容线；只有内容自带出口（命令面板按 Esc、选中即关）时才去掉。
 * 内容比可用高度还高时对话框本身滚动（居中时 100dvh − 32，靠上时 88dvh − 16），按钮不会掉到屏幕外。
 *
 * 动效（DESIGN.md K3、§4.2；进出场在 popup.tsx 的 PopupMotion）：
 * - 打开 → 原地浮起：scale 0.97 → 1 走 SPRINGS.slow（0.24s、回弹 0.12），不位移，transform-origin 在正中；透明度 fast（0.08s），遮罩同时淡入。
 * - 关闭（关闭按钮、点遮罩、Esc、DialogClose）→ 不回放进场：缩放 EXIT.slow（0.16s）回到 0.97，透明度 EXIT.fast（0.06s）；退场途中遮罩、面板都不接指针。
 *   退场途中又打开 → 从当前缩放、当前速度接着浮起。
 * - 卸载兜底：退场靠动画完成回调卸载，后台标签页会停住 rAF，留下看不见的全屏遮罩和滚动锁；
 *   PopupMotion 关闭时同时起一个 exitFallbackMs(EXIT.slow)（260ms）的计时，到点一定卸载，不等动画回调（后台页的计时按 1 秒对齐，最晚约 1 秒）。
 * - 开着时换标题、说明（分步流程：邀请 → 确认）→ 新字从 blur 4 淡入、旧字淡出，叠在同一格（ui/popup 的 SwapText）。
 * - 开着时内容变高变矮（分步流程：选权限 → 确认）→ 外框高度走 SPRINGS.slow 到新高度，按钮区（DialogFooter）贴着底边一起走，不瞬间跳；
 *   途中按钮区垫上对话框底色，长高时盖住还没露出来的新内容。可中途反向（从当前高度、当前速度接着走）。键盘引起的直接到位。
 * - 减少动态 → 不缩放、高度直接到位，只留淡入淡出；换字直接换。
 */
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

/** 原地浮起：没有可依附的触发点，不位移，只从 0.97 放大（DESIGN.md K3：无挂靠时 f(0) = {scale .97, 透明 0}） */
const float = { scale: 0.97 }

/**
 * 宽度三档：默认档与紧凑区域里窄一档的宽；basis 是内边距按哪个宽算（只改宽、不改内边距，所以紧凑档也按默认档的宽算）。
 * 写成字面类名：Tailwind 只认源码里完整的类名。
 */
const WIDTH = {
  sm: { default: "max-w-[400px]", compact: "max-w-[360px]", basis: "[--ds-inset-basis:min(400px,100vw-32px)]" },
  lg: { default: "max-w-[540px]", compact: "max-w-[480px]", basis: "[--ds-inset-basis:min(540px,100vw-32px)]" },
  xl: { default: "max-w-[880px]", compact: "max-w-[800px]", basis: "[--ds-inset-basis:min(880px,100vw-32px)]" },
} as const

function Dialog({ open, defaultOpen, onOpenChange, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const state = useOpenState(open, defaultOpen, onOpenChange)
  return (
    <PopupContext value={state}>
      <DialogPrimitive.Root {...props} open={state.open} onOpenChange={state.setOpen} />
    </PopupContext>
  )
}

type DialogContentProps = Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  title: React.ReactNode
  description?: React.ReactNode
  /** 标题上方的图标（32），如应用图标 */
  icon?: React.ReactNode
  /** 宽度：sm 400（默认）· lg 540 · xl 880；紧凑区域里各窄一档（360 · 480 · 800），内边距不变 */
  size?: keyof typeof WIDTH
  /** center 上下居中（默认）；top 离顶 12dvh，高度随内容变的面板用它，顶边不跳 */
  position?: "center" | "top"
  /** 挂进这个元素（position: relative + overflow: hidden），遮罩与面板改成 absolute；通常配 <Dialog modal={false}> */
  container?: HTMLElement | null
  /** 右上角的关闭按钮；内容自带出口（Esc、选中即关）时才设 false */
  showCloseButton?: boolean
}

function DialogContent({
  className,
  title,
  description,
  icon,
  size = "sm",
  position = "center",
  container,
  showCloseButton = true,
  children,
  ...props
}: DialogContentProps) {
  const { open } = usePopup()
  const compact = useDensity() === "compact"
  const density = useDensityProps()
  const reduce = useReducedMotion()
  const still = React.useRef(false)
  still.current = Boolean(reduce)
  // 高度弹簧：外层高度一直钉成具体像素（打开后第一次量到就钉），只有这里改它；内层（self-start，不受外层定高影响）的自然高度一变，
  // 外层从钉住的高度走弹簧到新高度，按钮区同步 translateY 贴着底边。
  // 为什么一直钉住：原来到位后交还 auto，换步那次 React 提交后、ResizeObserver 回调前，外层先按 auto 排成终点高度，
  // 这一拍里读布局（rAF、读屏、滚动定位）看到 334 → 180 → 334（2026-10-06 第四轮）。钉住后提交帧仍是起点高度。
  // 用回调 ref：内容层挂进 Portal 比这个组件晚一拍；每次打开是新节点
  const body = React.useCallback((inner: HTMLDivElement | null) => {
    const el = inner?.parentElement
    if (!inner || !el) return
    const height = motionValue(0)
    let run: AnimationPlaybackControls | null = null
    /** 排在下一帧、还没起跑的弹簧 */
    let queued: (() => void) | null = null
    /** 钉住的高度（null = 还没量过）与正在去的高度 */
    let known: number | null = null
    let goal = 0
    /** 内层自然高度：ResizeObserver 给的 border-box，带小数、不受打开时的缩放影响 */
    let natural = 0
    const footerOf = () => inner.querySelector<HTMLElement>(":scope > [data-slot=dialog-footer]")
    const settle = (target: number) => {
      queued?.()
      queued = run = null
      known = goal = target
      el.style.height = `${target}px`
      el.style.overflowY = ""
      const footer = footerOf()
      if (footer) footer.style.transform = footer.style.backgroundColor = ""
    }
    const fit = () => {
      const style = getComputedStyle(el)
      const target = Math.min(natural + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom), parseFloat(style.maxHeight) || Infinity)
      if (known === null) return settle(target)
      if (Math.abs(target - goal) < 0.5) return
      const moving = run !== null || queued !== null
      const from = moving ? height.get() : known
      run?.stop()
      queued?.()
      queued = null
      if (still.current || fromKeyboard() || Math.abs(target - from) < 0.5) return settle(target)
      goal = target
      const footer = footerOf()
      if (footer) footer.style.backgroundColor = style.backgroundColor
      el.style.overflowY = "hidden"
      // 中途反向：从当前高度、当前速度接着走；静止起步用 jump 清掉速度（set 会把上次的值到 from 的跳变算成速度，先往反方向冲）
      if (!moving) height.jump(from)
      const paint = (v: number) => {
        el.style.height = `${v}px`
        if (footer) footer.style.transform = `translateY(${v - target}px)`
      }
      paint(from)
      // 提交帧只钉起点，下一帧才起弹簧并从第一帧计时：ResizeObserver 回调和 React 提交同一帧，
      // 同步起跑会把这一帧的提交耗时算进弹簧，第一帧跳一大步（DESIGN.md §5.3a）
      queued = nextFrame(() => {
        queued = null
        run = animate(height, target, { ...SPRINGS.slow, ...FROM_FIRST_FRAME, onUpdate: paint, onComplete: () => settle(target) })
      })
    }
    const ro = new ResizeObserver(([entry]) => {
      natural = entry.borderBoxSize?.[0]?.blockSize ?? inner.offsetHeight
      fit()
    })
    ro.observe(inner)
    // 视口变矮变高：max-height 跟着变，内层不一定变，钉住的高度要重算
    window.addEventListener("resize", fit)
    return () => {
      queued?.()
      run?.stop()
      ro.disconnect()
      window.removeEventListener("resize", fit)
    }
  }, [])

  const place = container ? "absolute" : "fixed"
  const width = WIDTH[size]
  return (
    <AnimatePresence>
      {open ? (
        <DialogPrimitive.Portal forceMount container={container ?? undefined}>
          <DialogPrimitive.Overlay forceMount asChild>
            <PopupScrim data-slot="dialog-overlay" className={place} />
          </DialogPrimitive.Overlay>
          <Elevated asChild {...ELEVATION.dialog}>
            {/* 没有说明时显式不挂 aria-describedby（Radix 否则会提示缺少 Description） */}
            <DialogPrimitive.Content forceMount asChild {...(description ? null : { "aria-describedby": undefined })} {...props}>
              <PopupMotion
                data-slot="dialog-content"
                data-size={size}
                data-position={position}
                {...density}
                // 宽度已知，内边距和间距照默认档的宽算（ds-tokens「间距由容器算」）
                data-inset
                data-surface
                from={float}
                spring={SPRINGS.slow}
                className={cn(
                  place,
                  "left-1/2 z-50 grid w-[calc(100%-32px)] -translate-x-1/2 overflow-y-auto overscroll-contain rounded-card p-inset text-fg outline-none",
                  compact ? width.compact : width.default,
                  width.basis,
                  position === "top" ? "top-[12dvh]" : "top-1/2 -translate-y-1/2",
                  container ? "max-h-[calc(100%-32px)]" : position === "top" ? "max-h-[calc(88dvh-16px)]" : "max-h-[calc(100dvh-32px)]",
                  className
                )}
              >
                {/* 标题行与右上角的关闭按钮同高同中线；按钮里 × 的线条对齐右侧内容线（内边距处）。
                    只有标题行给关闭按钮让位（pr-8）：说明在它下面，铺满整宽，窄屏不会提前折行、拆开词（390 宽「一起删 / 除」） */}
                {/* self-start：外层定高播弹簧时内层不被拉伸，量到的始终是内容的自然高度 */}
                <div ref={body} data-slot="dialog-body" className="grid gap-group self-start">
                  <div className="grid gap-2">
                    {icon ? <div className="mb-2 size-8 [&>*]:size-full">{icon}</div> : null}
                    <DialogPrimitive.Title className={cn("relative flex min-h-(--ds-h-md) items-center text-base font-semibold", showCloseButton && !icon && "pr-8")}>
                      <SwapText>{title}</SwapText>
                    </DialogPrimitive.Title>
                    {description ? (
                      <DialogPrimitive.Description className="relative text-sm leading-6 text-pretty text-fg">
                        <SwapText>{description}</SwapText>
                      </DialogPrimitive.Description>
                    ) : null}
                  </div>
                  {children}
                </div>
                {showCloseButton ? (
                  <DialogPrimitive.Close asChild>
                    <Button variant="ghost" size="icon" className="absolute top-inset right-[calc(var(--ds-inset)-(var(--ds-h-md)-16px)/2-3px)]" aria-label="关闭">
                      <X />
                    </Button>
                  </DialogPrimitive.Close>
                ) : null}
              </PopupMotion>
            </DialogPrimitive.Content>
          </Elevated>
        </DialogPrimitive.Portal>
      ) : null}
    </AnimatePresence>
  )
}

/** 底部按钮区：右对齐，确认类按钮放最右；按钮用默认档（36，紧凑区域 28）。对话框换高度时贴着底边走。 */
function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-footer" className={cn("flex justify-end gap-2", className)} {...props} />
}

export { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger }
export type { DialogContentProps }
