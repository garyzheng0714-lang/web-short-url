"use client"

import * as React from "react"
import { AnimatePresence, motion, useIsPresent, useReducedMotion, type HTMLMotionProps } from "motion/react"

import { cn } from "@/lib/utils"
import { Density, type DensityValue } from "@/components/ui/density"
import { EXIT as EXIT_TIER, SPRINGS } from "@/components/ui/ease"
import { FluidHoverHighlight, useFluidHover, useFluidHoverScan } from "@/components/ui/fluid-hover"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { useInvariant } from "@/components/ui/invariant"

/**
 * 表格：不套卡片，浅灰表头、行间 1px 极淡分隔线。行高跟控件档：默认 36、紧凑 28（DESIGN.md §3.1「控件」；density 钉住一档，不写跟随外面的 Density）。
 * 首尾列内边距 --ds-table-edge（平时 16；Page width="app" 里 8：行线、悬停底落在标题线上，字缩进 8，先例 Stripe、Notion），格间 12；
 * 字是控件字（15/24 · 13/20）。选中行不改底色，只靠行首复选框表达。
 * 字色分主次（DESIGN.md §3.11「数据界面」，2026-10-08：原来所有格子平时都是 fg-muted，主列和次列分不出来，用户看短链列表说「极其丑的表头设计」）：
 * - 单元格默认 fg 400；主列由使用方加 font-medium（500）；只有元数据列（创建时间、编号、邮箱、最近使用）写 muted → fg-muted。
 * - 数字、金额、日期列写 align="end"：右对齐 + tabular-nums，表头同一列也写 align="end"。
 * - 每列有列名（行操作那一列除外）；状态只标偏离常态的；计数、金额是纯文本，不进 Tag。
 * 行悬停（DESIGN.md K2、§4.3「悬停」）：整张表只有一块跟随悬停底（ui/fluid-hover），画在表格后面；表体的行按顺序登记，表头不登记。
 * - 亮着的那行：它的下边线和上一行的下边线变透明（表头下线在第一行亮时变透明），底读起来是干净的一整块；线的颜色走 80ms 过渡，不闪。
 * - 亮着的那行字色不变（主次在静止时就分清，不靠悬停才变深）。
 * - 指针在表头或末行之下时落到最近的行；表格不转发空隙点击（行里多半是复选框，点空白不该替人勾选）。
 * - 不该亮的行（骨架、空、出错、分组标题行）标 data-static；整张表都不该亮（只读预览、矩阵）写 rowHover={false}。
 * flush（正文表格）：外框向两侧出血 8，首尾格留 8，字仍落在上下文的内容线上；表头不铺底（一列一条线，只留表头下线），
 * 行悬停底比字多出 8（红线 5 底色块不贴字；ds-theme.css edge-start：临时底色越过内容线是对的）。
 * 横向放不下（表格本身比外框宽）时才有下面两件事，放得下时一律不做：
 * - 还没滚到头的一侧 24 渐隐（mask），被挤出去的列看得出还在；那一侧有吸附列时不渐隐（吸附列的竖线已经说明）。
 * - 末列是操作列（表头没有可见字，或没有表头时每行末格都是按钮 / 链接）才钉在右缘，底色取外框所在面的实际底色
 *   （量祖先，不写死 bg-card：表放在画布、灰面、卡片上都不出白条）；亮着那行的钉住格叠一层悬停色。数据列、矩阵的末列不钉。标 data-stacked 的表不钉。
 * 外框不是容器查询容器：表格内部不具名的 @3xl 等量到的是区块自己的容器（2026-10-06：cohort-retention 的 @3xl:h-8 量错了容器）。
 * flush 的出血区会被祖先的 overflow 裁掉时（data-tight）：不出血、不画悬停底，只留分隔线。
 * 不变量（开发时崩溃）：表头有底色时首末字离底色边 ≥ 6。
 *
 * 动效（DESIGN.md §4.2；表体的行，子项要带稳定 key；行高不变）：
 * - 行悬停 → 一块底 fast（0.08s）跟到指针下的行，淡出 0.06s；线 80ms。
 * - 排序（指针点表头）→ 行的位置走 layout，moderate（0.16s，不过冲），可中途反向 → 减少动态时直接到位。
 * - 插入（系统 / 指针）→ 新行 opacity 0 → 1（fast）、scale .98 → 1，下面的行同一条 moderate 让位 → 减少动态时只淡入。
 * - 删除 → 原地 EXIT.fast（0.06s）淡出并缩到 .98，再由下面的行 moderate 补上；退场中的行让出悬停序号 → 减少动态时只淡出、补位直接到位
 *  （行不弹出文档流：弹出后单元格脱离列宽、表格外框的横向滚动也会把补位的行裁掉）。
 * - 键盘触发 → 0ms。
 * 位置以表体为参照（layoutRoot）：表格整体被挤动时行跟着走，只有行与行之间的换位才动。
 */
