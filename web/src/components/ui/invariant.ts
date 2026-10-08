"use client"

import * as React from "react"

/**
 * 组件的几何不变量（2026-10-05 用户：「我现在只要发现了一个问题，就是你要从底层上代码层面要确保这种问题永不出现。如果出现就代表组件崩溃」）。
 * 用户点名过的「白痴问题」（外框与内容对不上、底色贴字、两层叠影……）在组件里写成不变量：
 * - 开发环境：违反时组件在下一次渲染里抛错——由最近的错误边界接住，页面上看得见「崩了」，不会悄悄带病上线。
 * - 正式环境：只记一条 console.error（带组件名和量到的数），不让使用方的用户页面挂掉；审计脚本照样会报。
 * 用法：const fail = useInvariant("MorphSurface")；在量完几何的地方（ResizeObserver 回调、动画落定后）调 fail(条件不成立时的说明)。
 */
const DEV = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV) ||
  (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV === "development"

export class InvariantError extends Error {
  constructor(component: string, message: string) {
    super(`[Su Design · ${component}] ${message}`)
    this.name = "InvariantError"
  }
}

export function useInvariant(component: string) {
  const [broken, setBroken] = React.useState<InvariantError | null>(null)
  if (broken) throw broken
  return React.useCallback(
    (message: string) => {
      const error = new InvariantError(component, message)
      if (DEV) setBroken(error)
      else console.error(error)
    },
    [component]
  )
}

/** 两个盒子必须一样大（±0.5px）：不一样时返回说明文字，一样时返回 null */
export function sameBox(name: [string, string], a: { width: number; height: number }, b: { width: number; height: number }) {
  if (Math.abs(a.width - b.width) <= 0.5 && Math.abs(a.height - b.height) <= 0.5) return null
  return `${name[0]}（${a.width.toFixed(1)} × ${a.height.toFixed(1)}）和${name[1]}（${b.width.toFixed(1)} × ${b.height.toFixed(1)}）不一样大`
}

/** 在布局提交后检查真实盒子；隐藏面板不验，尺寸改变、字体到达或重新显示时重验。 */
export function useGeometryInvariant<T extends HTMLElement>(component: string, ref: React.RefObject<T | null>, check: (el: T) => string | null) {
  const fail = useInvariant(component)
  const latest = React.useRef(check)
  latest.current = check
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    let frame = 0
    const inspect = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!el.isConnected || !el.getClientRects().length || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return
        const error = latest.current(el)
        if (error) fail(error)
      })
    }
    const ro = new ResizeObserver(inspect)
    ro.observe(el)
    if (el.parentElement) ro.observe(el.parentElement)
    // forceMount 的示例只换祖先属性，尺寸不变；观察祖先而非每一帧更新 style 的子图层。
    const mo = new MutationObserver(inspect)
    mo.observe(el, { subtree: true, attributes: true, attributeFilter: ["class", "data-state", "aria-checked", "aria-disabled"] })
    for (let parent = el.parentElement; parent; parent = parent.parentElement) mo.observe(parent, { attributes: true, attributeFilter: ["class", "style", "hidden", "data-state"] })
    el.addEventListener("focusin", inspect)
    document.fonts.addEventListener("loadingdone", inspect)
    return () => { cancelAnimationFrame(frame); ro.disconnect(); mo.disconnect(); el.removeEventListener("focusin", inspect); document.fonts.removeEventListener("loadingdone", inspect) }
  }, [ref, fail])
}

/** 尺寸容器必须从宿主获得宽度；否则 truncate、百分比轨道会一起消失。 */
export function contentWidth(el: HTMLElement) {
  return el.getBoundingClientRect().width < 24 ? "可见组件宽度不足 24px，内容或轨道会隐身；根节点必须从宿主获得宽度" : null
}

/**
 * 一排并排的同类项结构相同（DESIGN.md 红线 9）：同一排的指标卡要么都带趋势线、要么都不带。
 * 2026-10-08 用户截图的短链首页（旧版，已改）：三格指标只有第一格带折线，另两格下面空着；它没用 MetricGroup，所以按 DOM 找同排：
 * 往上至多两层，找到第一个有 ≥ 2 个子项各含一张指标卡的容器，比较每项里有没有 [data-slot=metric-sparkline]。
 */
export function sameShapeRow(el: HTMLElement) {
  for (let node: HTMLElement | null = el, depth = 0; node?.parentElement && depth < 3; node = node.parentElement, depth++) {
    const items = [...node.parentElement.children].filter((c) => c.matches("[data-slot=metric-card]") || c.querySelector("[data-slot=metric-card]"))
    if (items.length < 2) continue
    const withTrend = items.filter((c) => c.querySelector("[data-slot=metric-sparkline]")).length
    return withTrend > 0 && withTrend < items.length
      ? `同一排的 ${items.length} 个指标结构不一样：${withTrend} 个带趋势线、${items.length - withTrend} 个不带；要么都传 trend，要么都不传`
      : null
  }
  return null
}

/** 透明面不能靠看不见的内边距制造第二条内容线（K5）。 */
export function transparentInset(el: HTMLElement) {
  const surface = el.closest<HTMLElement>("[data-slot=surface], [data-slot=card]")
  if (!surface) return null
  const style = getComputedStyle(surface)
  // Tailwind 的无阴影不是 none，而是若干透明的 0px 阴影占位。
  const shadowInk = style.boxShadow.replace(/rgba\([^)]*,\s*0\)|color\([^)]*\/\s*0\)/g, "")
  if (style.backgroundColor !== "rgba(0, 0, 0, 0)" || /rgb|color|okl/.test(shadowInk)) return null
  const body = surface.querySelector<HTMLElement>("[data-slot=surface-body], [data-slot=card-body]")
  if (!body) return null
  const parts = [body, ...body.querySelectorAll<HTMLElement>(":scope > [data-slot^=card-]")]
  return parts.some(part => ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"].some(key => parseFloat(getComputedStyle(part)[key as "paddingTop"]) > 0.5))
    ? "透明面仍有内边距，内容没有沿宿主列线对齐" : null
}
