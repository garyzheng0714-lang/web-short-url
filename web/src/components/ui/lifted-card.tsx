import * as React from "react"
import { animate, motion, useMotionValue, useReducedMotion, type MotionValue, type Transition } from "motion/react"

import { cn } from "@/lib/utils"
import { EASE_OUT, EXIT, SPRINGS } from "@/components/ui/ease"
import { rubberband } from "@/components/ui/stretch"

/**
 * 当前项的标记（DESIGN.md K6、§4.3「当前」、§4.2）。三种：
 * - fill（默认）：灰底 bg-selected，放在当前项里面、内容之下，直接出现、不滑动。用在导航、列表、分页。
 * - pill：没有轨道，当前项是一块胶囊底（bg-selected），在项之间滑动。标签页用它（用户 2026-10-07：标签页是胶囊）。
 * - raised：凹槽轨道里一块凸起的胶囊（浅色白底 + shadow-raised，深色比轨道亮一级），在项之间滑动。分段切换、计费周期用它。
 *
 * pill / raised 放在轨道里（轨道 relative isolate，项是轨道的直接子元素），整条轨道一块；它自己从 DOM 找当前项
 * （data-state=on / active / checked、aria-selected、aria-checked、aria-pressed、aria-current），不用传值。轨道里画三层，都 aria-hidden：
 * 1. 当前胶囊 [data-slot=lift]：换项 moderate（0.16s、临界阻尼，落点不过冲）滑过去；位置、宽高一起走，不拉伸。
 *    乐观先走：指针在别的项上按下的当帧就滑向它，不等受控值回来；松手后值没变（拖出去松手、使用方拒绝）就滑回真正的当前项。
 * 2. 悬停胶囊 [data-slot=lift-hover]：指针停在别的项上时，从当前胶囊的位置出发（透明 0），fast（0.08s）跟到那一项，透明度到 0.4（80ms）；
 *    指针在项之间的空隙、轨道内边距里也落到最近的一项（DESIGN.md K2），点空隙 = 点亮着的那项。
 *    指针离开轨道 → 滑回当前胶囊（moderate）同时 60ms 淡出；指针停回当前项 → 原地淡出（0.06s）。有别的项被悬停时当前胶囊淡到 dim（80ms）。
 *    被悬停的项带 data-lift-hover，文字 fg-muted → fg、图标线 1.5 → 2 由它驱动（liftItem）。键盘焦点也算悬停（和指针共用一块底）。触屏不悬停。
 * 3. 焦点环 [data-slot=lift-ring]：键盘把焦点从一项移到另一项时，一个 2px 外侧环从旧项 fast 滑到新项；到了以后交还给项自己的 outline
 *    （focus-ring-out），途中项自己的环透明（data-ring-travel）。只在 :focus-visible 时出现；从轨道外 Tab 进来直接出现在项上。
 * raised 传 onPick 时可以拖：按住当前项左右拖，胶囊中心跟手（fast），宽度在相邻两项之间插值，拖过两端橡皮筋；
 * 松手按中心吸到最近一项（moderate，带着拖动的速度）。按住当前项时胶囊压平（shadow-pressed，80ms 进 / 180ms 回），不缩放（§4.1）。
 * 尺寸变化（字体加载、窗口变宽）→ 直接贴到新位置，不动画。减少动态 → 组件自己读 useReducedMotion()：位置一步到位，只留透明度。
 * 键盘换项与指针同一档（DESIGN.md K3）。只动 transform 与透明度；宽高是绝对定位小块（contain: layout），不牵动轨道排版。
 */

const CURRENT =
  ":scope > :is([data-state=on], [data-state=active], [data-state=checked], [aria-selected=true], [aria-checked=true], [aria-pressed=true], [aria-current]:not([aria-current=false]))"
const ITEMS = ":scope > :not([data-slot^=lift])"
const ENABLED = ":not([data-disabled]):not(:disabled):not([aria-disabled=true])"
/** 悬停胶囊的透明度（DESIGN.md §4.3「当前」） */
const HOVER_OPACITY = 0.4
/** 透明度：出现走 fast 全长（80ms），消失走 fast 的退场（60ms）；模糊、透明这类不跟手的量用短过渡 */
const FADE_IN: Transition = { type: "tween", duration: 0.08, ease: EASE_OUT }
const FADE_OUT: Transition = EXIT.fast

