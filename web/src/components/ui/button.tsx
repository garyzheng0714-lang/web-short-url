"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { animate, useComposedRefs, useMotionValue, useMotionValueEvent, useReducedMotion, type AnimationPlaybackControls } from "motion/react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"
import { DUR, FROM_FIRST_FRAME, SPRINGS } from "@/components/ui/ease"
import { nextFrame, useSizeCache } from "@/components/ui/frame"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { Spinner } from "@/components/ui/spinner"
import { useInvariant } from "@/components/ui/invariant"

/**
 * 按钮：主、次、三级、无底、危险与危险确认 × 两档尺寸（md 36 / sm 28 带字，icon / icon-sm 纯图标；lg 暂等于 md）。默认 primary 墨色实底；一屏最多一个主动作，工具类操作用 ghost（工具条里的筛选、排序除外：它们是可拨的，用 SelectTrigger 的凹面，见 DESIGN.md §3.11）。
 * 外形（DESIGN.md §4.1）：primary 实底；secondary 透明叠色底（--ds-tint，跟着所在面变色，悬停 --ds-tint-hover）；tertiary 1px 环（平时在外，按下时转成内线）；
 *   ghost 无底；danger 白底红字加 1px 环；danger-confirm 红实底（只给确认面里的确认按钮）。字重 500。
 * 面（data-slot=button-surface）：底色画在比按钮内收 1px 的一层上，再用同色 1px 外扩阴影补回满尺寸。
 *   按下 → 外扩收掉，四边各收 1px（不缩放：缩放会让宽按钮横向变形，400 宽的按钮缩 2% 横向少 8px、竖向不到 1px）。
 *   透明叠色底的外扩只画在面的外面，和底不重叠，不出深一圈的边。三级与危险的环在按下时从外侧换到内侧，跟着面一起收。
 *   颜色与几何都写成按钮自己身上的变量（--btn-bg / --btn-hover / --btn-press、--btn-out / --btn-in），面只读变量：asChild 渲染成链接也一样。
 * 打开期间（Radix 弹出类触发器的 aria-haspopup + data-state=open，或 active）保持按下的颜色，满尺寸：手指还没离开那件东西。
 * 有图标的那一侧内边距少 4（36 档 16 → 12，28 档 12 → 8）：渲染后看第一个、最后一个内容节点是不是 svg，在按钮上写 data-icon-start / data-icon-end。
 * 字（DESIGN.md §4.1）：直接写在按钮里的文字包进一个 text-trim 的 span，裁掉行盒上下多余部分，字形在固定高度里真正居中。
 * loading（DESIGN.md §4.3 加载）：立刻 aria-busy + aria-disabled（不用 disabled：焦点不丢），点击、回车、表单提交都吞掉；
 *   400ms 后字和图标原位变透明（仍占位，宽度不变）、转圈盖在正中——400ms 内结束的操作不闪转圈。
 * 禁用（DESIGN.md §4.3）：disabled 与 aria-disabled（不在处理中）一个样子，挂在 data-off 上——实底（primary、danger-confirm）形状、底色不变，只有字淡到 40%；
 *   其余整颗 40%。aria-disabled 悬停不变色、按下不收，但点击照常交给使用方（「点了就地提醒」）。悬停才出现的动作不许禁用（不变量）。
 *   aria-disabled 而字不淡的只有两种：处理中（loading / aria-busy）与结果态（data-result，按钮上写着已经发生的事：「✓ 已删除」）。
 * 图标（DESIGN.md §4.5）：随按钮的字号定大小（13 → 14、15 → 16），纯图标 16；线 1.5，悬停、当前、打开时 2；ghost 的图标默认 fg-muted，悬停、当前、打开时 fg。
 * 换文案（保存 → 已保存，按文字与元素类型比较；同一段文字换个样式不算）：新文案原位模糊交叉，外框宽度跟上。asChild 不包任何结构，不做这两件事。
 *
 * 动效（DESIGN.md §4.2、§4.3）：
 * - 指针按下 → 面收 1px：阴影 80ms 收进去；松手、移开或取消 → 180ms 回到满尺寸（收得快、回得慢），曲线都是 ease-ds。底色 80ms。
 *   按下挂在 data-pressed 上，不用 :active：按住移出按钮时 :active 还在，面却该回来。loading、aria-disabled 时按了没有作用。
 * - 悬停 → 底色 80ms；图标线 1.5 → 2，80ms。
 * - 换文案（谁引起：多半是点了之后系统给出结果）→ 外框 morph：变宽时移动的是前沿，用 snappy；变窄时是后沿，用 smooth；
 *   中途再换从当前宽度、当前速度接着走。新文案 200ms 淡入、旧文案 150ms 淡出，同时从 blur 4px 清晰 / 变糊，叠在同一格里。
 * - loading 到 400ms → 字 150ms 淡到透明、转圈 200ms 淡入（系统）；结束时字直接回来。
 * - 键盘（Enter / 空格）→ 空格按住时面直接收、松开直接回；焦点环、颜色、面在 focus-visible 下都没有过渡；键盘引起的换文案 0ms。
 * - 减少动态效果 → 宽度直接到位；换文案只剩淡入淡出（不模糊）；面收 1px、颜色照常过渡（不是位移）。
 */
