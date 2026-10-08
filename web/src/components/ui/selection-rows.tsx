import * as React from "react"
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, type Transition } from "motion/react"

import { cn } from "@/lib/utils"
import { EXIT, SPRINGS } from "@/components/ui/ease"
import { useFluidHover, type FluidHover, type FluidHoverOptions, type ItemRect } from "@/components/ui/fluid-hover"

/**
 * 一组可选的行（复选组、单选组、选项卡片）共用的画法（DESIGN.md K2、§4.2、§4.3「焦点」「选中」）：
 * - 行：每行写 data-row-value（这一项的值）；组按 DOM 顺序给行编号，交给跟随悬停登记（ui/fluid-hover），悬停底一块、键盘焦点也带着它走。
 * - 选中底：画在组里的一块（或几块），不画在行上。单选一块在行之间滑（moderate）；
 *   多选的相邻勾选行合成一块，桥接的那一行勾上时两块的内沿在这一行中线合拢（moderate，内角晚 0.07s 才变直），合拢后无感换成一块；
 *   取消中间一行反过来：先在中线断成两半，再各自退开。同一行只是尺寸变了（换行、变宽）直接贴过去，不重播。
 * - 焦点环：一组只有一个。键盘把焦点从一行移到另一行时，一圈环从旧行 fast 滑到新行（内收 2px），落定后交还给行自己的 outline；
 *   滑动途中行自己的 outline 透明（样式还在，开发时的焦点守卫照常量得到），落定的那一刻两者同位同形，看不出交接。
 *   只在 :focus-visible 时出现；指针点的不画；减少动态时环直接出现在新行上。
 * - 勾与点收回用同一个短过渡 RETRACT：比 fast 档的退场（0.06s）再短一截，画出（0.08s）总比收回长，读起来是「收」而不是「倒放」。
 */

/** 勾、单选点收回：0.04s easeIn（档外的值：收回要比画出短一半，fast 档的退场 0.06 仍显拖沓） */
const RETRACT = { type: "tween", duration: 0.04, ease: "easeIn" } as const
/** 勾画出：fast 档的时长，easeOut（pathLength 是一次性的描画，用过渡不用弹簧，画出总比收回长） */
const DRAW = { type: "tween", duration: 0.08, ease: "easeOut" } as const
/** 合拢时内角比边晚多久变直（两半相碰之前保持圆角） */
const CORNER_DELAY = 0.07
/** 合拢 / 断开完成后换形的时机：边的 moderate 0.16s（合拢再加内角的延迟）+ 80ms 余量，宁晚不早，换形时两半早已相碰 */
const MERGE_MS = (0.16 + CORNER_DELAY) * 1000 + 80
const SPLIT_MS = 0.16 * 1000 + 80
const ROW = "data-row-value"
const GROUP = "data-row-group"
const SNAP = { duration: 0 } as const

const box = (r: ItemRect) => ({ x: r.left, y: r.top, width: r.width, height: r.height })
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i])

type Trail = { key: number; from: ItemRect; to: number }

type RowGroup<T extends HTMLElement> = {
  ref: React.RefObject<T | null>
  hover: FluidHover
  /** 行的值，按 DOM 顺序；序号就是跟随悬停里的序号 */
  order: readonly string[]
  /** 行自己的圆角（像素，量出来的），合并块按它画 */
  radius: number
  trail: Trail | null
  endTrail: (key: number) => void
  /** 摊在容器上：跟随悬停的指针事件 + 焦点 */
  handlers: FluidHover["handlers"] & { onFocus: (e: React.FocusEvent) => void; onBlur: (e: React.FocusEvent) => void }
  /** 摊在每一行上 */
  rowProps: (value: string) => { [ROW]: string; "data-focus-trail"?: ""; ref?: (el: HTMLElement | null) => void }
}

