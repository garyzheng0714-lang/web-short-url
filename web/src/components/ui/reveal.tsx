import { nextFrame, promoteFilter } from "@/components/ui/frame"

import * as React from "react"
import { Slot } from "radix-ui"
import { animate } from "motion/react"
import { SPRINGS } from "@/components/ui/ease"
import { fromKeyboard } from "@/components/ui/hotkeys"

import { cn } from "@/lib/utils"

/**
 * 入场：内容第一次滚进视口时出现一次，之后不再动（DESIGN.md §5.1 滚动进入、§5.2 出场档）。
 * - fade：只淡入，区块档 400ms ease-ds-expo。区块里的正文、卡片、列表默认用它——位置不动，读的人不用重新找行。
 * - rise：淡入 + snappy 上移 5px，给区块标题；避免短程 expo 首帧超过 15%。
 * - media：淡入 + 以底边为原点从 0.97 放大到 1，截图档 700ms ease-ds-media，给截图和窗口。
 * - blur：淡入 + 上移 8px + 4px 模糊变清，首屏档 1200ms ease-ds-expo，只给首屏这种一次性的大字（§5.3a：blur ≤ 4px）。
 * 同一组用 RevealGroup 包起来：组进入视口时一起触发，子项按 index 错开 50ms（--ds-stagger）。
 * 只动 opacity / translate / scale / filter；减少动态时只留 200ms 淡入，不位移、不缩放、不模糊。
 * 键盘和高频操作不会触发它（它只响应滚动进入）；在 inert 容器里（没切到的标签页）不算看见，解除后再播。
 * 换 variant 时复位并重播一次，切了就看得见区别。
 */
type RevealVariant = "fade" | "rise" | "media" | "blur"

const GroupContext = React.createContext(false)

/**
 * 进入视口（外扩 50px，碰到就算）时在元素上写 data-in，只写一次。
 * 露出时在 inert 容器里（没切到的标签页、收起的面板）：不算看见，等它解除 inert 再判断；否则入场在看不见时就播完了。
 * replay 变了（换 variant）：无过渡复位到出场前，看得见就用新方式再播一遍；不复位的话几种方式静止时一模一样，切了看不出区别。
 */
function useInViewOnce(ref: React.RefObject<HTMLElement | null>, enabled: boolean, replay = "") {
  React.useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    if (el.hasAttribute("data-in")) {
      // 关掉过渡一步复位；读一次布局把复位提交成过渡的起点，再还原过渡
      el.style.transition = "none"
      el.removeAttribute("data-in")
      void el.getBoundingClientRect()
      el.style.transition = ""
    }
    let cancel: (() => void) | undefined
    let unlock: MutationObserver | undefined
    const cleanups: (() => void)[] = []
    /** 露出时在 inert 容器里：等它解除 inert 再让观察器重报一次 */
    const waitInert = (lock: Element) => {
      if (unlock) return
      unlock = new MutationObserver(() => {
        if (lock.hasAttribute("inert")) return
        unlock?.disconnect()
        unlock = undefined
        io.unobserve(el)
        io.observe(el)
      })
      unlock.observe(lock, { attributes: true, attributeFilter: ["inert"] })
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        const lock = el.closest("[inert]")
        if (lock) return waitInert(lock)
        if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
          const nodes = el.matches('[data-slot="reveal"][data-variant="blur"]') ? [el] : [...el.querySelectorAll<HTMLElement>('[data-slot="reveal"][data-variant="blur"]')]
          cleanups.push(promoteFilter(nodes))
        }
        const rises = el.matches('[data-slot="reveal"][data-variant="rise"]') ? [el] : [...el.querySelectorAll<HTMLElement>('[data-slot="reveal"][data-variant="rise"]')]
        const still = fromKeyboard() || matchMedia("(prefers-reduced-motion: reduce)").matches
        if (!still) for (const node of rises) node.style.translate = "0px 5px"
        const start = () => {
          el.setAttribute("data-in", "")
          for (const node of rises) {
            if (still) node.style.translate = "0px 0px"
            else {
              const run = animate(node, { translate: ["0px 5px", "0px 0px"] }, { ...SPRINGS.snappy, delay: (Number(node.style.getPropertyValue("--i")) || 0) * 0.05 })
              cleanups.push(() => run.stop())
            }
          }
        }
        if (still) start()
        else cancel = nextFrame(start)
        io.disconnect()
      },
      { rootMargin: "50px 0px" }
    )
    io.observe(el)
    return () => {
      io.disconnect()
      unlock?.disconnect()
      cancel?.()
      cleanups.forEach(clear => clear())
      // 换成别的方式时，上一种留下的行内位移不能带过去
      if (el.matches('[data-variant="rise"]')) el.style.translate = ""
    }
  }, [ref, enabled, replay])
}

const hidden: Record<RevealVariant, string> = {
  fade: "duration-(--ds-dur-enter) ease-ds-expo",
  rise: "translate-y-1.25 duration-(--ds-dur-enter) ease-ds-expo",
  media: "origin-bottom scale-97 duration-(--ds-dur-media) ease-ds-media",
  blur: "translate-y-2 blur-[4px] duration-(--ds-dur-hero) ease-ds-expo",
}

function Reveal({
  className,
  style,
  variant = "fade",
  index = 0,
  asChild = false,
  ref,
  ...props
}: React.ComponentProps<"div"> & {
  variant?: RevealVariant
  /** 在组里的顺序，决定延迟：index × 50ms。可以写小数（标题常用 2.5，即晚 125ms）。 */
  index?: number
  asChild?: boolean
}) {
  const inGroup = React.useContext(GroupContext)
  const own = React.useRef<HTMLDivElement>(null)
  useInViewOnce(own, !inGroup, variant)
  const Comp = asChild ? Slot.Root : "div"
  return (
    <Comp
      ref={mergeRefs(own, ref)}
      data-slot="reveal"
      data-variant={variant}
      style={{ "--i": index, ...style } as React.CSSProperties}
      className={cn(
        "opacity-0 [transition-delay:calc(var(--i)*var(--ds-stagger))]",
        variant === "rise" ? "transition-opacity" : "transition-[opacity,translate,scale,filter]",
        hidden[variant],
        "data-in:translate-y-0 data-in:scale-100 data-in:opacity-100 data-in:blur-none",
        inGroup && "in-data-in:translate-y-0 in-data-in:scale-100 in-data-in:opacity-100 in-data-in:blur-none",
        "motion-reduce:translate-y-0 motion-reduce:scale-100 motion-reduce:blur-none motion-reduce:duration-(--ds-dur-base) motion-reduce:ease-ds",
        className
      )}
      {...props}
    />
  )
}

/** 一组一起触发的入场：组本身不动，只负责在进入视口时写 data-in，里面的 Reveal 按 index 依次出现。 */
function RevealGroup({
  asChild = false,
  ref,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const own = React.useRef<HTMLDivElement>(null)
  useInViewOnce(own, true)
  const Comp = asChild ? Slot.Root : "div"
  return (
    <GroupContext.Provider value>
      <Comp ref={mergeRefs(own, ref)} data-slot="reveal-group" {...props} />
    </GroupContext.Provider>
  )
}

function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
    }
  }
}

export { Reveal, RevealGroup }