const LOADING_DELAY = 400
const EASE = "cubic-bezier(0.23, 1, 0.32, 1)" // ease-ds，WAAPI 用

// 禁用（data-off）：非实底整颗 data-off:opacity-40，实底只淡字（DESIGN.md §4.3）
// 非实底还能聚焦的禁用（aria-disabled，例如轮播到头的「上一张」）被键盘聚焦时：整颗回到 100%，焦点环与面不跟着淡，只有内容淡到 40%。
// 文案格平时是 display: contents（设透明度无效），这时换成和换文案时同一套 inline-flex（排版不变）。实底只淡字，本来就不淡环
const OFF_FOCUS =
  "data-off:focus-visible:opacity-100 data-off:focus-visible:[&>:not([data-slot=button-surface])]:opacity-40 data-off:focus-visible:[&>[data-slot=button-label]]:inline-flex data-off:focus-visible:[&>[data-slot=button-label]]:min-w-0 data-off:focus-visible:[&>[data-slot=button-label]]:flex-auto data-off:focus-visible:[&>[data-slot=button-label]]:items-center data-off:focus-visible:[&>[data-slot=button-label]]:[justify-content:inherit] data-off:focus-visible:[&>[data-slot=button-label]]:gap-1.5"
// 面的颜色分三层，互不抢权重：--btn-bg 静止、--btn-hover 悬停、--btn-press 按下 / 打开；面读 --btn-fill = 最上面那层有值的。
// aria-disabled（含处理中）悬停不变色：aria-disabled:hover: 把 --btn-hover 清掉（权重高一档）。当前（aria-pressed / aria-current=page）悬停也不变浅。
// 打开（弹出类触发器开着、active）= 按下的颜色，满尺寸。
// 类名都写成字面量：Tailwind 只认源码里完整的类名，拼接出来的不生成样式。