const BodyContext = React.createContext(false)

const INSTANT = { duration: 0 } as const
const MOVE = { ...SPRINGS.moderate, opacity: SPRINGS.fast, layout: SPRINGS.moderate } as const
const GENTLE = { opacity: SPRINGS.fast, layout: INSTANT, scale: INSTANT } as const
const EXIT = { opacity: 0, scale: 0.98, transition: EXIT_TIER.fast } as const
/** 表体的行按顺序登记跟随悬停；退场中的（data-exiting）与占位行（骨架、空、出错，标 data-static）不登记 */
const BODY_ROWS = ":scope > table > tbody > tr:not([data-static])"
/** rowHover={false}（只读的预览、矩阵）：一行都不登记 */
const NO_ROWS = ":scope > :not(*)"

const BLEED = 8
const FADE = "24px"
const HEAD_GAP = 6
/** 操作列的末格：只放这些可操作的东西 */
const ACTION = "button, a[href], [role=checkbox], [role=switch], [role=combobox]"

/** 一格里看得见的字（不算读屏专用字）的左右缘；没有字返回 null */
function inkOf(cell: Element) {
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
  let left = Infinity
  let right = -Infinity
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim() || n.parentElement?.closest(".sr-only")) continue
    const range = document.createRange()
    range.selectNodeContents(n)
    for (const r of range.getClientRects()) if (r.width > 0) (left = Math.min(left, r.left)), (right = Math.max(right, r.right))
  }
  return left === Infinity ? null : { left, right }
}

const painted = (el: Element) => !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(getComputedStyle(el).backgroundColor)

/** 末列是不是操作列：表头末格没有可见字；没有表头时每行末格都含按钮或链接 */
function actionColumn(table: HTMLTableElement) {
  const head = table.tHead?.rows[0]?.cells
  if (head?.length) return !inkOf(head[head.length - 1])
  const rows = [...table.tBodies].flatMap((b) => [...b.rows])
  return rows.length > 0 && rows.every((r) => r.cells[r.cells.length - 1]?.querySelector(ACTION))
}

/** 外框所在面的实际底色：往上找第一个不透明的底 */
function hostPaint(el: HTMLElement) {
  for (let a = el.parentElement; a; a = a.parentElement) {
    const c = getComputedStyle(a).backgroundColor
    const alpha = c.match(/rgba?\([^)]*,\s*([\d.]+)\)/)?.[1]
    if (painted(a) && (alpha === undefined || Number(alpha) >= 0.99)) return c
  }
  return "var(--ds-canvas)"
}

/**
 * flush 的出血区会不会被祖先裁掉（透明面、滚动区没有内边距时）：按内容线算，和现在出没出血无关，不会来回切换。
 * 会裁掉时不出血、行也不铺悬停底（只留分隔线），否则悬停底色贴字。
 */
function clipped(box: HTMLElement) {
  const b = box.getBoundingClientRect()
  const inset = box.hasAttribute("data-tight") ? 0 : BLEED
  for (let a = box.parentElement; a; a = a.parentElement) {
    if (getComputedStyle(a).overflowX === "visible") continue
    const r = a.getBoundingClientRect()
    return r.left > b.left + inset - BLEED + 0.5 || r.right < b.right - inset + BLEED - 0.5
  }
  return false
}

/** 不变量：返回违反说明，没问题返回 null */
function tableBreach(table: HTMLTableElement) {
  const row = table.tHead?.rows[0]
  if (row && row.cells.length) {
    const cells = [row.cells[0], row.cells[row.cells.length - 1]]
    for (const [i, cell] of cells.entries()) {
      const paint = [cell, row, table.tHead!].find(painted)
      const ink = paint && inkOf(cell)
      if (!paint || !ink) continue
      const r = paint.getBoundingClientRect()
      const gap = i === 0 ? ink.left - r.left : r.right - ink.right
      if (gap < HEAD_GAP - 0.5) return `表头「${cell.textContent?.trim().slice(0, 8)}」离表头底色${i === 0 ? "左" : "右"}边 ${gap.toFixed(1)}px（至少 ${HEAD_GAP}）：flush 不铺表头底，别的表别把首末格内边距清零`
    }
  }
  return null
}