function useRowGroup<T extends HTMLElement>(options: FluidHoverOptions = {}): RowGroup<T> {
  const ref = React.useRef<T>(null)
  const hover = useFluidHover(ref, options)
  const reduce = useReducedMotion() ?? false
  const [order, setOrder] = React.useState<readonly string[]>([])
  const [radius, setRadius] = React.useState(0)
  const [trail, setTrail] = React.useState<Trail | null>(null)
  const lastRing = React.useRef<number | null>(null)
  const trailKey = React.useRef(0)

  // 每次提交后按 DOM 顺序重排行（嵌在别的组里的行不算）；行的圆角也在这时量
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rows = [...el.querySelectorAll<HTMLElement>(`[${ROW}]`)].filter((n) => n.closest(`[${GROUP}]`) === el)
    const next = rows.map((n) => n.getAttribute(ROW) ?? "")
    setOrder((prev) => (sameList(prev, next) ? prev : next))
    const r = rows[0] ? parseFloat(getComputedStyle(rows[0]).borderTopLeftRadius) || 0 : 0
    setRadius((prev) => (prev === r ? prev : r))
  })

  const endTrail = React.useCallback((key: number) => setTrail((t) => (t?.key === key ? null : t)), [])
  // 后台标签页会卡住 rAF：动画完成回调不来时按 fast 档时长 + 余量收掉
  React.useEffect(() => {
    if (!trail) return
    const timer = setTimeout(() => endTrail(trail.key), 80 + 160)
    return () => clearTimeout(timer)
  }, [trail, endTrail])

  const indexOf = (target: EventTarget | null) => {
    const row = (target as HTMLElement | null)?.closest?.<HTMLElement>(`[${ROW}]`)
    if (!row || row.closest(`[${GROUP}]`) !== ref.current) return { row: null, index: -1 }
    return { row, index: order.indexOf(row.getAttribute(ROW) ?? "") }
  }

  const onFocus = (e: React.FocusEvent) => {
    const { row, index } = indexOf(e.target)
    if (!row || index < 0) return
    hover.setActiveIndex(index)
    const visible = e.target === row && row.matches(":focus-visible")
    const last = lastRing.current
    lastRing.current = visible ? index : null
    const from = last === null ? undefined : hover.itemRects[last]
    if (!visible || reduce || last === index || !from || !hover.itemRects[index]) return setTrail(null)
    // 途中又换了行：同一圈环改目标，从当前位置、当前速度接着走
    setTrail((t) => (t ? { ...t, to: index } : { key: ++trailKey.current, from, to: index }))
  }
  const onBlur = (e: React.FocusEvent) => {
    if (ref.current?.contains(e.relatedTarget as Node | null)) return
    lastRing.current = null
    setTrail(null)
    hover.setActiveIndex(null)
  }

  const rowProps = (value: string) => {
    const index = order.indexOf(value)
    return {
      [ROW]: value,
      ...(trail && trail.to === index ? { "data-focus-trail": "" as const } : {}),
      ...(index >= 0 ? { ref: hover.itemRef(index) } : {}),
    }
  }

  return { ref, hover, order, radius, trail, endTrail, handlers: { ...hover.handlers, onFocus, onBlur }, rowProps }
}

/** 容器上必写的属性：给 useRowGroup 认组（不写的话行找不到组） */
const rowGroupAttr = { [GROUP]: "" } as const

/** 一圈滑动的焦点环（只在键盘把焦点从一行移到另一行的那一下出现）；圆角写行的圆角类 */
function FocusTrail({ group, className }: { group: Pick<RowGroup<HTMLElement>, "trail" | "hover" | "endTrail">; className?: string }) {
  const { trail, hover, endTrail } = group
  const to = trail ? hover.itemRects[trail.to] : undefined
  if (!trail || !to) return null
  return (
    <motion.div
      key={trail.key}
      aria-hidden
      data-slot="focus-trail"
      className={cn("focus-ring pointer-events-none absolute top-0 left-0 z-10", className)}
      initial={box(trail.from)}
      animate={box(to)}
      transition={SPRINGS.fast}
      onAnimationComplete={() => endTrail(trail.key)}
    />
  )
}

