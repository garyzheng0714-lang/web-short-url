"use client"

import * as React from "react"

/**
 * 图表所在的底（和 chart 一起装）：ChartFigure 不传 surface 时用它认出图下面那层底色，写进 --chart-surface。
 * 圆点的描边环、标签垫底、概览条遮罩都用 --chart-surface：它和真实底色不一样，就会在白底上露出一圈灰（2026-10-06 共用层修复）。
 */

/** 图下面那层底可能是的设计变量：认出来就写变量（换主题跟着变），认不出写实测色 */
const SURFACES = ["card", "canvas", "panel", "menu", "sidebar", "well", "notice", "inverse"]
let pen: CanvasRenderingContext2D | null = null
/** 任意 CSS 颜色的不透明度（经 canvas 归一，color-mix / oklch 也认） */
function alphaOf(color: string) {
  pen ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true })
  if (!pen) return 1
  pen.clearRect(0, 0, 1, 1)
  pen.fillStyle = "rgba(0,0,0,0)"
  pen.fillStyle = color
  pen.fillRect(0, 0, 1, 1)
  return pen.getImageData(0, 0, 1, 1).data[3] / 255
}
/**
 * --chart-surface 跟着图实际所在的底走（2026-10-06 共用层修复：舞台、Card 是白底，写死 canvas 会让圆点描边环、标签垫底、遮罩发灰）：
 * 从 figure 往上找第一层不透明的底色，对上设计变量就写 var(--color-…)，对不上写实测色；换主题时重认。
 * 显式传了 surface（canvas / card）时不改写，但要和认出来的底一致：不一致就是绕行补丁过时了，报不变量（onMismatch）。
 */
function useSurface(ref: React.RefObject<HTMLElement | null>, explicit: "canvas" | "card" | undefined, onMismatch: (message: string) => void) {
  const report = React.useRef(onMismatch)
  report.current = onMismatch
  React.useLayoutEffect(() => {
    const fig = ref.current
    if (!fig) return
    const detect = () => {
      let bg = ""
      for (let el = fig.parentElement; el; el = el.parentElement) {
        const c = getComputedStyle(el).backgroundColor
        if (alphaOf(c) > 0.98) {
          bg = c
          break
        }
      }
      if (!bg) bg = getComputedStyle(document.body).backgroundColor
      const probe = document.createElement("i")
      fig.append(probe)
      const colorOf = (name: string) => {
        probe.style.color = `var(--color-${name})`
        return getComputedStyle(probe).color
      }
      const token = SURFACES.find((name) => colorOf(name) === bg)
      const want = explicit ? colorOf(explicit) : ""
      probe.remove()
      if (explicit) {
        if (want !== bg) report.current(`surface="${explicit}"（${want}）和图实际所在的底（${bg}）不一样：去掉 surface，让图自己认底`)
        return
      }
      fig.style.setProperty("--chart-surface", token ? `var(--color-${token})` : bg)
    }
    detect()
    const mo = new MutationObserver(detect)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] })
    return () => {
      mo.disconnect()
      fig.style.removeProperty("--chart-surface")
    }
  }, [ref, explicit])
}

export { useSurface }