/** raised 的底：浅色是白卡；深色的卡比凹槽轨道还暗，改成叠在轨道上的 well-hover，任何底上都比轨道亮一级 */
const RAISED =
  "bg-card shadow-raised dark:bg-well-hover transition-shadow duration-(--ds-dur-press-release) ease-ds data-pressed:shadow-pressed data-pressed:duration-(--ds-dur-press)"

/** 轨道项始终用文字色（旧写法：标签栏 tab-bar 仍在用）；新的轨道项用 liftItem */
const liftInk = "text-fg [&_svg]:text-fg"

/**
 * 胶囊轨道里的项（标签页、分段、计费周期）：DESIGN.md §3.1、§4.3、§4.5。
 * 高度由调用方给固定值（不靠 py）；胶囊 rounded-full；横向 12 · 紧凑 8（--ds-pad-x-icon）；字与图标随区域密度。
 * 平时 fg-muted，被悬停（data-lift-hover）或当前时 fg，80ms；图标线 1.5 → 2，80ms；当前项文字 600 见 LiftLabel。
 * 焦点：外侧 2px 环（focus-ring-out），换项时由轨道里的环滑过去。
 */
const liftItem = cn(
  "group/lift relative z-10 inline-flex shrink-0 items-center justify-center rounded-full whitespace-nowrap outline-none select-none",
  "gap-(--ds-gap-control) px-(--ds-pad-x-icon) text-(length:--ds-text-control) leading-(--ds-lh-control) [font-weight:var(--ds-weight-control)]",
  "text-fg-muted transition-colors duration-(--ds-dur-fast) ease-ds",
  "data-lift-hover:text-fg aria-selected:text-fg aria-checked:text-fg aria-pressed:text-fg aria-[current=page]:text-fg",
  "[&_svg]:size-(--ds-icon) [&_svg]:shrink-0 [&_svg.lucide]:transition-[stroke-width] [&_svg.lucide]:duration-(--ds-dur-fast) [&_svg.lucide]:ease-ds",
  "data-lift-hover:[&_svg.lucide]:stroke-2 aria-selected:[&_svg.lucide]:stroke-2 aria-checked:[&_svg.lucide]:stroke-2 aria-pressed:[&_svg.lucide]:stroke-2",
  "focus-visible:focus-ring-out data-ring-travel:outline-transparent",
  "disabled:pointer-events-none disabled:opacity-40"
)

const BOLD = "group-aria-selected/lift:font-semibold group-aria-checked/lift:font-semibold group-aria-pressed/lift:font-semibold group-aria-[current=page]/lift:font-semibold"

/**
 * 项里的文字：当前项变 600 不挤动旁边（DESIGN.md §4.1）。每段文字是同一格里的两层：可见的那层 80ms 换字重，
 * 隐形的 600 副本占住宽度。副本是 ::after 的生成内容（替代文字为空）：不进 textContent、不进可访问名，脚本按文字找项照常。
 * 只处理文字节点；图标、计数这类元素原样放（计数不加粗）。
 */
function LiftLabel({ children }: { children?: React.ReactNode }) {
  return (
    <>
      {React.Children.map(children, (child) =>
        typeof child === "string" || typeof child === "number" ? (
          String(child).trim() ? (
            <span
              data-text={child}
              className="inline-grid after:invisible after:col-start-1 after:row-start-1 after:font-semibold after:content-[attr(data-text)_/_'']"
            >
              <span className={cn("col-start-1 row-start-1 transition-[font-weight] duration-(--ds-dur-fast) ease-ds", BOLD)}>{child}</span>
            </span>
          ) : null
        ) : (
          child
        )
      )}
    </>
  )
}

type Rect = { x: number; y: number; w: number; h: number }
const rectOf = (el: HTMLElement): Rect => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight })
const same = (a: Rect | null, b: Rect) => !!a && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