const buttonVariants = cva(
  [
    // 字重用 font-medium（主题里就是 --ds-weight-control）：使用方传 font-normal 时 tailwind-merge 能认出冲突、覆盖得了
    "relative isolate inline-flex shrink-0 items-center justify-center gap-1.5 font-medium whitespace-nowrap select-none",
    // 面的变量：颜色三层 + 环 + 几何（平时外扩 1px；按下外扩 0、内线 1px）+ 阴影时长（平时 180，按下 80）
    "[--btn-bg:transparent] [--btn-hover:initial] [--btn-press:initial] [--btn-fill:var(--btn-press,var(--btn-hover,var(--btn-bg)))]",
    "[--btn-ring:var(--btn-fill)] [--btn-ring-in:transparent] [--btn-filter:none] [--btn-out:1px] [--btn-in:0px] [--btn-dur:180ms]",
    "data-pressed:[--btn-out:0px] data-pressed:[--btn-in:1px] data-pressed:[--btn-dur:80ms] focus-visible:active:[--btn-out:0px] focus-visible:active:[--btn-in:1px]",
    // 字色 80（ghost 图标 fg-muted → fg）；键盘聚焦时一律即时
    "transition-[color] duration-80 ease-ds",
    "outline-none focus-visible:focus-ring focus-visible:transition-none",
    // 图标线：1.5 → 2（悬停、当前、打开），80ms；转圈不是 lucide，不受影响
    "[&_svg.lucide]:transition-[stroke-width] [&_svg.lucide]:duration-80 [&_svg.lucide]:ease-ds focus-visible:[&_svg.lucide]:transition-none",
    // 悬停走 hover:（只在能悬停的指针上生效，触屏点过不会一直粗着）；当前、打开不分指针
    "hover:[&:not([aria-disabled=true])_svg.lucide]:stroke-2 [&:is([aria-pressed=true],[aria-current=page],[data-active],[aria-haspopup][data-state=open])_svg.lucide]:stroke-2",
    // 禁用的外观按变体写（data-off）：disabled 与 aria-disabled（不在处理中）同一个样子
    "disabled:pointer-events-none",
    // 宽度 morph 期间新文案比外框宽：裁在外框里（clip 不改基线）
    "[contain:layout] data-morphing:overflow-clip",
    // 图标随字定大小（DESIGN.md §4.5：12–13 号配 14，14–15 号配 16）：按按钮自己的字号算，
    // 使用方改了字号（size="sm" 配 text-sm）图标跟着变。公式：1.25em − 2.75px 向上取到 2 的倍数。
    // 写成 --button-icon：按钮里自己包了一层图标格子的组件（复制按钮）用同一个数，不另写 size-4
    "[--button-icon:round(up,calc(1.25em-2.75px),2px)] [&_svg]:pointer-events-none [&_svg]:size-(--button-icon) [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        // 实底禁用（流程主按钮走不了）：形状、底色不变，只有字淡到 40%
        primary: "text-action-fg [--btn-bg:var(--ds-action)] hover:[--btn-hover:var(--ds-action-hover)] aria-disabled:hover:[--btn-hover:initial] data-pressed:[--btn-press:var(--ds-action-hover)] focus-visible:active:[--btn-press:var(--ds-action-hover)] [&:is([data-active],[aria-haspopup][data-state=open])]:[--btn-press:var(--ds-action-hover)] data-off:text-action-fg/40",
        // 透明叠色底：跟着所在面变色；悬停浅一点，按下、打开回到静止的叠色
        secondary: ["text-fg [--btn-bg:var(--ds-tint)] hover:[--btn-hover:var(--ds-tint-hover)] aria-disabled:hover:[--btn-hover:initial] data-pressed:[--btn-press:var(--ds-tint)] focus-visible:active:[--btn-press:var(--ds-tint)] [&:is([data-active],[aria-haspopup][data-state=open])]:[--btn-press:var(--ds-tint)] data-off:opacity-40", OFF_FOCUS].join(" "),
        // 1px 环：平时画在面外（满尺寸），按下时换成面内的线，跟着面一起收
        tertiary: ["text-fg [--btn-ring:var(--ds-line)] [--btn-ring-in:var(--ds-line)] hover:[--btn-hover:var(--ds-hover)] aria-disabled:hover:[--btn-hover:initial] data-pressed:[--btn-press:var(--ds-active)] focus-visible:active:[--btn-press:var(--ds-active)] [&:is([data-active],[aria-haspopup][data-state=open])]:[--btn-press:var(--ds-active)] data-off:opacity-40", OFF_FOCUS].join(" "),
        // 当前（aria-pressed 工具、aria-current=page 导航项）= selected 叠色，悬停不变浅；文字是 fg，图标见 compoundVariants
        ghost: ["text-fg hover:[--btn-hover:var(--ds-hover)] aria-disabled:hover:[--btn-hover:initial] aria-pressed:[--btn-bg:var(--ds-selected)] aria-pressed:hover:[--btn-hover:initial] aria-[current=page]:[--btn-bg:var(--ds-selected)] aria-[current=page]:hover:[--btn-hover:initial] data-pressed:[--btn-press:var(--ds-active)] focus-visible:active:[--btn-press:var(--ds-active)] [&:is([data-active],[aria-haspopup][data-state=open])]:[--btn-press:var(--ds-active)] data-off:opacity-40", OFF_FOCUS].join(" "),
        // 白底红字 + 1px 环（同 tertiary 的环）
        danger: ["text-danger [--btn-bg:var(--ds-fill)] [--btn-ring:var(--ds-line)] [--btn-ring-in:var(--ds-line)] hover:[--btn-hover:var(--ds-fill-hover)] aria-disabled:hover:[--btn-hover:initial] data-pressed:[--btn-press:var(--ds-fill-hover)] focus-visible:active:[--btn-press:var(--ds-fill-hover)] [&:is([data-active],[aria-haspopup][data-state=open])]:[--btn-press:var(--ds-fill-hover)] data-off:opacity-40", OFF_FOCUS].join(" "),
        "danger-confirm": "text-danger-fg [--btn-bg:var(--ds-danger)] hover:[--btn-filter:brightness(0.95)] aria-disabled:hover:[--btn-filter:none] data-pressed:[--btn-filter:brightness(0.95)] focus-visible:active:[--btn-filter:brightness(0.95)] [&:is([data-active],[aria-haspopup][data-state=open])]:[--btn-filter:brightness(0.95)] data-off:text-danger-fg/40",
      },
      // 圆角不写在这里：默认圆角由 data-radius 在 ds-theme.css 的 components 层给出（零权重），调用处写的语境圆角类直接生效、不用加 !
      // 左右内边距：--btn-px 是这一档的值，有图标的那一侧少 4（data-icon-start / data-icon-end）。写成 pl / pr：调用处的 px-0、p-2 能覆盖
      size: {
        sm: "h-(--ds-h-sm) text-xs [--btn-px:var(--ds-pad-x-sm)] [--ds-edge:var(--ds-pad-x-sm)] [--btn-pl:var(--btn-px)] [--btn-pr:var(--btn-px)] data-icon-start:[--btn-pl:calc(var(--btn-px)-4px)] data-icon-end:[--btn-pr:calc(var(--btn-px)-4px)] data-icon-start:[--ds-edge-start:calc(var(--btn-px)-4px)] data-icon-end:[--ds-edge-end:calc(var(--btn-px)-4px)] pl-(--btn-pl) pr-(--btn-pr)",
        md: "h-(--ds-h-md) text-sm [--btn-px:var(--ds-pad-x-md)] [--ds-edge:var(--ds-pad-x-md)] [--btn-pl:var(--btn-px)] [--btn-pr:var(--btn-px)] data-icon-start:[--btn-pl:calc(var(--btn-px)-4px)] data-icon-end:[--btn-pr:calc(var(--btn-px)-4px)] data-icon-start:[--ds-edge-start:calc(var(--btn-px)-4px)] data-icon-end:[--ds-edge-end:calc(var(--btn-px)-4px)] pl-(--btn-pl) pr-(--btn-pr)",
        // 控件只有 36 / 28 两档（DESIGN.md §3.1）：lg 暂等于 md，调用处改完后删掉
        lg: "h-(--ds-h-md) text-sm [--btn-px:var(--ds-pad-x-md)] [--ds-edge:var(--ds-pad-x-md)] [--btn-pl:var(--btn-px)] [--btn-pr:var(--btn-px)] data-icon-start:[--btn-pl:calc(var(--btn-px)-4px)] data-icon-end:[--btn-pr:calc(var(--btn-px)-4px)] data-icon-start:[--ds-edge-start:calc(var(--btn-px)-4px)] data-icon-end:[--ds-edge-end:calc(var(--btn-px)-4px)] pl-(--btn-pl) pr-(--btn-pr)",
        // 纯图标：没有字可随，固定 16。--ds-edge = (高 − 16) / 2：放在行首行尾（edge-start / edge-end）推出去的正好是透明的那圈
        icon: "size-(--ds-h-md) [--button-icon:calc(var(--spacing)*4)] [--ds-edge:calc((var(--ds-h-md)-16px)/2)]",
        // 小号纯图标（行内、页头、卡片角上，高 = sm 按钮）：自带按 28 算的 --ds-edge，不要在 icon 上写 size-7 覆盖（edge 仍按 36 算，行尾多推 4px）
        "icon-sm": "size-(--ds-h-sm) [--button-icon:calc(var(--spacing)*4)] [--ds-edge:calc((var(--ds-h-sm)-16px)/2)]",
      },
    },
    compoundVariants: [
      // 图标默认 fg-muted，悬停、当前、打开时 fg（DESIGN.md §4.5）。纯图标：整颗按钮的颜色就是图标的颜色，
      // 里面自己写了状态色的（复制成功的 text-success）照常继承覆盖
      { variant: "ghost", size: ["icon", "icon-sm"], className: "text-fg-muted hover:text-fg aria-disabled:hover:text-fg-muted" },
      // 带字：字是 fg，只有直接写在按钮里的图标淡；:where 不加权重，使用方写在图标上的颜色类照样生效
      { variant: "ghost", size: ["sm", "md", "lg"], className: "[:where(&:not(:is(:hover:not([aria-disabled=true]),[aria-pressed=true],[aria-current=page],[data-active],[aria-haspopup][data-state=open])))>svg]:text-fg-muted [:where(&:not(:is(:hover:not([aria-disabled=true]),[aria-pressed=true],[aria-current=page],[data-active],[aria-haspopup][data-state=open])))>[data-slot=button-label]>svg]:text-fg-muted" },
    ],
    defaultVariants: { variant: "primary", size: "md" },
  }
)