/** 单选的选中底：一块，换选中时从旧行滑到新行（moderate）；第一次有选中时原地淡入，挂载时已选中的直接到位 */
function SelectionBlock({ group, index, className }: { group: Pick<RowGroup<HTMLElement>, "hover">; index: number; className?: string }) {
  const reduce = useReducedMotion() ?? false
  const { itemRects, isMeasured } = group.hover
  const rect = index >= 0 && isMeasured ? itemRects[index] : undefined
  // 上一次画在哪一行：同一行只是尺寸变了就直接贴过去
  const last = React.useRef<number | null>(null)
  const seen = React.useRef(false)
  const moved = last.current !== null && last.current !== index
  React.useLayoutEffect(() => {
    if (!rect) return
    last.current = index
    seen.current = true
  })
  const position: Transition = reduce || !moved ? SNAP : SPRINGS.moderate
  return (
    <AnimatePresence>
      {rect && (
        <motion.div
          key="selected"
          aria-hidden
          data-slot="selection-block"
          className={cn("pointer-events-none absolute top-0 left-0 -z-10 bg-selected", className)}
          initial={seen.current ? { opacity: 0, ...box(rect) } : false}
          animate={{ opacity: 1, ...box(rect) }}
          exit={{ opacity: 0, transition: EXIT.fast }}
          transition={{ ...position, opacity: SPRINGS.fast }}
        />
      )}
    </AnimatePresence>
  )
}

/* ── 多选：相邻勾选行合成一块 ─────────────────────────────── */

type Run = { start: number; end: number; id: number }
type Radii = [number, number, number, number] // 左上、右上、右下、左下
type Block = {
  key: string
  top: number
  left: number
  width: number
  height: number
  radii: Radii
  /** 换形那一下直接到位（看不出来） */
  instant?: boolean
  /** 被吸收的那半：换形后不淡出，直接拿掉 */
  dropInstant?: boolean
  /** 合拢时内角晚一点变直 */
  lateCorners?: boolean
  opacity?: number
  /** 新挂上的块从哪里长出来（断开的下半块从中线、合拢的下半块带着圆角） */
  enter?: { top: number; height: number; radii: Radii }
}
type Boundary = { tid: number; kind: "merge" | "split"; keep: number; other: number; gap: number; phase: "converge" | "commit" | "pinned" | "apart" }

/** 勾选的行号 → 连续段；段的 id 在重渲染之间保持（任一行上次属于哪段就沿用那段的 id），块才会伸缩而不是重来 */
function useRuns(checked: readonly number[]): Run[] {
  const owner = React.useRef(new Map<number, number>())
  const counter = React.useRef(0)
  const runs: { start: number; end: number }[] = []
  for (const i of [...checked].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1]
    if (last && i === last.end + 1) last.end = i
    else runs.push({ start: i, end: i })
  }
  const used = new Set<number>()
  const next = new Map<number, number>()
  const result = runs.map((run) => {
    let id: number | undefined
    for (let i = run.start; i <= run.end && id === undefined; i++) {
      const prev = owner.current.get(i)
      if (prev !== undefined && !used.has(prev)) id = prev
    }
    id ??= ++counter.current
    used.add(id)
    for (let i = run.start; i <= run.end; i++) next.set(i, id)
    return { ...run, id }
  })
  owner.current = next
  return result
}

/** outer 里正好两段、中间隔一行（一次点击能合拢或断开的唯一形状） */
function bridge(outer: Run, runs: readonly Run[]) {
  const inside = runs.filter((r) => r.start >= outer.start && r.end <= outer.end).sort((a, b) => a.start - b.start)
  if (inside.length !== 2) return null
  const [up, lo] = inside
  return lo.start === up.end + 2 ? { up, lo, gap: up.end + 1 } : null
}