type Box = { x: MotionValue<number>; y: MotionValue<number>; w: MotionValue<number>; h: MotionValue<number>; o: MotionValue<number> }
function useBox(opacity: number): Box {
  return { x: useMotionValue(0), y: useMotionValue(0), w: useMotionValue(0), h: useMotionValue(0), o: useMotionValue(opacity) }
}
const now = (b: Box): Rect => ({ x: b.x.get(), y: b.y.get(), w: b.w.get(), h: b.h.get() })

function LiftedCard({
  group,
  variant = "fill",
  className,
  onPick,
  dim,
}: {
  group: string
  variant?: "fill" | "pill" | "raised"
  /** 圆角，与所在的项一致（轨道项是 rounded-full） */
  className?: string
  /** 仅 raised：传了就能拖胶囊，松手时回传吸到的那一项 */
  onPick?: (item: HTMLElement) => void
  /** 有别的项被悬停时当前胶囊淡到多少：pill 0.85，raised 0.8 */
  dim?: number
}) {
  if (variant === "fill") {
    return <span aria-hidden data-slot="lift" className={cn("absolute inset-0 z-0 bg-selected", className)} />
  }
  return <SlidingLift group={group} raised={variant === "raised"} className={className} onPick={variant === "raised" ? onPick : undefined} dim={dim ?? (variant === "raised" ? 0.8 : 0.85)} />
}

