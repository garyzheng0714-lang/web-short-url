import { nextFrame } from "@/components/ui/frame"

import * as React from "react"
import { ChevronDown } from "lucide-react"
import { animate, AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Select as SelectPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useDensityProps } from "@/components/ui/density"
import { EXIT, SPRINGS } from "@/components/ui/ease"
import { Elevated, ELEVATION } from "@/components/ui/elevated"
import { useFieldControl } from "@/components/ui/field"
import { FluidHoverHighlight, useFluidHover } from "@/components/ui/fluid-hover"
import { fieldSurface } from "@/components/ui/input"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { usePortalContainer } from "@/components/ui/portal-scope"
import { PopupContext, PopupMotion, keepOutsideFocus, useOpenState, useOutsidePointerRelease, usePopup } from "@/components/ui/popup"

/**
 * 选择器：触发器外观同 Input（凹槽，展开时同聚焦）；面板是弹层（Elevated 所在层 + 2，阴影固定第 3 层，DESIGN.md §4.1），
 * 跟着所在区域的密度（useDensityProps，§3.1）。最窄 176、不窄于触发器；最高 min(300, 可用高)，超出自己滚（scroll-safe-fit + scroll-fade，§3.9）。
 * 行：高 --ds-h-md，字和触发器里的值在同一条竖线上（行左内边距 = 触发器内边距 − 面板内边距），右侧固定一格勾（--ds-icon，
 * 勾出现、消失都不改行宽，面板不跟着变宽）。选中的行：一块 bg-selected 底 + 勾 + 字 600（隐形的 600 副本占宽，§4.1）。
 * 悬停：整个面板只有一块跟随悬停底（ui/fluid-hover，§K2）；指针在行间空隙、内边距里也落到最近的一行，点在空隙里等于点亮着的那行。
 * 键盘：方向键、Home / End、打字跳选都由 Radix 管；高亮跟着焦点走，和指针共用同一块底。
 * 焦点环只在键盘导航时出现（从键盘打开，或打开后按过导航键）；指针打开时 Radix 把焦点放到选中行上，不画环（§4.3）。
 *
 * 动效（DESIGN.md §4.2）：
 * - 打开、关闭：照 popup.tsx 的 PopupMotion anchored（透明 + scaleY .96 + 朝触发器 4px，SPRINGS.fast 进、EXIT.fast 退，不回放进场）。
 * - 指针点选 → 面板停 300ms 再关（SELECTION_ACK_MS）：新行的勾画出来（pathLength 0→1，0.08s easeOut），旧行的勾收回（0.04s easeIn），
 *   选中底从旧行滑到新行（SPRINGS.moderate）。停的时候按 Esc、点外面、再点触发器 → 立刻关。键盘选中不停，直接关。
 *   停留和退场期间页面照常接指针（popup.tsx 的 useOutsidePointerRelease）：点外面的那一下落到下面的元素上；按进了别处的输入框，焦点留在那里。
 * - 跟随悬停底在行间 SPRINGS.fast 滑动，指针离开面板淡出（EXIT.fast），重新进入在最近的行淡入。
 * - 触发器：field 是凹槽，悬停、展开即时变色（同 Input）；inline 是平的按钮，悬停、展开 80ms ease-ds 变色。
 * - 指针选中新值 → 触发器里的值按列表方向换：靠后的从下面升起、靠前的从上面落下，SPRINGS.fast，新旧各带 2px 模糊交叉；
 *   键盘选中、打字跳选、外部改值、初次挂载 → 不滚。
 * - 减少动态：不缩放、不位移，高亮与选中底直接到位，只留淡入淡出；勾仍画出（只是很短的描线，不位移）。
 */
/** 指针点选后面板再停多久才关：勾画完（80ms）、选中底滑到位（160ms），再留一点让人看到结果 */
const SELECTION_ACK_MS = 300
/** Radix 不告诉为什么关：选中后这么短时间内到的关闭，算作选中引起的 */
const PICK_CLOSE_WINDOW_MS = 100
/** 打开后按这些键才算键盘导航，开始画焦点环 */
const NAV_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Tab"])

/** 这一次换值往哪个方向滚：key 每次指针换值加一；instant 表示直接换 */
type Roll = { key: number; dir: number; instant: boolean }
type SelectCtx = {
  roll: Roll
  list: React.RefObject<HTMLDivElement | null>
  inline: React.RefObject<boolean>
  /** 当前选中的值（受控、非受控都在这里） */
  selected: string | undefined
  /** 指针点选后停留中：面板不再接指针 */
  leaving: boolean
}
const SelectContext = React.createContext<SelectCtx>({
  roll: { key: 0, dir: 1, instant: true },
  list: { current: null },
  inline: { current: false },
  selected: undefined,
  leaving: false,
})