/**
 * 面：比按钮内收 1px 的一层，同色外扩补回满尺寸（见文件头）。圆角、连续圆角跟按钮（调用处改了圆角也跟着）；
 * 外扩 1px 让外轮廓的圆角正好回到按钮的圆角。阴影平时 180ms、按下 80ms，底色 80ms；键盘聚焦时即时。
 */
const SURFACE =
  "pointer-events-none absolute inset-px -z-1 [border-radius:inherit] [corner-shape:inherit] bg-(--btn-fill) [box-shadow:0_0_0_var(--btn-out)_var(--btn-ring),inset_0_0_0_var(--btn-in)_var(--btn-ring-in)] [filter:var(--btn-filter)] transition-[box-shadow,background-color] [transition-duration:var(--btn-dur),80ms] ease-ds [:focus-visible>&]:transition-none"

/** 直接写在按钮里的文字（连续的字串、数字合成一段）包进 text-trim 的 span；只有空白的段不渲染（和 flex 里的空白文字一样）。没有文字时原样返回 */
function trimText(children: React.ReactNode): React.ReactNode {
  const items = React.Children.toArray(children)
  if (!items.some((c) => typeof c === "string" || typeof c === "number")) return children
  const parts: React.ReactNode[] = []
  let run = ""
  const flush = () => {
    if (run.trim()) parts.push(<span key={`text-${parts.length}`} className="text-trim">{run}</span>)
    run = ""
  }
  for (const c of items) {
    if (typeof c === "string" || typeof c === "number") run += c
    else { flush(); parts.push(c) }
  }
  flush()
  return parts
}

