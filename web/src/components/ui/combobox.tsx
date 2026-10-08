"use client"

import { nextFrame } from "@/components/ui/frame"

import * as React from "react"
import { Check, ChevronDown, CircleX, Plus } from "lucide-react"
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, type AnimationPlaybackControls } from "motion/react"

import { cn } from "@/lib/utils"
import { useDensityProps } from "@/components/ui/density"
import { EXIT, SPRINGS } from "@/components/ui/ease"
import { fromKeyboard, isComposing } from "@/components/ui/hotkeys"
import { useFieldControl } from "@/components/ui/field"
import { FluidHoverHighlight, useFluidHover, type FluidHover } from "@/components/ui/fluid-hover"
import { fieldSurface } from "@/components/ui/input"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { useOpenState } from "@/components/ui/popup"

/**
 * 可搜索的选择：选项多（城市、时区、成员）、用户知道名字想直接打时用。输入框就是控件，焦点始终留在输入框里（DESIGN.md §5）。
 * - 点输入框、点 ⌄、按 ↓ ↑ 或直接打字 → 列表从输入框下方长出，与输入框同宽。显示与筛选分开：打开时输入框清空、已选名称留作占位，
 *   列表列出全部；打了字才筛。打开那一刻第一行就高亮（↑ 打开的高亮最后一行），回车总有目标。
 * - 打字按名称和别名（keywords）过滤，忽略大小写、全角半角、首尾空格，开头匹配的排前面；每次筛完重新高亮第一行。
 * - ↑ ↓ 穿过输入框循环（APG 组合框）：过了最后一行高亮清空（停在输入框上），再按一下回到第一行；跳过禁用项。
 *   高亮经 aria-activedescendant 指给读屏；键盘移动的高亮滚进列表可见处（只滚列表，不滚页面）。
 * - 指针与键盘共用一块跟随悬停底（ui/fluid-hover）：指针在行间空隙里也落到最近的一行，点空隙等于点亮着的那行；
 *   指针离开列表，高亮留在最后一行（§5「高亮只有一个」）。
 * - onCreate：查询和任何名称都不完全相同时，列表最后多一行「新建「…」」——有匹配时回车选的是真匹配，什么都不匹配时回车才新建。
 * - 选中后列表收回，输入框显示名称；Esc、点外面、Tab 离开都丢掉查询，恢复成已选名称。有值时右侧 ✕ 清除。
 * - 中文输入法组字时（isComposing）：回车、方向键、Esc 都交给输入法，组字中的拼音不拿去过滤，确认后才过滤。
 * - 表单：name 提交 value（不是名称）；aria-invalid 时整块描红。放进 Field 自动接线（useFieldControl）：id、说明与错误的 aria-describedby、
 *   有错误时 aria-invalid 都落在输入框上，FieldLabel 不写 htmlFor 也指向它。
 * 尺寸：输入框高 --ds-h-md、左内边距 --ds-pad-x-md；行高 --ds-h-md，行里的字和输入框里的字在同一条竖线上；弹层跟着所在区域的密度。
 *
 * 动效（DESIGN.md §4.2）：
 * - 指针点开 / 选中 / 点外面 → 照 Popover（ui/popup）：以输入框为原点 scale .95→1，SPRINGS.fast；收回走 EXIT。
 * - 打字、↓ 打开，回车选中，Esc 关闭 → 0ms（键盘）。
 * - 打字带来的结果变化 → 列表高度 SPRINGS.moderate 跟到量出来的像素高；不是打字引起的（打开、换数据）直接到位。
 * - 高亮：跟随悬停底在行间 SPRINGS.fast 滑动（键盘与指针同一档）；选中底在行间 SPRINGS.moderate 滑动。
 * - ✕ 出现：0.8 → 1、blur 4 → 0、淡入，SPRINGS.fast；消失 EXIT.fast。键盘选中引起的 0ms。
 * - 减少动态：不缩放、不模糊，高度、高亮、选中底直接到位，只留淡入淡出。
 */
type ComboboxOption = { value: string; label: string; keywords?: string[]; disabled?: boolean }

/** 新建行的值：带 NUL 前缀，不会和使用方的 value 撞上 */
const CREATE = "\u0000create"

/** 搜索用的写法归一：全角转半角（NFKC）、忽略大小写、去掉首尾空格 */
const norm = (s: string) => s.normalize("NFKC").toLowerCase().trim()
/** 0：名称或别名以查询开头；1：包含查询；-1：不匹配。开头匹配的排在前面，同一档内保持原来的顺序 */
const rank = (o: ComboboxOption, q: string) => {
  const terms = [o.label, ...(o.keywords ?? [])].map(norm)
  return terms.some((t) => t.startsWith(q)) ? 0 : terms.some((t) => t.includes(q)) ? 1 : -1
}
function filterOptions(options: ComboboxOption[], query: string) {
  const q = norm(query)
  return q ? options.map((o) => ({ o, r: rank(o, q) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r).map((x) => x.o) : options
}
/** 列表里的行：筛出来的选项，加上可能有的新建行（永远最后） */
function rowsOf(options: ComboboxOption[], query: string, creatable: boolean, createLabel: (q: string) => string): ComboboxOption[] {
  const shown = filterOptions(options, query)
  const q = query.trim()
  if (!creatable || !q || options.some((o) => norm(o.label) === norm(q))) return shown
  return [...shown, { value: CREATE, label: createLabel(q) }]
}
const firstEnabled = (rows: ComboboxOption[]) => (rows.some((o) => !o.disabled) ? rows.findIndex((o) => !o.disabled) : null)
const lastEnabled = (rows: ComboboxOption[]) => (rows.some((o) => !o.disabled) ? rows.findLastIndex((o) => !o.disabled) : null)

function Combobox({
  options,
  value: valueProp,
  defaultValue = "",
  onValueChange,
  onCreate,
  createLabel = (q) => `新建「${q}」`,
  placeholder = "搜索或选择",
  emptyText,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  disabled,
  readOnly,
  name,
  id,
  className,
  "aria-invalid": ariaInvalid,
  "aria-describedby": describedBy,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "type"> & {
  options: ComboboxOption[]
  /** 选中的 value；"" 表示未选 */
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** 允许新建：查询和任何名称都不同时，列表最后多一行，选它回传去掉首尾空格的查询 */
  onCreate?: (query: string) => void
  /** 新建行的文字 */
  createLabel?: (query: string) => string
  /** 没有匹配时列表里的那一行；不写时是「没有找到「…」，换个关键词」 */
  emptyText?: string
  /** 受控：面板是否开着 */
  open?: boolean
  /** 非受控：挂载时就开着（静止展示，例如组件页舞台） */
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const uid = React.useId()
  const listId = `${uid}-list`
  const optionId = (v: string) => `${uid}-o-${v === CREATE ? "create" : v}`
  const reduce = useReducedMotion()
  const density = useDensityProps()
  const { labelledBy: _, ...control } = useFieldControl({ id, "aria-describedby": describedBy, "aria-invalid": ariaInvalid })
  const invalid = control["aria-invalid"] === true || control["aria-invalid"] === "true"
  const [inner, setInner] = React.useState(defaultValue)
  const value = valueProp ?? inner
  const selected = options.find((o) => o.value === value)

  const { open: wanted, setOpen } = useOpenState(openProp, defaultOpen, onOpenChange)
  // 禁用、只读：值只给人看，列表不开、✕ 不出、⌄ 不点（2026-10-06 点验：只读时仍能点开列表、换人、清空）
  const locked = Boolean(disabled || readOnly)
  const open = wanted && !locked
  const [text, setText] = React.useState("") // 输入框里正显示的字（组字中也跟着变）
  const [query, setQuery] = React.useState("") // 拿去过滤的字（组字确认后才更新）
  const composing = React.useRef(false)
  // 收着时输入框里显示的是已选名称：直接打字打开列表时，新字接在名称后面，要把名称剥掉（「打开时输入框清空」，2026-10-04 复查：打出「周宁zzz」）
  const stale = React.useRef("")
  const typedAt = React.useRef(-Infinity)
  const box = React.useRef<HTMLDivElement>(null)
  const input = React.useRef<HTMLInputElement>(null)
  const list = React.useRef<HTMLDivElement>(null)
  const hover = useFluidHover(list)
  const { activeIndex: cursor, setActiveIndex: setCursor } = hover

  const rows = rowsOf(options, query, Boolean(onCreate), createLabel)
  const current = cursor === null ? undefined : rows[cursor]

  const commit = (next: string) => (valueProp === undefined && setInner(next), onValueChange?.(next))
  const show = (from: "first" | "last" = "first") => {
    if (locked) return
    stale.current = ""
    setText("")
    setQuery("")
    const all = rowsOf(options, "", Boolean(onCreate), createLabel)
    aim(from === "first" ? firstEnabled(all) : lastEnabled(all))
    setOpen(true)
  }
  const close = () => (setOpen(false), setText(""), setQuery(""))
  const choose = (o: ComboboxOption) => {
    if (o.disabled) return
    if (o.value === CREATE) onCreate?.(query.trim())
    else commit(o.value)
    close()
    input.current?.focus()
  }

  /** 键盘移动的高亮滚进可见处（最近的一边，留出面板内边距）；只滚列表，不滚页面 */
  const reveal = (i: number) => {
    const scroller = list.current
    const el = scroller?.querySelector<HTMLElement>(`[id="${CSS.escape(optionId(rows[i].value))}"]`)
    if (!scroller || !el) return
    const pad = parseFloat(getComputedStyle(scroller).paddingTop) || 0
    const top = el.offsetTop - pad
    const bottom = el.offsetTop + el.offsetHeight + pad
    if (top < scroller.scrollTop) scroller.scrollTop = top
    else if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight
  }
  /** ↓ ↑：穿过输入框循环——过了最后一行停在输入框（null），再按回到第一行 */
  const step = (dir: 1 | -1) => {
    let i = cursor
    for (let n = 0; n <= rows.length; n++) {
      i = i === null ? (dir > 0 ? 0 : rows.length - 1) : i + dir
      if (i < 0 || i >= rows.length) i = null
      if (i === null || !rows[i].disabled) break
    }
    aim(i)
    if (i !== null) reveal(i)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    props.onKeyDown?.(e)
    if (e.defaultPrevented || isComposing(e.nativeEvent) || composing.current) return
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (!open) return show(e.key === "ArrowDown" ? "first" : "last")
      step(e.key === "ArrowDown" ? 1 : -1)
    } else if (e.key === "Enter" && open) {
      // 列表开着时回车是选中，不提交外面的表单；停在输入框上（没有高亮）时什么都不做
      e.preventDefault()
      if (current) choose(current)
    } else if (e.key === "Escape" && open) {
      e.preventDefault()
      close()
    } else if (e.key === "Tab" && open) {
      // Tab 离开输入框（哪怕下一站是框里的 ✕）就是离开：列表收回、丢掉查询
      close()
    }
  }

  const onText = (raw: string) => {
    if (!open) stale.current = selected?.label ?? ""
    // 组字途中不动输入框里的字（输入法还在用它），确认后再剥
    if (!composing.current && stale.current) {
      if (raw.startsWith(stale.current)) raw = raw.slice(stale.current.length)
      stale.current = ""
    }
    setText(raw)
    if (!open) setOpen(true)
    if (composing.current) return
    typedAt.current = performance.now()
    setQuery(raw)
    aim(firstEnabled(rowsOf(options, raw, Boolean(onCreate), createLabel)))
    if (list.current) list.current.scrollTop = 0
  }

  // 想要的高亮：键盘、打开、打字定的，以及指针指过的最后一行。跟随悬停清掉高亮时（指针离开列表、行重新登记）放回它：
  // 回车总有目标，指针离开列表后高亮留在最后指着的那行（§5）。只有 ↑ ↓ 停到输入框上才是真的没有高亮
  const want = React.useRef<number | null>(null)
  const aim = (i: number | null) => ((want.current = i), setCursor(i))
  React.useLayoutEffect(() => {
    if (cursor !== null) want.current = cursor
    else if (open && want.current !== null && want.current < rows.length) setCursor(want.current)
  })
  // 打开时高亮的行滚进可见处（↑ 打开的是最后一行）；挂载那一帧不读布局，下一帧再量
  React.useEffect(() => {
    if (!open || want.current === null) return
    const i = want.current
    const frame = requestAnimationFrame(() => i < rows.length && reveal(i))
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const instant = fromKeyboard()
  const filled = Boolean(selected) && !locked
  const checked = rows.findIndex((o) => o.value === value)
  return (
    <Popover open={open} onOpenChange={(next) => (next ? show() : close())}>
      <PopoverAnchor asChild>
        <div
          ref={box}
          data-slot="combobox"
          data-invalid={invalid ? "" : undefined}
          data-readonly={readOnly ? "" : undefined}
          className={cn(
            fieldSurface,
            "flex h-(--ds-h-md) w-full min-w-0 cursor-text items-center gap-1 pointer-coarse:gap-3 rounded-control pr-1.5 pl-(--ds-pad-x-md) text-md",
            "has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-40",
            // 聚焦时槽底是白的，指针还停在上面也不回到悬停的灰
            "focus-within:hover:bg-card data-invalid:shadow-[inset_0_0_0_1px_var(--ds-danger)]",
            // 只读：不邀请点击，悬停不加深
            "data-readonly:cursor-default data-readonly:hover:not-focus-within:bg-well",
            className
          )}
          onPointerDown={(e) => {
            // 点框里的空白也算点输入框；点 ✕、⌄ 各有各的事
            if (e.target === e.currentTarget) e.preventDefault()
            if (!(e.target as Element).closest("button")) {
              input.current?.focus()
              if (!open) show()
            }
          }}
        >
          <input
            ref={input}
            id={control.id}
            type="text"
            role="combobox"
            autoComplete="off"
            aria-expanded={open}
            aria-controls={open && rows.length ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open && current ? optionId(current.value) : undefined}
            aria-invalid={control["aria-invalid"]}
            aria-describedby={control["aria-describedby"]}
            disabled={disabled}
            readOnly={readOnly}
            value={open ? text : (selected?.label ?? "")}
            placeholder={selected?.label ?? placeholder}
            className="h-full min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-muted disabled:cursor-not-allowed"
            {...props}
            onChange={(e) => onText(e.target.value)}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={(e) => {
              composing.current = false
              onText(e.currentTarget.value)
            }}
            onKeyDown={onKeyDown}
          />
          <motion.button
            type="button"
            data-slot="combobox-clear"
            aria-label="清除"
            // 没有值时用 inert 而不是 disabled：disabled 会让 Field 以为整个控件不可用，把标签也淡掉
            inert={!filled}
            initial={false}
            animate={{ willChange: "filter", transitionEnd: { willChange: "auto" }, ...(filled ? { opacity: 1, scale: 1, filter: "blur(0px)" } : { opacity: 0, scale: reduce ? 1 : 0.8, filter: reduce ? "blur(0px)" : "blur(4px)" }) }}
            transition={instant ? { duration: 0 } : filled ? SPRINGS.fast : EXIT.fast}
            className={cn(
              "hit-area relative grid size-6 shrink-0 place-items-center rounded-full text-fg-muted outline-none transition-colors duration-(--ds-dur-fast) ease-ds hover:text-fg",
              "focus-visible:focus-ring",
              !filled && "pointer-events-none"
            )}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              commit("")
              close()
              input.current?.focus()
            }}
          >
            <CircleX className="size-(--ds-icon)" aria-hidden />
          </motion.button>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            data-slot="combobox-toggle"
            disabled={disabled}
            // 只读时 ⌄ 不再暗示能展开：invisible 保住位置、字的可用宽度不变；用 inert 不用 disabled（同 ✕：disabled 会让 Field 把标签淡掉）
            inert={readOnly}
            // 角落同心：离框的上、下、右都是 6，圆角 = 框的圆角 − 6
            className={cn("hit-area relative grid size-6 shrink-0 place-items-center rounded-control-action text-fg-muted outline-none", readOnly && "invisible")}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              input.current?.focus()
              if (open) close()
              else show()
            }}
          >
            <ChevronDown className="size-(--ds-icon)" />
          </button>
        </div>
      </PopoverAnchor>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
        {...density}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (box.current?.contains(e.target as Node)) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (composing.current) e.preventDefault()
        }}
      >
        <ComboboxList listRef={list} typedAt={typedAt} id={listId} empty={!rows.length} handlers={hover.handlers}>
          <ComboboxMarks hover={hover} checked={checked} reduce={Boolean(reduce)} />
          {rows.length ? (
            rows.map((o, i) => {
              const on = o.value === value
              return (
                <div
                  key={o.value}
                  ref={hover.itemRef(i)}
                  id={optionId(o.value)}
                  role="option"
                  aria-selected={on}
                  aria-disabled={o.disabled || undefined}
                  data-active={cursor === i ? "" : undefined}
                  data-slot={o.value === CREATE ? "combobox-create" : "combobox-option"}
                  className={cn(
                    // 左内边距：面板内边距 + 它 = 输入框的左内边距，选项的字和输入框里的字在同一条竖线上
                    "relative flex h-(--ds-h-md) cursor-default items-center gap-(--ds-gap-control) rounded-popover-item pr-(--ds-pad-row) pl-[calc(var(--ds-pad-x-md)-var(--ds-pad-popover))] select-none",
                    "text-(length:--ds-text-control) leading-(--ds-lh-control) text-fg aria-disabled:pointer-events-none aria-disabled:opacity-40"
                  )}
                  onClick={() => choose(o)}
                >
                  {o.value === CREATE ? <Plus className="size-(--ds-icon) shrink-0 text-fg-muted" aria-hidden /> : null}
                  {/* 选中时字 600：隐形的 600 副本占住宽度，变粗不挤动勾 */}
                  <span className="inline-grid min-w-0 flex-1">
                    <span className={cn("col-start-1 row-start-1 truncate", on ? "font-semibold" : "font-normal")}>{o.label}</span>
                    <span aria-hidden className="invisible col-start-1 row-start-1 truncate font-semibold">{o.label}</span>
                  </span>
                  <span aria-hidden className="grid size-(--ds-icon) shrink-0 place-items-center">
                    {on ? <Check className="size-full text-fg" /> : null}
                  </span>
                </div>
              )
            })
          ) : (
            <div role="status" data-slot="combobox-empty" className="flex h-(--ds-h-md) items-center pl-[calc(var(--ds-pad-x-md)-var(--ds-pad-popover))] text-(length:--ds-text-control) text-fg-muted">
              {/* 必要提示：筛选后为空的空状态，一句指出下一步（DESIGN.md §4.3「空」） */}
              <span className="truncate">{emptyText ?? `没有找到「${query.trim()}」，换个关键词`}</span>
            </div>
          )}
        </ComboboxList>
      </PopoverContent>
    </Popover>
  )
}