function SlidingLift({ group, raised, className, onPick, dim }: { group: string; raised: boolean; className?: string; onPick?: (item: HTMLElement) => void; dim: number }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const ringRef = React.useRef<HTMLSpanElement>(null)
  const sel = useBox(1)
  const hov = useBox(0)
  const ring = useBox(0)
  const reduce = useReducedMotion() ?? false
  // 回调、减少动态、dim 在渲染之间会变；监听只挂一次，从 ref 里读最新的
  const latest = React.useRef({ onPick, reduce, dim })
  React.useLayoutEffect(() => {
    latest.current = { onPick, reduce, dim }
  })

  React.useLayoutEffect(() => {
    const lift = ref.current
    const track = lift?.parentElement
    if (!lift || !track) return
    const doc = track.ownerDocument
    const win = doc.defaultView ?? window
    const runs = new Map<MotionValue<number>, { stop: () => void }>()
    /** 一个量走到 to：减少动态时位置一步到位（透明度照常过渡）；animate 从当前值、当前速度接着走 */
    const go = (v: MotionValue<number>, to: number, t: Transition, motionOnly = true) => {
      runs.get(v)?.stop()
      if (motionOnly && latest.current.reduce) return v.jump(to)
      runs.set(v, animate(v, to, t))
    }
    const moveBox = (b: Box, r: Rect, t: Transition | null) => {
      for (const [k, to] of [["x", r.x], ["y", r.y], ["w", r.w], ["h", r.h]] as const) t ? go(b[k], to, t) : (runs.get(b[k])?.stop(), b[k].jump(to))
    }

    // 每一项的位置：换项、尺寸变化时量一次；动画的每一帧只读这份缓存，不碰布局
    let cells: { el: HTMLElement; r: Rect }[] = []
    const measure = () => (cells = [...track.querySelectorAll<HTMLElement>(ITEMS)].map((el) => ({ el, r: rectOf(el) })))
    const rectFor = (el: HTMLElement | null) => (el ? (cells.find((c) => c.el === el)?.r ?? null) : null)
    const itemOf = (node: EventTarget | null) => {
      let n = node instanceof Element ? node : null
      while (n && n.parentElement !== track) n = n.parentElement
      return n instanceof HTMLElement && !n.dataset.slot?.startsWith("lift") ? n : null
    }
    const enabled = (el: HTMLElement | null) => !!el && el.matches(ENABLED)

    let target: Rect | null = null
    let optimistic: HTMLElement | null = null
    let hovered: HTMLElement | null = null
    let hoverShown = false
    let pointerInside = false
    let ringItem: HTMLElement | null = null
    let drag: { x: number; center: number; zoom: number; moved: boolean } | null = null
    let swallowClick = false

    const current = () => track.querySelector<HTMLElement>(CURRENT)
    const selected = () => optimistic ?? current()

    /** 当前胶囊的透明度：有别的项被悬停时淡到 dim */
    const dimSelected = () => go(sel.o, hoverShown ? latest.current.dim : 1, FADE_IN, false)

    /** 贴到当前项。animated：由换项引起；否则是首帧或尺寸变化，直接贴上 */
    const place = (animated: boolean) => {
      const item = selected()
      const r = rectFor(item)
      lift.style.visibility = item && r ? "" : "hidden"
      if (!item || !r) return void (target = null)
      if (same(target, r)) return
      const first = !target
      target = r
      if (drag?.moved) return
      moveBox(sel, r, first || !animated ? null : SPRINGS.moderate)
      // 悬停的就是新的当前项：悬停胶囊原地淡出
      if (hoverShown && hovered === item) hideHover(false)
    }

    const setHoverAttr = (el: HTMLElement | null) => {
      if (hovered === el) return
      hovered?.removeAttribute("data-lift-hover")
      hovered = el
      el?.setAttribute("data-lift-hover", "")
    }
    /** 悬停胶囊离开：back = 滑回当前胶囊（指针离开轨道）；否则原地淡出 */
    function hideHover(back: boolean) {
      if (!hoverShown) return
      hoverShown = false
      if (back && target) {
        moveBox(hov, target, SPRINGS.moderate)
        go(hov.o, 0, FADE_OUT, false)
      } else go(hov.o, 0, FADE_OUT, false)
      dimSelected()
    }
    /** 悬停到 el（指针或键盘焦点）：别的项上 → 从当前胶囊出发跟过去；当前项上 → 淡掉 */
    const hoverTo = (el: HTMLElement | null) => {
      if (el && !enabled(el)) el = null
      setHoverAttr(el)
      const r = rectFor(el)
      if (!el || !r || el === selected()) return hideHover(false)
      if (!hoverShown) {
        // 每次出现都从当前胶囊出发（透明 0），读起来是「从当前的选择走出去」
        moveBox(hov, target ?? r, null)
        hov.o.jump(0)
        hoverShown = true
      }
      moveBox(hov, r, SPRINGS.fast)
      go(hov.o, HOVER_OPACITY, FADE_IN, false)
      dimSelected()
    }

    /** 指针下的项：在里面的优先，否则中心最近（空隙、内边距里也落到一项） */
    const pick = (e: PointerEvent) => {
      const box = track.getBoundingClientRect()
      const zoom = box.width / track.offsetWidth || 1
      const px = (e.clientX - box.left) / zoom - track.clientLeft + track.scrollLeft
      const py = (e.clientY - box.top) / zoom - track.clientTop + track.scrollTop
      let best: HTMLElement | null = null
      let d = Infinity
      for (const { el, r } of cells) {
        if (!enabled(el)) continue
        if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return el
        const dist = Math.hypot(px - (r.x + r.w / 2), py - (r.y + r.h / 2))
        if (dist < d) [d, best] = [dist, el]
      }
      return best
    }

    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return
      pointerInside = true
      if (!drag?.moved) hoverTo(pick(e))
    }
    const leave = (e: PointerEvent) => {
      if (e.pointerType === "touch") return
      pointerInside = false
      setHoverAttr(null)
      hideHover(true)
    }

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      const item = itemOf(e.target) ?? (e.pointerType === "touch" ? null : hovered)
      if (!item || !enabled(item)) return
      const cur = current()
      if (item !== cur) {
        // 乐观先走：按下的当帧滑向它，不等受控值回来（DESIGN.md K2）
        optimistic = item
        place(true)
        return
      }
      if (!raised) return
      lift.setAttribute("data-pressed", "")
      if (latest.current.onPick) {
        const zoom = track.getBoundingClientRect().width / track.offsetWidth || 1
        drag = { x: e.clientX, center: sel.x.get() + sel.w.get() / 2, zoom, moved: false }
      }
    }

    /** 胶囊中心在 c 时的位置：宽度在相邻两项之间按中心插值；拖过两端按橡皮筋收住，靠墙那边贴住轨道内沿 */
    const edgesAt = (c: number) => {
      const items = cells.filter(({ el }) => enabled(el)).map(({ r }) => r)
      const first = items[0]
      const last = items.at(-1)!
      const mid = items.map((r) => r.x + r.w / 2)
      const x = rubberband(c, mid[0], mid.at(-1)!, first.w)
      let i = 0
      while (i < mid.length - 2 && x > mid[i + 1]) i++
      const t = mid.length > 1 ? Math.min(1, Math.max(0, (x - mid[i]) / (mid[i + 1] - mid[i]))) : 0
      const next = items[Math.min(i + 1, items.length - 1)]
      const w = items[i].w * (1 - t) + next.w * t
      const left = Math.max(first.x, x - w / 2)
      const right = Math.min(last.x + last.w, x + w / 2)
      return { x: left, w: right - left }
    }

    const move = (e: PointerEvent) => {
      if (!drag) return
      const dx = (e.clientX - drag.x) / drag.zoom
      if (!drag.moved && Math.abs(dx) < 3) return
      if (!drag.moved) hideHover(false)
      drag.moved = true
      const to = edgesAt(drag.center + dx)
      go(sel.x, to.x, SPRINGS.fast)
      go(sel.w, to.w, SPRINGS.fast)
    }

    /** 松手后受控值没跟上（拖出去松手、使用方拒绝）：滑回真正的当前项。点击已在同一任务里提交，所以等一个宏任务 */
    let reconcile = 0
    const up = () => {
      lift.removeAttribute("data-pressed")
      win.clearTimeout(reconcile)
      reconcile = win.setTimeout(() => {
        if (!optimistic) return
        optimistic = null
        place(true)
      })
      const d = drag
      drag = null
      if (!d?.moved) return
      // 这一下是拖动，不算点击；松手时按位置决定去哪一项
      swallowClick = true
      win.setTimeout(() => (swallowClick = false))
      const center = sel.x.get() + sel.w.get() / 2
      const nearest = cells
        .filter(({ el }) => enabled(el))
        .reduce<(typeof cells)[number] | null>((b, c) => (!b || Math.abs(c.r.x + c.r.w / 2 - center) < Math.abs(b.r.x + b.r.w / 2 - center) ? c : b), null)?.el
      if (nearest && nearest !== current()) {
        latest.current.onPick?.(nearest)
        // 使用方改了状态才会落到 place()；先按松手的速度吸过去
        const r = rectFor(nearest)
        if (r) moveBox(sel, r, SPRINGS.moderate)
        target = r
      } else if (target) moveBox(sel, target, SPRINGS.moderate)
    }

    const click = (e: MouseEvent) => {
      if (swallowClick) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      // 点在空隙、内边距里 = 点亮着的那一项（DESIGN.md K2）。标签页在 mousedown 时切换，补发一次
      if (itemOf(e.target) || !hovered || !enabled(hovered)) return
      const el = hovered
      if (el.getAttribute("role") === "tab") el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, view: win }))
      el.click()
    }

    /** 焦点环：键盘在项之间移动时从旧项滑到新项，到了交还给项自己的 outline */
    const ringTo = (el: HTMLElement) => {
      const from = ringItem && ringItem !== el ? ringItem : null
      ringItem?.removeAttribute("data-ring-travel")
      ringItem = el
      const r = rectFor(el)
      const start = ring.o.get() > 0 ? now(ring) : rectFor(from)
      if (!r || !start || latest.current.reduce) return ring.o.jump(0)
      const cs = getComputedStyle(el)
      const node = ringRef.current
      // 环的偏移照抄项自己的（压在带线的面上时外移 1px）；圆角由 className 给，和项一致
      if (node) node.style.outlineOffset = cs.outlineOffset
      el.setAttribute("data-ring-travel", "")
      moveBox(ring, start, null)
      ring.o.jump(1)
      moveBox(ring, r, SPRINGS.fast)
      runs.get(ring.x)?.stop()
      runs.set(ring.x, animate(ring.x, r.x, { ...SPRINGS.fast, onComplete: () => {
        if (ringItem !== el) return
        el.removeAttribute("data-ring-travel")
        ring.o.jump(0)
      } }))
    }
    const focusIn = (e: FocusEvent) => {
      const el = itemOf(e.target)
      if (!el || el !== e.target) return
      if (el.matches(":focus-visible")) ringTo(el)
      else {
        ringItem?.removeAttribute("data-ring-travel")
        ringItem = null
        ring.o.jump(0)
      }
      // 键盘焦点和指针共用一块悬停底
      hoverTo(el)
    }
    const focusOut = (e: FocusEvent) => {
      if (track.contains(e.relatedTarget as Node | null)) return
      ringItem?.removeAttribute("data-ring-travel")
      ringItem = null
      ring.o.jump(0)
      if (pointerInside) return
      setHoverAttr(null)
      hideHover(true)
    }

    // ResizeObserver 在布局之后、绘制之前交付首个尺寸；首次直接写终态，不等 motion 的下一帧，免得露出一帧没有胶囊的轨道
    let placed = false
    const mo = new MutationObserver((records) => {
      if (!placed) return
      if (records.some((r) => r.type === "childList")) measure()
      // 受控值落定：乐观的那一项就是它，或者被别处改成了别的
      if (optimistic && current() === optimistic) optimistic = null
      place(true)
    })
    mo.observe(track, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state", "aria-selected", "aria-checked", "aria-pressed", "aria-current"] })
    const ro = new ResizeObserver(() => {
      measure()
      target = null
      place(false)
      const r = rectFor(hovered)
      if (hoverShown && r) moveBox(hov, r, null)
      if (!placed) {
        placed = true
        Object.assign(lift.style, { transform: `translateX(${sel.x.get()}px) translateY(${sel.y.get()}px)`, width: `${sel.w.get()}px`, height: `${sel.h.get()}px` })
      }
    })
    ro.observe(track)
    for (const child of track.querySelectorAll(ITEMS)) ro.observe(child)
    track.addEventListener("pointerdown", down)
    track.addEventListener("pointermove", over)
    track.addEventListener("pointerleave", leave)
    track.addEventListener("click", click, true)
    track.addEventListener("focusin", focusIn)
    track.addEventListener("focusout", focusOut)
    doc.addEventListener("pointermove", move)
    doc.addEventListener("pointerup", up)
    doc.addEventListener("pointercancel", up)
    return () => {
      win.clearTimeout(reconcile)
      runs.forEach((r) => r.stop())
      mo.disconnect()
      ro.disconnect()
      setHoverAttr(null)
      ringItem?.removeAttribute("data-ring-travel")
      track.removeEventListener("pointerdown", down)
      track.removeEventListener("pointermove", over)
      track.removeEventListener("pointerleave", leave)
      track.removeEventListener("click", click, true)
      track.removeEventListener("focusin", focusIn)
      track.removeEventListener("focusout", focusOut)
      doc.removeEventListener("pointermove", move)
      doc.removeEventListener("pointerup", up)
      doc.removeEventListener("pointercancel", up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const layer = "pointer-events-none absolute top-0 left-0"
  const style = (b: Box) => ({ contain: "layout", x: b.x, y: b.y, width: b.w, height: b.h, opacity: b.o }) as const
  return (
    <>
      <motion.span ref={ref} aria-hidden data-slot="lift" data-group={group} className={cn(layer, "z-0", raised ? RAISED : "bg-selected", className)} style={style(sel)} />
      <motion.span aria-hidden data-slot="lift-hover" data-group={group} className={cn(layer, "z-0", raised ? "bg-hover" : "bg-selected", className)} style={style(hov)} />
      <motion.span ref={ringRef} aria-hidden data-slot="lift-ring" data-group={group} className={cn(layer, "z-20 outline-2 outline-focus [outline-style:solid]", className)} style={style(ring)} />
    </>
  )
}

export { LiftedCard, LiftLabel, liftInk, liftItem }