/** 内容的第一个、最后一个节点是不是图标（svg）：只有一个节点时不算（纯图标该用 size="icon"） */
function markIconEdges(el: HTMLElement, box: Element) {
  const kids = [...box.childNodes].filter((n) =>
    n.nodeType === Node.ELEMENT_NODE ? !(n as Element).matches("[data-slot^=button-]") : n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== ""
  )
  const svg = (n: ChildNode | undefined) => n instanceof SVGSVGElement
  el.toggleAttribute("data-icon-start", kids.length > 1 && svg(kids[0]))
  el.toggleAttribute("data-icon-end", kids.length > 1 && svg(kids[kids.length - 1]))
}

/** 文案的身份：文字 + 元素类型（lucide 图标各有名字）。只有它变了才算换文案。 */
function labelKey(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(labelKey).join("")
  if (!React.isValidElement(node)) return ""
  const type = node.type as string | { displayName?: string; name?: string }
  const name = typeof type === "string" ? type : (type.displayName ?? type.name ?? "")
  // 文字交给 TextMorph 自己逐字变形：按钮不再交叉，宽度跟着它走
  if (name === "TextMorph") return "<TextMorph>"
  return `<${name}>${labelKey((node.props as { children?: React.ReactNode }).children)}`
}

/** out：要淡出的旧文案；fade：新文案要淡入（旧文案正被转圈盖着时只淡入新的，不让旧字再露出来）；from：换之前的外框宽度 */
type Label = { key: string; node: React.ReactNode; out: React.ReactNode; fade: boolean; from: number | null; id: number }