/** 选中底（moderate 档在行间滑）+ 跟随悬停底（fast 档）；都在行下面一层 */
function ComboboxMarks({ hover, checked, reduce }: { hover: FluidHover; checked: number; reduce: boolean }) {
  const rect = hover.isMeasured && checked >= 0 ? hover.itemRects[checked] : undefined
  return (
    <>
      <AnimatePresence>
        {rect ? (
          <motion.div
            key="selected"
            aria-hidden
            data-slot="combobox-selected"
            className="pointer-events-none absolute top-0 left-0 -z-10 rounded-popover-item bg-selected"
            initial={false}
            animate={{ x: rect.left, y: rect.top, width: rect.width, height: rect.height, opacity: 1 }}
            exit={{ opacity: 0, transition: EXIT.moderate }}
            transition={reduce ? { duration: 0 } : { ...SPRINGS.moderate, opacity: SPRINGS.fast }}
          />
        ) : null}
      </AnimatePresence>
      <FluidHoverHighlight hover={hover} className="rounded-popover-item" />
    </>
  )
}

/**
 * 结果列表：最高 288，超出自己滚（scroll-safe-fit：会滚动才留出滚动条槽，不滚时左右对称；scroll-fade 只在还有内容的一边淡出；overscroll 不带动页面）。
 * 它也是跟随悬停的容器（relative isolate）：两块底在内边距坐标里，随内容一起滚。
 * 高度：只有打字后 1 秒内的变化走 moderate；挂载、换数据直接到位。动到量出来的像素高，不动到 auto（§4.2）。
 */