/** 量横向溢出：只在真放不下时渐隐、钉操作列（直接写外框的属性，不触发重渲染） */
function useOverflow(ref: React.RefObject<HTMLDivElement | null>, flush: boolean) {
  const fail = useInvariant("Table")
  React.useLayoutEffect(() => {
    const box = ref.current
    const table = box?.querySelector<HTMLTableElement>(":scope > table")
    if (!box || !table) return
    let frame = 0
    const set = (name: string, on: boolean) => (on ? box.setAttribute(name, "") : box.removeAttribute(name))
    const update = () => {
      // 比的是表格本身的宽：行尾按钮 edge-end 推出去的几像素透明内边距不算「放不下」
      const room = box.scrollWidth - box.clientWidth
      const over = table.getBoundingClientRect().width - box.clientWidth > 1
      const pin = over && !table.hasAttribute("data-stacked") && actionColumn(table)
      const first = table.rows[0]?.cells[0]
      const start = over && box.scrollLeft > 1 && !(first && getComputedStyle(first).position === "sticky")
      const end = over && !pin && box.scrollLeft < room - 1
      set("data-pin", pin)
      set("data-tight", flush && clipped(box))
      set("data-overflow", start || end)
      box.style.setProperty("--table-fade-s", start ? FADE : "0px")
      box.style.setProperty("--table-fade-e", end ? FADE : "0px")
      if (pin) box.style.setProperty("--table-bg", hostPaint(box))
    }
    const measure = () => {
      update()
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!box.isConnected || !box.getClientRects().length) return
        const breach = tableBreach(table)
        if (breach) fail(breach)
      })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    ro.observe(table)
    box.addEventListener("scroll", update, { passive: true })
    return () => (cancelAnimationFrame(frame), ro.disconnect(), box.removeEventListener("scroll", update))
  }, [ref, flush, fail])
}

/** 只在外框量到溢出后才生效的类（data-overflow / data-pin 由 useOverflow 写） */
const OVERFLOW = [
  "data-overflow:[mask-image:linear-gradient(to_right,transparent,#000_var(--table-fade-s),#000_calc(100%_-_var(--table-fade-e)),transparent)]",
  "data-pin:[&_tr>:last-child]:sticky data-pin:[&_tr>:last-child]:right-0 data-pin:[&_tr>:last-child]:shadow-[-1px_0_0_var(--ds-line)]",
  "data-pin:[&_tbody_tr>:last-child]:bg-(--table-bg) data-pin:[&_thead_tr>:last-child]:bg-table-head data-flush:data-pin:[&_thead_tr>:last-child]:bg-(--table-bg)",
  "data-pin:[&_tbody_tr[data-fluid-hover]>:last-child]:shadow-[-1px_0_0_var(--ds-line),inset_0_0_0_100vmax_var(--ds-hover)]",
]

const TIGHT = "data-tight:mx-0 data-tight:w-full data-tight:[&_tr>:first-child]:pl-0 data-tight:[&_tr>:last-child]:pr-0 data-tight:[&>[data-slot=fluid-hover-highlight]]:hidden"

/** 正文列里的表格用 flush：首尾文字贴齐上下文的内容线（DESIGN.md §3.2），悬停底向两侧出血 8。density 把整张表钉在一档。 */
function Table({
  className,
  flush = false,
  density,
  rowHover = true,
  ...props
}: React.ComponentProps<"table"> & { flush?: boolean; density?: DensityValue; rowHover?: boolean }) {
  const box = React.useRef<HTMLDivElement>(null)
  useOverflow(box, flush)
  const hover = useFluidHover(box, { gapClick: false })
  useFluidHoverScan(hover, box, rowHover ? BODY_ROWS : NO_ROWS)
  const table = (
    <div
      ref={box}
      data-slot="table-container"
      data-flush={flush || undefined}
      className={cn("relative isolate overflow-x-auto pointer-coarse:pb-4", flush ? ["-mx-2 w-[calc(100%_+_16px)]", TIGHT] : "w-full", OVERFLOW)}
      {...hover.handlers}
    >
      <FluidHoverHighlight hover={hover} className="rounded-row" />
      <table
        data-slot="table"
        className={cn(
          "w-full caption-bottom border-collapse text-(length:--ds-text-control) leading-(--ds-lh-control)",
          flush && "[&_tr>:first-child]:pl-2 [&_tr>:last-child]:pr-2 [&>thead]:bg-transparent",
          className
        )}
        {...props}
      />
    </div>
  )
  return density ? <Density value={density}>{table}</Density> : table
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead
      data-slot="table-header"
      className={cn(
        "bg-table-head [&_tr]:border-b [&_tr]:border-table-line [&_tr]:transition-[border-color] [&_tr]:duration-(--ds-dur-fast) [&_tr]:ease-ds",
        // 第一行亮着：表头下线让给悬停底
        "[table:has(>tbody>tr:first-child[data-fluid-hover])>&_tr]:border-transparent",
        className
      )}
      {...props}
    />
}