function Select({ open, defaultOpen, onOpenChange, value, defaultValue, onValueChange, ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const state = useOpenState(open, defaultOpen, onOpenChange)
  const list = React.useRef<HTMLDivElement>(null)
  // 触发器是不是 inline（行末的值）：面板跟着右端对齐，不伸出行的右边线
  const inline = React.useRef(false)
  const [inner, setInner] = React.useState(defaultValue)
  const selected = value ?? inner
  const current = React.useRef(selected)
  current.current = selected
  const [roll, setRoll] = React.useState<Roll>({ key: 0, dir: 1, instant: true })
  const pickedAt = React.useRef(-Infinity)
  const ack = React.useRef<number | null>(null)
  const release = useOutsidePointerRelease(state.open)
  const [leaving, setLeaving] = React.useState(false)
  // 关了、面板还在退场：Radix 的 Select 到内容层卸载才解锁 body，这里先还原；停留标记清掉（退场本来就不接指针）
  React.useLayoutEffect(() => {
    if (state.open) return
    release()
    setLeaving(false)
  }, [state.open, release])
  const cancelAck = () => {
    if (ack.current !== null) window.clearTimeout(ack.current)
    ack.current = null
  }
  React.useEffect(() => cancelAck, [])

  const change = (next: string) => {
    // 方向按选项在列表里的先后：面板此刻开着，从里面读顺序
    const order = [...(list.current?.querySelectorAll<HTMLElement>("[data-slot=select-item]") ?? [])].map((e) => e.dataset.value)
    const from = order.indexOf(current.current ?? ""), to = order.indexOf(next)
    setRoll((r) => ({ key: r.key + 1, dir: to < from ? -1 : 1, instant: fromKeyboard() || from < 0 || to < 0 }))
    pickedAt.current = performance.now()
    if (value === undefined) setInner(next)
    onValueChange?.(next)
  }
  // 指针点选引起的关闭往后推 SELECTION_ACK_MS；别的关闭（Esc、点外面、再点触发器）立刻关，并取消还在等的那次
  const openChange = (next: boolean) => {
    cancelAck()
    if (!next && !fromKeyboard() && performance.now() - pickedAt.current < PICK_CLOSE_WINDOW_MS) {
      // 一次点选只算一次：停的时候再来的关闭（Esc、点外面）走下面的立刻关
      pickedAt.current = -Infinity
      release()
      setLeaving(true)
      ack.current = window.setTimeout(() => {
        ack.current = null
        state.setOpen(false)
      }, SELECTION_ACK_MS)
      return
    }
    state.setOpen(next)
  }
  const ctx = React.useMemo(() => ({ roll, list, inline, selected, leaving }), [roll, selected, leaving])
  return (
    <PopupContext value={state}>
      <SelectContext value={ctx}>
        <SelectPrimitive.Root {...props} value={value} defaultValue={defaultValue} onValueChange={change} open={state.open} onOpenChange={openChange} />
      </SelectContext>
    </PopupContext>
  )
}
const SelectGroup = SelectPrimitive.Group

/** 触发器里的值：真正的值（Radix 把选中项的文字传进来）+ 换值时一份往外滚的旧值影子 */
function SelectValue({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  const { roll } = React.useContext(SelectContext)
  const reduce = useReducedMotion()
  const real = React.useRef<HTMLSpanElement>(null)
  const shadow = React.useRef<HTMLSpanElement>(null)
  // 上一次显示的文字：选中项的文字是 Radix 从面板里传进来的，不经过本组件渲染，用 MutationObserver 记下。
  // 它的回调晚于布局副作用，所以换值那一刻读到的还是旧文字
  const last = React.useRef("")
  React.useEffect(() => {
    const el = real.current
    if (!el) return
    last.current = el.textContent ?? ""
    const mo = new MutationObserver(() => (last.current = el.textContent ?? ""))
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    return () => mo.disconnect()
  }, [])
  const seen = React.useRef(roll.key)
  React.useLayoutEffect(() => {
    const el = real.current
    if (!el || seen.current === roll.key) return
    seen.current = roll.key
    const before = last.current
    const ghost = shadow.current
    if (roll.instant || !ghost || !before || before === el.textContent) return
    ghost.textContent = before
    const off = (d: number) => (reduce ? "0%" : `${d * 100}%`)
    const blur = reduce ? "blur(0px)" : "blur(2px)"
    el.style.transform = `translateY(${off(roll.dir)})`
    el.style.opacity = "0"
    ghost.style.opacity = "1"
    el.style.willChange = "transform, opacity, filter"
    ghost.style.willChange = "transform, opacity, filter"
    let runs: { stop: () => void }[] = []
    let active = true
    const cancel = nextFrame(() => {
      runs = [
        animate(el, { y: [off(roll.dir), "0%"], filter: [blur, "blur(0px)"], opacity: [0, 1] }, SPRINGS.fast),
        animate(ghost, { y: ["0%", off(-roll.dir)], filter: ["blur(0px)", blur] }, SPRINGS.fast),
      ]
      const fade = animate(ghost, { opacity: [1, 0] }, EXIT.fast)
      runs.push(fade)
      fade.finished.then(() => {
        if (!active) return
        ghost.textContent = ""
        el.style.willChange = ""
        ghost.style.willChange = ""
      })
    })
    return () => {
      active = false
      cancel()
      runs.forEach((run) => run.stop())
      for (const node of [el, ghost]) for (const key of ["transform", "opacity", "filter", "will-change"]) node.style.removeProperty(key)
      ghost.textContent = ""
    }
  }, [roll.key])
  return (
    <span data-slot="select-value" className="grid min-w-0 overflow-hidden">
      <SelectPrimitive.Value ref={real} className={cn("col-start-1 row-start-1 truncate", className)} {...props} />
      <span ref={shadow} aria-hidden className="pointer-events-none col-start-1 row-start-1 truncate opacity-0" />
    </span>
  )
}

/**
 * variant="inline"：设置面板、检查器里「标签 … 值 ⌄」那一行右端的值。平放，没有凹槽；悬停和展开时浅灰底（像 macOS 的弹出按钮），
 * 文字落在行的右边线上（edge-end），宽度跟着值走。
 */
function SelectTrigger({
  className,
  children,
  variant = "field",
  id,
  "aria-describedby": describedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & { variant?: "field" | "inline" }) {
  const { inline } = React.useContext(SelectContext)
  // 放进 Field 自动接线（同 Input）：id、标签 htmlFor、说明与错误的 aria-describedby、有错误时 aria-invalid；显式传的优先
  // 自带 aria-label 的是字段里的附属选择器（邀请框旁的「角色」），不抢字段的控件位
  const { labelledBy: _, ...control } = useFieldControl({ id, "aria-describedby": describedBy, "aria-invalid": ariaInvalid }, { aside: Boolean(props["aria-label"] || props["aria-labelledby"]) })
  React.useLayoutEffect(() => {
    inline.current = variant === "inline"
  }, [inline, variant])
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-variant={variant}
      className={cn(
        variant === "field"
          ? [
              fieldSurface,
              "flex h-(--ds-h-md) w-full min-w-0 items-center justify-between gap-(--ds-gap-control) rounded-control px-(--ds-pad-x-md) text-left text-(length:--ds-text-control) leading-(--ds-lh-control) text-fg outline-none",
              "[&>svg]:size-(--ds-icon)",
            ]
          : [
              // 行末用 edge-end 时推出去的是自己的内边距 8 和 ⌄ 两侧的留白 3，⌄ 的线条落在内容线上；
              // 行首用 edge-start 时起头的是字，只推内边距 8，字的左缘落在列线上（2026-10-06：成员角色列差 3px）
              "inline-flex h-(--ds-h-sm) min-w-0 items-center gap-1 rounded-control px-2 text-sm text-fg outline-none select-none [--ds-edge:--spacing(2)] [--ds-ink-inset:3px] [&.edge-start]:[--ds-ink-inset:0px]",
              "transition-colors duration-(--ds-dur-fast) ease-ds hover:bg-hover data-[state=open]:bg-hover focus-visible:focus-ring focus-visible:transition-none",
              // ⌄ 随字定大小（DESIGN.md §4.5：15 → 16，13 → 14），公式同 Button 的 --button-icon；放进检查器行（13 号）时跟着变小
              "[--select-icon:round(up,calc(1.25em-2.75px),2px)] [&_svg]:size-(--select-icon) [&_svg]:shrink-0",
            ],
        "hit-area relative data-placeholder:text-fg-muted",
        "[&>span]:truncate",
        className
      )}
      {...control}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="shrink-0 text-fg-muted" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  sideOffset = 8,
  align,
  onPointerDownOutside,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const { open } = usePopup()
  const pressedOutside = React.useRef(false)
  const container = usePortalContainer()
  const density = useDensityProps()
  const { list, inline } = React.useContext(SelectContext)
  // 收起且退场播完后，照样挂一份不可见的内容层（Radix 把它放进 DocumentFragment）：触发器里显示的选中文字是选项的 ItemText
  // 传送过去的，内容层整个卸掉时触发器会变空。退场期间不挂，免得两份 ItemText 同时把文字传进去。
  const [present, setPresent] = React.useState(open)
  if (open && !present) setPresent(true)
  return (
    <>
      {present ? null : (
        <SelectPrimitive.Content position="popper" collisionPadding={8}>
          <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      )}
      <AnimatePresence custom={fromKeyboard()} onExitComplete={() => setPresent(false)}>
        {open ? (
          <SelectPrimitive.Portal forceMount container={container}>
            <Elevated asChild {...ELEVATION.popover}>
              <SelectPrimitive.Content
                forceMount
                asChild
                position="popper"
                sideOffset={sideOffset}
                align={align ?? (inline.current ? "end" : "start")}
                collisionPadding={8}
                onPointerDownOutside={(e) => {
                  pressedOutside.current = true
                  onPointerDownOutside?.(e)
                }}
                onCloseAutoFocus={(e) => {
                  onCloseAutoFocus?.(e)
                  keepOutsideFocus(e, pressedOutside.current)
                  pressedOutside.current = false
                }}
                {...props}
              >
                <SelectList listRef={list} className={className} {...density}>
                  {children}
                </SelectList>
              </SelectPrimitive.Content>
            </Elevated>
          </SelectPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </>
  )
}

/** 面板本体：滚动外壳（PopupMotion）+ 视口（跟随悬停的容器）+ 选中底 + 悬停底 */
function SelectList({
  listRef,
  className,
  children,
  ref,
  onKeyDownCapture,
  ...props
}: Omit<React.ComponentProps<typeof PopupMotion>, "from" | "anchored" | "children"> & { listRef: React.RefObject<HTMLDivElement | null>; children?: React.ReactNode }) {
  const reduce = useReducedMotion()
  const { selected, leaving } = React.useContext(SelectContext)
  const viewport = React.useRef<HTMLDivElement>(null)
  const items = React.useRef<HTMLElement[]>([])
  const hover = useFluidHover(viewport, { gapClick: false })
  const { registerItem, setActiveIndex, itemRects, isMeasured } = hover
  // 键盘导航：从键盘打开时就算；指针打开后按过导航键才算。只在这时画焦点环
  const [keyboardNav, setKeyboardNav] = React.useState(fromKeyboard)
  const [checked, setChecked] = React.useState(-1)

  // 行按文档顺序登记（分组、分隔线夹在中间也照样数）；面板里的行增减时重登一遍
  React.useLayoutEffect(() => {
    const root = viewport.current
    if (!root) return
    const sync = () => {
      const next = [...root.querySelectorAll<HTMLElement>("[data-slot=select-item]")]
      next.forEach((el, i) => registerItem(i, el))
      for (let i = next.length; i < items.current.length; i++) registerItem(i, null)
      items.current = next
      setChecked(next.findIndex((el) => el.dataset.value === selected))
    }
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(root, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [registerItem, selected])

  const checkedRect = isMeasured && checked >= 0 ? itemRects[checked] : undefined
  const indexOf = (target: EventTarget) => items.current.indexOf((target as Element).closest?.("[data-slot=select-item]") as HTMLElement)
  return (
    <PopupMotion
      ref={(el: HTMLDivElement | null) => {
        listRef.current = el
        if (typeof ref === "function") ref(el)
        else if (ref) ref.current = el
      }}
      data-slot="select-content"
      data-nav={keyboardNav ? "keyboard" : undefined}
      anchored
      leaving={leaving}
      onScroll={hover.handlers.onScroll}
      onKeyDownCapture={(e) => {
        // 捕获阶段：Radix 在自己的 keydown 里挪焦点，标记要先于它
        if (NAV_KEYS.has(e.key) || e.key.length === 1) setKeyboardNav(true)
        onKeyDownCapture?.(e)
      }}
      className={cn(
        "z-50 min-w-[max(calc(var(--spacing)*44),var(--radix-select-trigger-width))] origin-(--radix-select-content-transform-origin)",
        "max-h-[min(300px,var(--radix-select-content-available-height))] overflow-y-auto overscroll-contain rounded-popover p-(--ds-pad-popover) text-fg scroll-safe-fit scroll-fade",
        className
      )}
      {...props}
    >
      <SelectPrimitive.Viewport
        ref={viewport}
        className="isolate"
        {...hover.handlers}
        onScroll={undefined}
        onFocus={(e) => {
          const i = indexOf(e.target)
          if (i >= 0) setActiveIndex(i)
        }}
        onPointerUp={(e) => {
          // 点在行间空隙、内边距、分组名上：等于点亮着的那一行（Radix 在 pointerup 上选中，转一个 pointerup 给它）
          if (e.pointerType !== "mouse" || indexOf(e.target) >= 0 || hover.activeIndex === null) return
          const row = items.current[hover.activeIndex]
          if (row && !row.matches("[data-disabled]")) row.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }))
        }}
      >
        <AnimatePresence>
          {checkedRect ? (
            <motion.div
              key="selected"
              aria-hidden
              data-slot="select-selected"
              className="pointer-events-none absolute top-0 left-0 -z-10 rounded-popover-item bg-selected"
              initial={false}
              animate={{ x: checkedRect.left, y: checkedRect.top, width: checkedRect.width, height: checkedRect.height, opacity: 1 }}
              exit={{ opacity: 0, transition: EXIT.moderate }}
              transition={reduce ? { duration: 0 } : { ...SPRINGS.moderate, opacity: SPRINGS.fast }}
            />
          ) : null}
        </AnimatePresence>
        <FluidHoverHighlight hover={hover} from={checked >= 0 ? checked : undefined} className="rounded-popover-item" />
        {children}
      </SelectPrimitive.Viewport>
    </PopupMotion>
  )
}

/**
 * 勾：一笔画出（和 lucide 的 check 同一形状，从左下起笔）。描线是 pathLength 的过渡，弹簧会提前落定、读不出「画」，所以用定时长：
 * 出现走 fast 档全长 0.08s easeOut；收回比 fast 的退场再快一档（0.04s easeIn），新勾画出时旧勾已经没了，不会同时看到两个勾。
 */
const CHECK_IN = { duration: 0.08, ease: "easeOut" } as const
const CHECK_OUT = { duration: 0.04, ease: "easeIn" } as const

function SelectCheck({ on }: { on: boolean }) {
  // 打开面板时已选中的那一行直接是画好的勾，不在打开时重画
  const mounted = React.useRef(false)
  React.useEffect(() => {
    mounted.current = true
  }, [])
  return (
    <span aria-hidden data-slot="select-check" className="grid size-(--ds-icon) shrink-0 place-items-center text-fg">
      <AnimatePresence initial={false}>
        {on ? (
          // 线宽 2.25 / 24 × 16 = 1.5px，同 lucide 的线（lucide 靠 non-scaling-stroke，那样 pathLength 的虚线会按缩放前算错）
          <motion.svg key="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" className="size-full">
            <motion.path d="M4 12l5 5L20 6" initial={{ pathLength: mounted.current ? 0 : 1 }} animate={{ pathLength: 1, transition: CHECK_IN }} exit={{ pathLength: 0, transition: CHECK_OUT }} />
          </motion.svg>
        ) : null}
      </AnimatePresence>
    </span>
  )
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  const { selected } = React.useContext(SelectContext)
  const on = selected === props.value
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      data-value={props.value}
      data-checked={on || undefined}
      className={cn(
        // 左内边距：面板内边距 + 它 = 触发器的横向内边距，选项的字和触发器里的值在同一条竖线上（同 Combobox）
        "relative flex h-(--ds-h-md) shrink-0 cursor-default items-center gap-(--ds-gap-control) rounded-popover-item pr-(--ds-pad-row) pl-[calc(var(--ds-pad-x-md)-var(--ds-pad-popover))] outline-none select-none",
        "text-(length:--ds-text-control) leading-(--ds-lh-control) text-fg data-disabled:pointer-events-none data-disabled:opacity-40",
        // 焦点环只在键盘导航时（面板标 data-nav=keyboard）；指针移动带来的程序聚焦不画环
        "in-data-[nav=keyboard]:focus-visible:focus-ring",
        className
      )}
      {...props}
    >
      {/* 选中时字 600：上面一层是看得见的字（Radix 把它传进触发器），下面一份隐形的 600 副本占住宽度，变粗不挤动勾 */}
      <span className="inline-grid min-w-0 flex-1">
        <span className={cn("col-start-1 row-start-1 truncate transition-[font-weight] duration-(--ds-dur-fast) ease-ds", on ? "font-semibold" : "font-normal")}>
          <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        </span>
        <span aria-hidden className="invisible col-start-1 row-start-1 truncate font-semibold">
          {children}
        </span>
      </span>
      <SelectCheck on={on} />
    </SelectPrimitive.Item>
  )
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label className={cn("px-[calc(var(--ds-pad-x-md)-var(--ds-pad-popover))] pt-2 pb-1 text-xs font-medium text-fg-muted", className)} {...props} />
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn("-mx-(--ds-pad-popover) my-1 h-px bg-line", className)} {...props} />
}

export { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue }
