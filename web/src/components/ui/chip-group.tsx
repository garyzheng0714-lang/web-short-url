import { nextFrame } from "@/components/ui/frame"

import * as React from "react"
import { Check } from "lucide-react"
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform, type AnimationPlaybackControls } from "motion/react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { EXIT, SPRINGS, FROM_FIRST_FRAME } from "@/components/ui/ease"
import { MorphIcon } from "@/components/ui/morph-icon"
import { usePressScale } from "@/components/ui/stretch"

/**
 * 筛选片：按几个维度筛一个列表（主题、状态、渠道），常被来回点。全部摆出来，一眼看到哪些开着。
 * - 没选的片平放在凹槽色上（bg-well），选中的同色加深（bg-selected）、左侧长出 ✓，文字由次级墨变墨色；不改字重、不改高度。
 * - multiple（默认）可多选；multiple={false} 时一次只开一片，点开着的那片就取消。
 * - maxVisible：超出的片折叠进末尾的「+N ⌄」，点开显示全部、再点「收起 ⌃」（箭头是 MorphIcon，只靠字「+5」看着像一个计数、看不出能点，§4.5）；收起时已选的片（和刚才选过的）仍留在外面，筛选条件不会被藏起来。
 * - 键盘：整组只有一片在 Tab 序列里，方向键在片之间移动（首尾循环）、Home / End 到头，空格 / 回车切换；「+N」是组后面的一个独立按钮。
 * - 表单：name 提交多个同名隐藏 input（每个已选值一个）。
 *
 * 动效（DESIGN.md §4.2；片的变宽、让位、整组高度都是中等大小的块，走 moderate；键盘与指针同一档，K3）：
 * - 选中 → 这一片变宽：布局一步到位，看得见的外框右沿从旧宽度追到新宽度（moderate，0.16s、不过冲），文字同一条弹簧右移让出 ✓ 的位置，
 *   ✓ 跟着让出的宽度从 .5 长到 1 并淡入；后面的片用同一条弹簧滑到新位置，换行的也滑过去；整组高度变化 moderate。
 * - 取消 → 倒过来：外框右沿往回收，文字左移盖回 ✓ 的位置，✓ 缩回淡出，后面的片同一条 moderate 补位。
 *   中途再点从当前宽度、当前速度接着走（可打断）。底色 80ms ease-ds（颜色是反馈，可以先到）。
 * - 指针按下 → 按压：fast 压到 0.97，松手 fast 弹回（usePressScale）。
 * - 点「+N」→ 新露出的片同一刻 scale .9 → 1 并淡入（fast，不错落），收起的片走 fast 退场（0.06s）缩到 .9 淡出，其余 moderate 补位，整组高度 moderate；
 *   「+N」按钮自己直接到新位置，新文字（「收起」/「+N」）fast 淡入，不从新露出的片上面滑过去。
 * - 减少动态效果 → 不变形、不位移、不缩放，只留颜色与淡入淡出。
 */
type ChipOption = { value: string; label: string; disabled?: boolean }

/** ✓ 占的宽度：图标 16 + 与文字的间距 4 */
const SLOT = 20
const PRESSED = 0.97

/** 「+N / 收起」的左内边距（pl-3）：它没有底色，折到行首时整只往左推这么多 */
const MORE_PAD = 12

/**
 * 这个元素是不是在换行后的行首。用 left 推（相对定位不参与换行），推了以后量到的位置减掉推的量，
 * 不会因为推过去而又挤回上一行、来回跳。
 */
function useLineStart(ref: React.RefObject<HTMLElement | null>) {
  const [atStart, setAtStart] = React.useState(false)
  const measure = React.useCallback(() => {
    const el = ref.current
    if (!el) return
    const pushed = parseFloat(el.style.left) || 0
    setAtStart(el.offsetLeft - pushed < 1)
  }, [ref])
  React.useLayoutEffect(measure)
  React.useEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    const ro = new ResizeObserver(measure)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [ref, measure])
  return atStart
}