function useMergedBlocks(runs: Run[], rects: readonly (ItemRect | undefined)[], R: number): Block[] {
  const [active, setActive] = React.useState<Boundary[]>([])
  const committed = React.useRef<Run[]>([])
  const tid = React.useRef(0)
  const timers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const sig = runs.map((r) => `${r.id}:${r.start}-${r.end}`).join("|")

  React.useLayoutEffect(() => {
    const prev = committed.current
    const found: Boundary[] = []
    for (const c of runs) {
      const p = bridge(c, prev)
      if (p && (c.id === p.up.id || c.id === p.lo.id))
        found.push({ tid: ++tid.current, kind: "merge", keep: c.id, other: c.id === p.up.id ? p.lo.id : p.up.id, gap: p.gap, phase: "converge" })
    }
    for (const p of prev) {
      const c = bridge(p, runs)
      if (c) found.push({ tid: ++tid.current, kind: "split", keep: c.up.id, other: c.lo.id, gap: c.gap, phase: "pinned" })
    }
    committed.current = runs.map((r) => ({ ...r }))
    // 到时间换形（合拢 → 一块；断开 → 撤掉记录）：用计时而不是动画完成回调，连点时目标不变的动画不回调，会留下半块
    for (const b of found)
      timers.current.set(
        b.tid,
        setTimeout(() => {
          timers.current.delete(b.tid)
          setActive((list) => list.flatMap((x) => (x.tid !== b.tid ? [x] : x.kind === "merge" ? [{ ...x, phase: "commit" as const }] : [])))
        }, b.kind === "merge" ? MERGE_MS : SPLIT_MS)
      )
    const valid = (b: Boundary) =>
      b.kind === "merge"
        ? runs.some((c) => c.id === b.keep && b.gap > c.start && b.gap < c.end)
        : runs.some((c) => c.id === b.keep && c.end === b.gap - 1) && runs.some((c) => c.id === b.other && c.start === b.gap + 1)
    setActive((list) => {
      for (const b of list) {
        if (valid(b)) continue
        clearTimeout(timers.current.get(b.tid))
        timers.current.delete(b.tid)
      }
      return [...list.filter(valid), ...found]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  React.useEffect(() => {
    const all = timers.current
    return () => all.forEach(clearTimeout)
  }, [])

  // 绘制之后推进一步：断开的两半在中线停过一帧再退开；换过形的合拢记录拿掉
  React.useEffect(() => {
    if (!active.some((b) => b.phase === "pinned" || b.phase === "commit")) return
    setActive((list) => list.flatMap((b) => (b.phase === "commit" ? [] : [{ ...b, phase: b.phase === "pinned" ? ("apart" as const) : b.phase }])))
  }, [active])

  const blocks: Block[] = []
  for (const run of runs) {
    const s = rects[run.start]
    const e = rects[run.end]
    if (!s || !e) continue
    blocks.push({ key: `run-${run.id}`, top: s.top, left: Math.min(s.left, e.left), width: Math.max(s.width, e.width), height: e.top + e.height - s.top, radii: [R, R, R, R] })
  }
  const byKey = new Map(blocks.map((b) => [b.key, b]))
  /** 断开的第一帧：上下两半都钉在中线（和原来那一块一模一样），下一帧再各自退开 */
  const pin = (up: Block, lo: Block, mid: number) => {
    const bottom = lo.top + lo.height
    Object.assign(up, { height: mid - up.top, radii: [R, R, 0, 0], instant: true })
    Object.assign(lo, { top: mid, height: bottom - mid, radii: [0, 0, R, R], instant: true, enter: { top: mid, height: bottom - mid, radii: [0, 0, R, R] } })
  }
  for (const b of active) {
    const gap = rects[b.gap]
    const keep = byKey.get(`run-${b.keep}`)
    if (!gap || !keep) continue
    const mid = gap.top + gap.height / 2
    if (b.kind === "merge") {
      const bottom = keep.top + keep.height
      if (b.phase === "commit") {
        // 换形：留下的那块直接盖满整段（上半 + 下半已经盖着），被吸收的下半透明留一帧再拿掉，不闪
        keep.instant = true
        blocks.push({ key: `run-${b.other}`, top: mid, left: keep.left, width: keep.width, height: bottom - mid, radii: [0, 0, R, R], instant: true, dropInstant: true, opacity: 0 })
        continue
      }
      Object.assign(keep, { height: mid - keep.top, radii: [R, R, 0, 0], lateCorners: true })
      blocks.push({
        key: `run-${b.other}`, top: mid, left: keep.left, width: keep.width, height: bottom - mid, radii: [0, 0, R, R], dropInstant: true, lateCorners: true,
        enter: { top: mid, height: bottom - mid, radii: [R, R, R, R] },
      })
    } else if (b.phase === "pinned") {
      const lo = byKey.get(`run-${b.other}`)
      if (lo) pin(keep, lo, mid)
    }
  }
  // 断开的那一次渲染里记录还没进状态（检测在提交之后）：这里按上次提交的段直接认出来，下半块一挂上就在中线，不先闪到终点
  for (const p of committed.current) {
    const c = bridge(p, runs)
    const gap = c && rects[c.gap]
    const up = c && byKey.get(`run-${c.up.id}`)
    const lo = c && byKey.get(`run-${c.lo.id}`)
    if (gap && up && lo) pin(up, lo, gap.top + gap.height / 2)
  }
  return blocks
}

/** 多选的选中底：一段一块；圆角按行的圆角（量出来的）画，合拢 / 断开时每个角单独动 */
function MergedSelection({ group, checked, className }: { group: Pick<RowGroup<HTMLElement>, "hover" | "radius">; checked: readonly number[]; className?: string }) {
  const reduce = useReducedMotion() ?? false
  const runs = useRuns(checked)
  const blocks = useMergedBlocks(runs, group.hover.itemRects, group.radius)
  if (!group.hover.isMeasured) return null
  return (
    <AnimatePresence initial={false}>
      {blocks.map((b) => (
        <RunBlock key={b.key} block={b} reduce={reduce} className={className} />
      ))}
    </AnimatePresence>
  )
}

/** 一块选中底。四个角是各自的动画值：合拢时内角晚一点变直，换形那一下直接到位 */
function RunBlock({ block: b, reduce, className }: { block: Block; reduce: boolean; className?: string }) {
  const start = b.enter?.radii ?? b.radii
  const tl = useMotionValue(start[0])
  const tr = useMotionValue(start[1])
  const br = useMotionValue(start[2])
  const bl = useMotionValue(start[3])
  const instant = Boolean(b.instant) || reduce
  React.useEffect(() => {
    const corner = b.lateCorners ? { ...SPRINGS.moderate, delay: CORNER_DELAY } : SPRINGS.moderate
    const all = [tl, tr, br, bl]
    const runs = all.map((mv, i) => (instant ? (mv.jump(b.radii[i]), undefined) : animate(mv, b.radii[i], corner)))
    return () => runs.forEach((r) => r?.stop())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.radii.join(), instant, b.lateCorners])
  const edges: Transition = instant ? SNAP : SPRINGS.moderate
  return (
    <motion.div
      aria-hidden
      data-slot="selection-block"
      className={cn("pointer-events-none absolute top-0 left-0 -z-10 bg-selected", className)}
      style={{ borderTopLeftRadius: tl, borderTopRightRadius: tr, borderBottomRightRadius: br, borderBottomLeftRadius: bl }}
      initial={b.enter ? { opacity: b.opacity ?? 1, x: b.left, y: b.enter.top, width: b.width, height: b.enter.height } : { opacity: 0, x: b.left, y: b.top, width: b.width, height: b.height }}
      animate={{ opacity: b.opacity ?? 1, x: b.left, y: b.top, width: b.width, height: b.height }}
      exit={{ opacity: 0, transition: b.dropInstant ? SNAP : EXIT.moderate }}
      transition={{ ...edges, opacity: b.opacity === 0 ? SNAP : SPRINGS.fast }}
    />
  )
}

/**
 * 选中的字变 600（80ms）；一份隐形的 600 副本占住宽度，不挤动旁边（DESIGN.md §4.1）。
 * muted：没选时字是 fg-muted，选中或这一行亮着（跟随悬停、键盘焦点，行上写 group/row）时变 fg。medium：没选时 500（卡片标题）。
 */
function WeightLabel({ on, muted = true, medium = false, className, children }: { on: boolean; muted?: boolean; medium?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("grid min-w-0", className)}>
      <span aria-hidden className="invisible col-start-1 row-start-1 truncate font-semibold">
        {children}
      </span>
      <span
        className={cn(
          "col-start-1 row-start-1 truncate transition-[color,font-weight] duration-(--ds-dur-fast) ease-ds",
          on ? "font-semibold text-fg" : cn(medium ? "font-medium" : "font-normal", muted ? "text-fg-muted group-data-fluid-hover/row:text-fg" : "text-fg")
        )}
      >
        {children}
      </span>
    </span>
  )
}

export { useRowGroup, rowGroupAttr, FocusTrail, SelectionBlock, MergedSelection, WeightLabel, RETRACT, DRAW }
export type { RowGroup }