function ComboboxList({
  listRef,
  typedAt,
  id,
  empty,
  handlers,
  children,
}: {
  listRef: React.RefObject<HTMLDivElement | null>
  typedAt: React.RefObject<number>
  id: string
  /** 没有匹配：里面只有一行状态（role=status），这时不是 listbox */
  empty: boolean
  handlers: FluidHover["handlers"]
  children: React.ReactNode
}) {
  const reduce = useReducedMotion()
  const sizer = React.useRef<HTMLDivElement>(null)
  const height = useMotionValue<number | "auto">("auto")
  const running = React.useRef<AnimationPlaybackControls | null>(null)
  const latest = React.useRef(reduce)
  latest.current = reduce

  React.useLayoutEffect(() => {
    const box = listRef.current
    const inner = sizer.current
    if (!box || !inner) return
    const style = getComputedStyle(box)
    const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    box.style.contain = "layout"
    const off = height.on("change", (v) => (box.style.height = v === "auto" ? "" : `${v}px`))
    let cancel: (() => void) | undefined
    const resize = () => {
      cancel?.()
      const to = inner.offsetHeight + pad
      const from = height.get()
      const typing = performance.now() - typedAt.current < 1000
      if (from === "auto" || !typing || latest.current) return height.jump(to)
      if (Math.abs(from - to) < 0.5) return
      // 变高且最后放得下时，途中先不出滚动条
      if (to <= parseFloat(style.maxHeight || "Infinity")) box.style.overflowY = "hidden"
      cancel = nextFrame(() => {
        running.current = animate(height, to, SPRINGS.moderate)
        running.current.finished.then(() => (box.style.overflowY = ""))
      })
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(inner)
    return () => {
      cancel?.()
      off()
      ro.disconnect()
      running.current?.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={listRef}
      data-slot="combobox-list"
      {...handlers}
      // 点列表里任何地方（选项、禁用项、空白）焦点都留在输入框
      onPointerDown={(e) => e.preventDefault()}
      className="relative isolate scroll-safe-fit scroll-fade max-h-72 overflow-y-auto overscroll-contain p-(--ds-pad-popover)"
    >
      <div ref={sizer} id={empty ? undefined : id} role={empty ? undefined : "listbox"} aria-label={empty ? undefined : "选项"}>
        {children}
      </div>
    </div>
  )
}

export { Combobox, type ComboboxOption }
