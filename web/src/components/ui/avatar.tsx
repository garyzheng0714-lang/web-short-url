import { useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { EXIT, SPRINGS } from "@/components/ui/ease"
import { fromKeyboard } from "@/components/ui/hotkeys"

/**
 * 头像：有图用图，无图或加载失败时显示 1–2 字缩写。人用圆形，组织和来源用圆角方形。
 * 尺寸 16 / 24 / 32 / 40；缩写字号 13 / 13 / 15 / 17。16 放不下缩写，只给图片或组织标志。color 只用于来源或组织的品牌色。
 * 没传 color 的缩写头像按名字取六个色调之一（ds-tokens.css 的 --ds-avatar-1…6，底浅字深、同色相）：同一个名字永远同一色，
 * 一排头像分得出人（2026-10-06：原先全是同一种灰，叠在一起像一团、像禁用）。
 * status：右下角一个状态点（在线 success、离线 fg-subtle），外圈 2px 与所在底色同色（默认读 --ds-surface，不用写 ring；canvas / card 仍可钉死）；
 * 读屏名字带上状态（「林晓，在线」），点本身对读屏隐藏。叠放（AvatarGroup）时外圈同样用 ring。
 *
 * 带图的头像画 1px 内描边（DESIGN.md §4.5：浅色纯黑 10%、深色纯白 10%，沿头像的圆角）：浅色照片的边缘不融进底色。缩写头像不描（底色本身就是边）。
 *
 * 动效（DESIGN.md §4.2）：
 * - 图片加载完成（系统）→ 交叉淡化：图片 0 → 1 用 fast（80ms）、缩写（连同底色）1 → 0 用 fast 的退场（60ms），同时开始，ease-ds，不缩放
 *   → 减少动态时照旧（只有透明度）。两层叠在同一格里，图片没到之前先显示缩写，头像不闪空白、不跳尺寸；
 *   已在缓存里的图片第一帧就到位，不播淡入。加载失败时图片层撤掉，缩写留在原处。
 * - 状态变化（系统：有人上线、离线）→ 新的点从 .6 长到 1，fast（≤ 48px 的小东西）；旧的点 EXIT.fast 淡出并缩回 .6
 *   → 减少动态时只淡入淡出，不缩放。第一次渲染不播；键盘引起的（例如空格切换「在线」开关）0ms。
 */
const SIZE = {
  16: "size-4 text-xs",
  24: "size-6 text-xs",
  32: "size-8 text-sm",
  40: "size-10 text-base",
} as const
const DOT = { 16: "size-1.5", 24: "size-2", 32: "size-2.5", 40: "size-3" } as const
// 颜色画在 ::after 上，点本身是底色实底：fg-subtle 是半透明的，直接叠在深色头像上会发黑
const STATUS = { online: { label: "在线", className: "after:bg-success" }, offline: { label: "离线", className: "after:bg-fg-subtle" } } as const
// surface（默认）：跟着所在的面（--ds-surface，实底的面与浮层里的卡片自己声明，见 ds-theme.css），没有面时画布色；canvas / card 钉死
const RING = { surface: "ring-(--ds-surface,var(--ds-canvas))", canvas: "ring-canvas", card: "ring-card" } as const
const TONES = 6
/** 名字 → 色调序号（1–6）：逐字累加码位，稳定、不依赖顺序以外的东西 */
const toneOf = (name: string) => ([...name].reduce((sum, ch) => (sum * 31 + ch.codePointAt(0)!) % 9973, 7) % TONES) + 1
const UNDER = { surface: "bg-(--ds-surface,var(--ds-canvas))", canvas: "bg-canvas", card: "bg-card" } as const

type DotMotion = { still: boolean; reduce: boolean }
const DOT_MOTION = {
  hidden: ({ reduce }: DotMotion) => ({ opacity: 0, scale: reduce ? 1 : 0.6 }),
  shown: { opacity: 1, scale: 1, transition: SPRINGS.fast },
  gone: ({ still, reduce }: DotMotion) => ({ opacity: 0, scale: reduce || still ? 1 : 0.6, transition: still ? { duration: 0 } : EXIT.fast }),
}

function Avatar({
  name,
  initials,
  color,
  src,
  size = 24,
  shape = "rounded",
  status,
  ring,
  className,
}: {
  name: string
  initials?: string
  color?: string
  src?: string
  size?: keyof typeof SIZE
  shape?: "rounded" | "circle"
  /** 右下角的状态点；名字里带上状态 */
  status?: keyof typeof STATUS
  /** 外圈 2px（叠放、状态点）的颜色：和头像所在的底色相同。状态点不写也跟着所在的面；写了才给头像本身加外圈 */
  ring?: keyof typeof RING
  className?: string
}) {
  const reduce = useReducedMotion()
  const still = fromKeyboard()
  const motionOf: DotMotion = { still, reduce: Boolean(reduce) }
  const [failed, setFailed] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const hasImage = Boolean(src) && failed !== src
  const ready = hasImage && loaded === src
  const label = initials ?? name.slice(0, 1)
  const radius = shape === "circle" ? "rounded-full" : size >= 32 ? "rounded-control" : "rounded-sm"
  return (
    <span
      role="img"
      aria-label={status ? `${name}，${STATUS[status].label}` : name}
      data-slot="avatar"
      data-state={ready ? "image" : "fallback"}
      className={cn("relative inline-grid shrink-0 leading-none font-medium text-white select-none", SIZE[size], radius, ring && `ring-2 ${RING[ring]}`, className)}
    >
      {/* 裁切层：圆角与拐角形状跟外层一致；状态点在它外面，不被裁掉 */}
      <span
        data-slot="avatar-face"
        // 垫一层实底：品牌色可能带透明度，叠放时重叠处会发黑
        className="grid overflow-hidden rounded-inherit bg-canvas [corner-shape:inherit] *:[grid-area:1/1]"
      >
        <span
          data-slot="avatar-fallback"
          aria-hidden
          className={cn(
            "grid place-items-center transition-opacity duration-(--ds-dur-fast-exit) ease-ds",
            ready && "opacity-0"
          )}
          style={color ? { background: color } : { background: `var(--ds-avatar-${toneOf(name)})`, color: `var(--ds-avatar-fg-${toneOf(name)})` }}
        >
          {label}
        </span>
        {hasImage ? (
          <img
            key={src}
            src={src}
            alt=""
            data-slot="avatar-image"
            className={cn(
              "size-full rounded-inherit object-cover transition-opacity duration-(--ds-dur-fast) ease-ds outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10",
              !ready && "opacity-0"
            )}
            // 缓存命中时 onLoad 可能在挂载前就触发过：挂载时看一眼 complete，第一帧就到位
            ref={(img) => {
              if (img?.complete && img.naturalWidth > 0 && loaded !== src) setLoaded(src ?? null)
            }}
            onLoad={() => setLoaded(src ?? null)}
            onError={() => setFailed(src ?? null)}
          />
        ) : null}
      </span>
      {/* 退场的点用的是「这一次」的方式（键盘、减少动态）：经 custom 传给它，不用它自己最后一次渲染时的旧值 */}
      <AnimatePresence initial={false} custom={motionOf}>
        {status ? (
          <motion.span
            key={status}
            aria-hidden
            data-slot="avatar-status"
            data-status={status}
            className={cn(
              "absolute right-0 bottom-0 rounded-full ring-2 after:absolute after:inset-0 after:rounded-full",
              DOT[size],
              STATUS[status].className,
              // 没写 ring：跟着所在的面
              RING[ring ?? "surface"],
              UNDER[ring ?? "surface"]
            )}
            custom={motionOf}
            variants={DOT_MOTION}
            initial={still ? false : "hidden"}
            animate="shown"
            exit="gone"
          />
        ) : null}
      </AnimatePresence>
    </span>
  )
}

export { Avatar }