/** 这一次是怎么变的：变宽、变窄、展开收起；instant 只给减少动态 */
type Change = { kind: "grow" | "shrink" | "fold"; instant: boolean; at: number }

function ChipGroup({
  options,
  value: valueProp,
  defaultValue,
  onValueChange,
  multiple = true,
  maxVisible = Infinity,
  name,
  className,
  "aria-label": ariaLabel,
}: {
  options: ChipOption[]
  value?: string[]
  defaultValue?: string[]
  onValueChange?: (value: string[]) => void
  /** false：一次只开一片，点开着的那片取消 */
  multiple?: boolean
  /** 前几片之后折叠进「+N」 */
  maxVisible?: number
  /** 进原生表单：每个已选值一个同名隐藏 input */
  name?: string
  className?: string
  /** 整组的名字，例如「主题」（必传） */
  "aria-label": string
}) {
  const reduce = useReducedMotion()
  const [inner, setInner] = React.useState<string[]>(defaultValue ?? [])
  const value = valueProp ?? inner
  const [expanded, setExpanded] = React.useState(false)
  // 收起那一刻已选的片：之后取消了也留在外面，不在指针底下消失
  const [pinned, setPinned] = React.useState<string[]>(value)
  const [change, setChange] = React.useState<Change>({ kind: "grow", instant: true, at: 0 })

  const foldable = options.length > maxVisible
  const visible = !foldable || expanded ? options : options.filter((o, i) => i < maxVisible || pinned.includes(o.value) || value.includes(o.value))
  const hidden = options.length - visible.length

  const update = (next: string[]) => {
    const grew = next.length > value.length
    setChange({ kind: grew ? "grow" : "shrink", instant: Boolean(reduce), at: performance.now() })
    if (valueProp === undefined) setInner(next)
    onValueChange?.(next)
  }
  const onToggleGroup = (next: string[]) => {
    if (multiple) return update(options.filter((o) => next.includes(o.value)).map((o) => o.value))
    const added = next.find((v) => !value.includes(v))
    update(added ? [added] : [])
  }
  const toggleMore = () => {
    if (expanded) setPinned(value)
    setChange({ kind: "fold", instant: Boolean(reduce), at: performance.now() })
    setExpanded(!expanded)
  }

  const more = React.useRef<HTMLButtonElement>(null)
  const moreAtStart = useLineStart(more)

  const layoutSpring = change.instant ? { duration: 0 } : SPRINGS.moderate
  const dep = `${value.join("|")}#${expanded}`

  return (
    <HeightFrame change={change}>
      <ToggleGroupPrimitive.Root
        type="multiple"
        data-slot="chip-group"
        aria-label={ariaLabel}
        value={value}
        onValueChange={onToggleGroup}
        className={cn("relative flex flex-wrap items-center gap-1 pointer-coarse:gap-y-3", className)}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {visible.map((o) => (
            <Chip key={o.value} option={o} selected={value.includes(o.value)} change={change} layoutSpring={layoutSpring} dep={dep} />
          ))}
          {foldable ? (
            <motion.button
              key="more"
              ref={more}
              type="button"
              data-slot="chip-group-more"
              aria-expanded={expanded}
              aria-label={expanded ? "收起" : `展开其余 ${hidden} 项`}
              layout="position"
              layoutDependency={dep}
              // 展开收起时它自己换了文字、换了位置：直接到新位置，新文字淡入；不从新露出的片上面滑过去
              transition={{ layout: change.kind === "fold" ? { duration: 0 } : layoutSpring }}
              onClick={toggleMore}
              // 折到行首时没有底色的「+N / 收起」把左内边距推到列线外，字的墨迹落在片的外沿那条线上（DESIGN.md §3.2.1）
              style={{ left: moreAtStart ? -MORE_PAD : 0 }}
              className={cn(
                "group/more hit-area relative inline-flex h-(--ds-h-sm) shrink-0 items-center gap-1 rounded-control pr-2 pl-3 text-sm font-medium text-fg outline-none select-none tabular-nums",
                "transition-colors duration-(--ds-dur-fast) ease-ds hover:bg-hover hover:text-fg focus-visible:focus-ring focus-visible:transition-none",
                "[font-weight:var(--ds-weight-control)]"
              )}
            >
              <motion.span
                key={expanded ? "less" : "more"}
                initial={change.kind === "fold" && !change.instant ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                transition={SPRINGS.fast}
              >
                {expanded ? "收起" : `+${hidden}`}
              </motion.span>
              <MorphIcon name={expanded ? "chevron-up" : "chevron-down"} className="text-fg-muted transition-colors duration-(--ds-dur-fast) ease-ds group-hover/more:text-fg" />
            </motion.button>
          ) : null}
        </AnimatePresence>
      </ToggleGroupPrimitive.Root>
      {name ? value.map((v) => <input key={v} type="hidden" name={name} value={v} />) : null}
    </HeightFrame>
  )
}

function Chip({
  option,
  selected,
  change,
  layoutSpring,
  dep,
  ref,
  ...props
}: React.ComponentProps<"button"> & {
  option: ChipOption
  selected: boolean
  change: Change
  layoutSpring: object
  dep: string
}) {
  const reduce = useReducedMotion()
  const { node, press, release } = usePressScale<HTMLSpanElement>(PRESSED)
  const box = React.useRef<HTMLButtonElement>(null)
  // 看得见的外框比布局慢多少（px）：布局一步到位，lag 从差值回到 0
  const lag = useMotionValue(0)
  const grown = useMotionValue(selected ? 1 : 0)
  const right = useTransform(lag, (v) => -v)
  const checkScale = useTransform(grown, (v) => 0.5 + 0.5 * v)
  const width = React.useRef<number | null>(null)
  const running = React.useRef<AnimationPlaybackControls | null>(null)

  React.useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const next = el.offsetWidth
    const prev = width.current
    width.current = next
    if (prev === null || prev === next) return
    running.current?.stop()
    if (change.instant || reduce) return lag.jump(0)
    // 接着当前的位置和速度：快速连点时外沿不跳
    const velocity = lag.getVelocity()
    lag.jump(lag.get() + prev - next)
    return nextFrame(() => { running.current = animate(lag, 0, { ...SPRINGS.moderate, velocity }) })
  }, [selected, change, lag, reduce])

  // ✓ 长到多大 = 它的位置被让出了多少：选中时 (SLOT + lag) / SLOT，取消时 lag / SLOT
  React.useLayoutEffect(() => {
    const slot = selected ? SLOT : 0
    const sync = () => grown.set(Math.min(1, Math.max(0, (slot + lag.get()) / SLOT)))
    sync()
    return lag.on("change", sync)
  }, [selected, lag, grown])

  // 字体晚到这类被动的尺寸变化：只记下新宽度，不动画
  React.useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => (width.current = el.offsetWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const instant = change.instant
  return (
    <ToggleGroupPrimitive.Item value={option.value} disabled={option.disabled} asChild>
      <motion.button
        ref={(el: HTMLButtonElement | null) => {
          box.current = el
          if (typeof ref === "function") ref(el)
          else if (ref) ref.current = el
        }}
        type="button"
        data-slot="chip"
        data-value={option.value}
        layout="position"
        layoutDependency={dep}
        initial={{ opacity: 0, scale: reduce ? 1 : 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={instant ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: reduce ? 1 : 0.9, transition: EXIT.fast }}
        transition={instant ? { duration: 0, layout: { duration: 0 } } : { ...SPRINGS.fast, layout: layoutSpring }}
        className="group/chip relative inline-flex max-w-full min-w-0 shrink-0 rounded-control outline-none select-none focus-visible:focus-ring disabled:opacity-40"
        onPointerDown={(e: React.PointerEvent) => !option.disabled && press(e)}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        {...(props as object)}
      >
        <span
          ref={node}
          className={cn(
            "relative isolate inline-flex h-(--ds-h-sm) min-w-0 items-center px-3 text-sm [font-weight:var(--ds-weight-control)]",
            "text-fg",
            !instant && "transition-colors duration-(--ds-dur-fast) ease-ds"
          )}
        >
          <motion.span
            aria-hidden
            data-slot="chip-surface"
            style={{ right }}
            className={cn(
              "absolute inset-y-0 left-0 -z-10 rounded-control bg-well shadow-inset group-focus-visible/chip:shadow-none",
              "group-hover/chip:bg-active group-aria-pressed/chip:bg-selected",
              !instant && "transition-[background-color] duration-(--ds-dur-fast) ease-ds"
            )}
          />
          <motion.span
            aria-hidden
            data-slot="chip-check"
            className="absolute top-1/2 left-3 -mt-2 size-4 origin-left text-fg"
            style={{ scale: checkScale, opacity: grown }}
          >
            <Check className="size-4" />
          </motion.span>
          <span aria-hidden className="shrink-0" style={{ width: selected ? SLOT : 0 }} />
          <motion.span className="truncate" style={{ x: lag }}>
            {option.label}
          </motion.span>
        </span>
      </motion.button>
    </ToggleGroupPrimitive.Item>
  )
}

/**
 * 整组的高度：换行数变了（选中变宽挤到下一行、展开收起）时，由 moderate 从旧高度走到新高度，只在走的途中裁切。
 * 在提交这次变化的同一刻（布局副作用里、浏览器画出来之前）先把外框钉在旧高度再起步，没有一帧先跳到新高度。
 * 减少动态直接到位；不是这几种动作引起的尺寸变化（窗口变宽、字体晚到）由 ResizeObserver 直接放开成 auto。
 */
function HeightFrame({ change, children }: { change: Change; children: React.ReactNode }) {
  const frame = React.useRef<HTMLDivElement>(null)
  const content = React.useRef<HTMLDivElement>(null)
  const height = useMotionValue<number | "auto">("auto")
  const last = React.useRef(0)
  const running = React.useRef<{ to: number; anim: AnimationPlaybackControls } | null>(null)

  const settle = () => {
    running.current?.anim.stop()
    running.current = null
    height.jump("auto")
    if (frame.current) frame.current.style.overflow = ""
  }

  React.useLayoutEffect(() => {
    const box = frame.current
    if (!box) return
    box.style.contain = "layout"
    const off = height.on("change", (v) => (box.style.height = v === "auto" ? "" : `${v}px`))
    return () => {
      off()
      running.current?.anim.stop()
    }
  }, [height])

  // 每次动作提交后：量新高度，从当前看得见的高度（动画途中就是途中的值）走过去
  React.useLayoutEffect(() => {
    const el = content.current
    const box = frame.current
    if (!el || !box) return
    const next = el.offsetHeight
    const current = height.get()
    const from = typeof current === "number" ? current : last.current
    last.current = next
    if (change.instant || Math.abs(from - next) < 0.5) {
      if (!running.current || Math.abs(running.current.to - next) >= 0.5) settle()
      return
    }
    running.current?.anim.stop()
    box.style.overflow = "clip"
    height.jump(from)
    return nextFrame(() => { running.current = { to: next, anim: animate(height, next, { ...SPRINGS.moderate, ...FROM_FIRST_FRAME, onComplete: settle }) } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change])

  // 被动的尺寸变化：直接放开；正在走向的就是这个高度时不打断
  React.useEffect(() => {
    const el = content.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const next = el.offsetHeight
      if (running.current && Math.abs(running.current.to - next) < 0.5) return
      last.current = next
      settle()
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={frame} data-slot="chip-group-frame" className="min-w-0">
      <div ref={content}>{children}</div>
    </div>
  )
}

export { ChipGroup, type ChipOption }