/**
 * 换文案：记下旧文案和换之前的外框宽度（morph 的起点），在提交帧钉住起点，下一帧开始。
 * 键盘引起的换文案（fromKeyboard）不留旧文案、不量宽度：直接换。hidden：上一帧文字是不是被转圈盖着。
 */
function useLabel(children: React.ReactNode, node: React.RefObject<HTMLElement | null>, enabled: boolean, hidden: React.RefObject<boolean>) {
  const cached = useSizeCache(node)
  const key = enabled ? labelKey(children) : ""
  const [label, setLabel] = React.useState<Label>({ key, node: children, out: null, fade: false, from: null, id: 0 })
  if (label.key !== key) {
    const instant = fromKeyboard()
    // 换之前的宽度：读取上一次 ResizeObserver 交付的尺寸，不在 render 强制排版
    const from = !instant && cached.current.width > 0 ? cached.current.width : null
    setLabel({ key, node: children, out: instant || hidden.current ? null : label.node, fade: !instant, from, id: label.id + 1 })
  }
  return [label, setLabel] as const
}

function Button({
  className,
  variant = "primary",
  size,
  asChild = false,
  loading = false,
  pressScale = true,
  active = false,
  children,
  ref,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** 处理中：aria-busy + aria-disabled，吞掉点击与提交；400ms 后文字隐去、转圈居中，宽度不变 */
    loading?: boolean
    /** false：按下时面不收，交给外层（分裂按钮的两半由胶囊一起处理） */
    pressScale?: boolean
    /** 保持按下的颜色（满尺寸）：按钮控制着一块开着的界面（菜单、弹出层）时用；Radix 弹出类触发器打开时自动如此 */
    active?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"
  const node = React.useRef<HTMLButtonElement>(null)
  // 按下：data-pressed 挂在按钮上，面收 1px（不经 React 渲染）
  const press = (e: { button: number }) => {
    if (e.button === 0) node.current?.setAttribute("data-pressed", "")
  }
  const release = () => node.current?.removeAttribute("data-pressed")
  const refs = useComposedRefs(node, ref)
  const reduce = useReducedMotion()
  const live = React.useRef<HTMLSpanElement>(null)
  const gone = React.useRef<HTMLSpanElement>(null)
  const hidden = React.useRef(false)
  const [label, setLabel] = useLabel(children, node, !asChild, hidden)
  const width = useMotionValue(0)
  const morph = React.useRef<AnimationPlaybackControls | null>(null)
  useMotionValueEvent(width, "change", (v) => {
    if (node.current && node.current.hasAttribute("data-morphing")) node.current.style.width = `${v}px`
  })

  // 400ms 后才转圈（§4.1）；loading 一结束，同一帧里文字回来、转圈撤掉
  const [armed, setArmed] = React.useState(false)
  React.useEffect(() => {
    if (!loading) return setArmed(false)
    const t = window.setTimeout(() => setArmed(true), LOADING_DELAY)
    return () => window.clearTimeout(t)
  }, [loading])
  const spinning = loading && armed && !asChild
  React.useLayoutEffect(() => {
    hidden.current = spinning
    if (spinning && !fromKeyboard()) return nextFrame(() => { live.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DUR.fast * 1000, easing: EASE }) })
  }, [spinning])

  // 换文案：外框 morph + 新旧文案模糊交叉
  React.useLayoutEffect(() => {
    const el = node.current
    if (!label.id || !el) return
    const settle = () => {
      el.style.width = ""
      el.removeAttribute("data-morphing")
    }
    let target: number | null = null
    if (label.from === null || reduce) {
      morph.current?.stop()
      settle()
    } else {
      el.style.width = ""
      const to = parseFloat(getComputedStyle(el).width)
      const from = morph.current && width.isAnimating() ? width.get() : label.from
      if (Math.abs(to - from) > 0.5) {
        if (!width.isAnimating()) width.jump(from)
        el.setAttribute("data-morphing", "")
        el.style.width = `${width.get()}px`
        // 变宽：移动的是前沿（snappy）；变窄：后沿（smooth）。animate 接着当前速度走
        target = to
      } else if (!width.isAnimating()) settle()
    }
    // 上一次换文案的淡入还没走完：停掉（键盘换的这一次直接到位）
    const enter = live.current
    enter?.getAnimations().forEach((a) => a.cancel())
    if (enter) { enter.style.opacity = ""; enter.style.willChange = "" }
    if (!label.fade || !enter) return
    const blur = reduce ? "blur(0px)" : "blur(4px)"
    enter.style.opacity = "0"
    enter.style.willChange = "opacity, filter"
    if (gone.current) gone.current.style.willChange = "opacity, filter"
    return nextFrame(() => {
      if (target !== null) morph.current = animate(width, target, { ...(target > width.get() ? SPRINGS.snappy : SPRINGS.smooth), ...FROM_FIRST_FRAME, onComplete: settle })
      enter.style.opacity = ""
      const shown = enter.animate([{ opacity: 0, filter: blur }, { opacity: 1, filter: "blur(0px)" }], { duration: DUR.base * 1000, easing: EASE })
      gone.current?.animate([{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: blur }], { duration: DUR.fast * 1000, easing: EASE, fill: "forwards" })
      const id = label.id
      shown.finished.then(
        () => { enter.style.willChange = ""; if (gone.current) gone.current.style.willChange = ""; setLabel((l) => (l.id === id ? { ...l, out: null, fade: false } : l)) },
        () => {}
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label.id])
  React.useEffect(() => () => morph.current?.stop(), [])
  // 有图标的那一侧内边距少 4：每次渲染后看内容首尾（只读子节点，不读布局）
  React.useLayoutEffect(() => {
    const el = node.current
    const box = asChild ? el : live.current
    if (el && box) markIconEdges(el, box)
  })

  const swapping = label.fade
  const ariaOff = props["aria-disabled"] === true || props["aria-disabled"] === "true"
  const inert = loading || ariaOff
  // 禁用的样子（DESIGN.md §4.3）：disabled，或 aria-disabled 而不在处理中、也不是结果态。
  // 处理中（loading / aria-busy）与结果态（data-result：按钮上写着已经发生的事，如「✓ 已删除」）同样点不了，但字要看得清，不淡
  const busy = props["aria-busy"] === true || props["aria-busy"] === "true"
  const result = (props as { "data-result"?: unknown })["data-result"]
  const off = Boolean(props.disabled) || (ariaOff && !loading && !busy && (result == null || result === false))
  // 不变量：悬停才出现的动作（opacity-0）不许禁用——禁用的 40% 会盖过 opacity-0，灰钮常驻。走不了就不渲染（DESIGN.md §3.3）
  const fail = useInvariant("Button")
  const hoverOnly = off && /(^|\s)(\S+:)?opacity-0(?=\s|$)/.test(className ?? "")
  React.useEffect(() => {
    if (hoverOnly) fail("悬停才出现的按钮（className 里有 opacity-0）处于禁用：禁用透明度会盖过 opacity-0，灰钮常驻。走不了时不渲染它")
  }, [hoverOnly, fail])
  return (
    <Comp
      data-slot="button"
      data-hit-area=""
      // 纯图标两档是 icon / icon-sm：触屏热区等按「纯图标」写的规则用 [data-size^=icon]（ds-theme.css）
      data-size={size ?? "md"}
      // 默认圆角（ds-theme.css components 层，零权重）：调用处的圆角类直接覆盖
      data-radius={size === "sm" || size === "icon-sm" ? "sm" : "control"}
      data-variant={variant}
      data-off={off || undefined}
      data-active={active || undefined}
      ref={refs}
      className={cn(buttonVariants({ variant, size }), className)}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        // 处理中：吞掉点击（回车、空格也会合成点击）和表单提交，焦点留在按钮上
        if (loading) return e.preventDefault()
        onClick?.(e)
      }}
      onPointerDown={(e: React.PointerEvent<HTMLButtonElement>) => {
        onPointerDown?.(e)
        // 处理中、aria-disabled（流程里走不了的主按钮）按了没有作用：面不收
        if (pressScale && !inert) press(e)
      }}
      onPointerUp={(e: React.PointerEvent<HTMLButtonElement>) => {
        onPointerUp?.(e)
        release()
      }}
      onPointerLeave={(e: React.PointerEvent<HTMLButtonElement>) => {
        onPointerLeave?.(e)
        release()
      }}
      onPointerCancel={(e: React.PointerEvent<HTMLButtonElement>) => {
        onPointerCancel?.(e)
        release()
      }}
      {...props}
      aria-busy={loading || props["aria-busy"] || undefined}
      aria-disabled={loading || props["aria-disabled"] || undefined}
    >
      <span aria-hidden data-slot="button-surface" className={SURFACE} />
      {asChild ? (
        // 面插在子元素（链接）自己的内容前面
        <Slot.Slottable>{children}</Slot.Slottable>
      ) : (
        <>
          {/* 平时不占盒子（display: contents），和直接写在按钮里一样；换文案、转圈时才成为一个格子 */}
          <span
            ref={live}
            data-slot="button-label"
            className={cn(
              swapping || spinning ? "inline-flex min-w-0 flex-auto items-center [justify-content:inherit] gap-1.5" : "contents",
              spinning && "opacity-0"
            )}
          >
            {trimText(children)}
          </span>
          {label.out != null ? (
            <span
              key={label.id}
              ref={gone}
              aria-hidden
              data-slot="button-label-out"
              className="pointer-events-none absolute inset-0 flex items-center [justify-content:inherit] gap-1.5 [padding:inherit]"
            >
              {trimText(label.out)}
            </span>
          ) : null}
          {spinning ? (
            <span aria-hidden data-slot="button-spinner" className="absolute inset-0 grid place-items-center starting:opacity-0 transition-opacity duration-(--ds-dur-base) ease-ds">
              <Spinner aria-hidden />
            </span>
          ) : null}
        </>
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