function TableBody({ className, children, ...props }: React.ComponentProps<"tbody">) {
  return (
    <motion.tbody layout layoutRoot data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...(props as HTMLMotionProps<"tbody">)}>
      <BodyContext.Provider value>
        <AnimatePresence initial={false}>{React.Children.toArray(children)}</AnimatePresence>
      </BodyContext.Provider>
    </motion.tbody>
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  const cls = cn(
    "border-b border-table-line transition-[border-color] duration-(--ds-dur-fast) ease-ds",
    // 亮着的行和它上一行的下边线让给悬停底（表头那条见 TableHeader）
    "[tbody>&[data-fluid-hover]]:border-transparent [tbody>&:has(+tr[data-fluid-hover])]:border-transparent",
    className
  )
  if (!React.useContext(BodyContext)) return <tr data-slot="table-row" className={cls} {...props} />
  return <BodyRow className={cls} {...props} />
}

/** 表体里的行：会排序、增删。 */
function BodyRow(props: React.ComponentProps<"tr">) {
  const reduce = useReducedMotion()
  const keyboard = fromKeyboard()
  const present = useIsPresent()
  return (
    <motion.tr
      data-slot="table-row"
      data-exiting={present ? undefined : ""}
      layout="position"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={keyboard ? { opacity: 0, transition: INSTANT } : reduce ? { opacity: 0 } : EXIT}
      transition={keyboard ? INSTANT : reduce ? GENTLE : MOVE}
      {...(props as HTMLMotionProps<"tr">)}
    />
  )
}

/** 列的对齐：end = 数字、金额、日期列，右对齐、等宽数字（表头与单元格同写） */
type TableAlign = "start" | "end"

function TableHead({ className, align, ...props }: Omit<React.ComponentProps<"th">, "align"> & { align?: TableAlign }) {
  return (
    <th
      data-slot="table-head"
      data-align={align}
      className={cn(
        "h-[calc(var(--ds-h-row)-1px)] pointer-coarse:h-(--ds-h-md) px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-fg-muted first:pl-(--ds-table-edge) last:pr-(--ds-table-edge)",
        "[&:has([role=checkbox])]:w-4 [&:has([role=checkbox])]:pr-0",
        align === "end" && "text-right",
        className
      )}
      {...props}
    />
  )
}

/** muted：元数据列（创建时间、编号、邮箱、最近使用）用次级灰；其余列都是 fg（DESIGN.md §3.11） */
function TableCell({ className, align, muted = false, ...props }: Omit<React.ComponentProps<"td">, "align"> & { align?: TableAlign; muted?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      data-align={align}
      data-muted={muted || undefined}
      className={cn(
        // 行距含 1px 分隔线落在控件档上：格高 = 行高 − 1，竖向内边距 = (格高 − 行盒) / 2（36 = 5.5 + 24 + 5.5 + 1 · 28 = 3.5 + 20 + 3.5 + 1），两行的格子照常长高
        "h-[calc(var(--ds-h-row)-1px)] pointer-coarse:h-(--ds-h-md) px-3 py-[calc((var(--ds-h-row)-1px-var(--ds-lh-control))/2)] align-middle whitespace-nowrap font-normal first:pl-(--ds-table-edge) last:pr-(--ds-table-edge)",
        muted ? "text-fg-muted" : "text-fg",
        "[&:has([role=checkbox])]:w-4 [&:has([role=checkbox])]:pr-0",
        align === "end" && "text-right tabular-nums",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("border-t border-table-line px-4 pt-3 text-left text-xs text-fg-muted", className)}
      {...props}
    />
  )
}

export { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow }
export type { TableAlign }
