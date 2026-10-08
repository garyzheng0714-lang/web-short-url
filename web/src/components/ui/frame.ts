import { useLayoutEffect, useRef, type RefObject } from "react"

/** DESIGN.md §5.3a：提交帧只钉起点，下一帧才创建动画；返回值取消排队，并执行调用方显式提供的动画清理；不主动重置现有弹簧。 */
function nextFrame(start: () => void | (() => void)) {
  let cleanup: void | (() => void)
  const frame = requestAnimationFrame(() => { cleanup = start() })
  return () => { cancelAnimationFrame(frame); cleanup?.() }
}

/** 未经 transform 的 border-box 尺寸；只由 ResizeObserver 更新，render 读取缓存不触发布局。 */
function useSizeCache<T extends HTMLElement>(node: RefObject<T | null>, onResize?: (size: { width: number; height: number }) => void) {
  const size = useRef({ width: 0, height: 0 })
  const notify = useRef(onResize)
  notify.current = onResize
  useLayoutEffect(() => {
    const el = node.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.borderBoxSize[0]
      const next = { width: box?.inlineSize ?? entry.contentRect.width, height: box?.blockSize ?? entry.contentRect.height }
      if (next.width === size.current.width && next.height === size.current.height) return
      size.current = next
      notify.current?.(next)
    })
    observer.observe(el, { box: "border-box" })
    return () => observer.disconnect()
  }, [node])
  return size
}

/** CSS 模糊过渡：开始前提升，结束/取消/卸载撤销；调用方在减少动态或 0ms 分支不调用。 */
function promoteFilter(nodes: Iterable<HTMLElement>, animationName?: string) {
  const cleanups: (() => void)[] = []
  for (const node of nodes) {
    node.style.willChange = "filter"
    const clear = () => {
      node.style.willChange = ""
      node.removeEventListener("transitionend", end)
      node.removeEventListener("transitioncancel", end)
      node.removeEventListener("animationend", ended)
      node.removeEventListener("animationcancel", ended)
    }
    const end = (event: TransitionEvent) => { if (event.target === node && event.propertyName === "filter") clear() }
    const ended = (event: AnimationEvent) => { if (event.target === node && event.animationName === animationName) clear() }
    node.addEventListener("transitionend", end)
    node.addEventListener("transitioncancel", end)
    node.addEventListener("animationend", ended)
    node.addEventListener("animationcancel", ended)
    cleanups.push(clear)
  }
  return () => cleanups.forEach(clear => clear())
}

export { nextFrame, useSizeCache, promoteFilter }
