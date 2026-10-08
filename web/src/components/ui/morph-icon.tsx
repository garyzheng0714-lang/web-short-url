import * as React from "react"
import { motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { DUR, EASE_OUT, SPRINGS } from "@/components/ui/ease"
import { fromKeyboard } from "@/components/ui/hotkeys"

/**
 * 会变形的图标：每个图标恰好由三条线组成，用不到的线收成中心的隐形点，
 * 所以任意两个图标之间都能直接变形，而不是淡入淡出地替换。
 *
 * 网格：16×16，内容区 2–14，线宽 1.5，圆头圆角。按 16px 设计，放大展示时线宽等比放大。
 * 线的顺序有约定：第 1 条偏竖，第 2 条偏横，第 3 条备用——这样加号↔减号、菜单↔关闭都走最短路径。
 * 同形状、只差方向的图标（箭头、折角、加号/叉号）属于同一个旋转组：组内切换只旋转，不变形。
 *
 * 动效（DESIGN.md §5.1、§5.2）：
 * - 调用方换 name（多为指针点击）→ 三条线的端点与整体旋转走 snappy（0.22s · bounce 0.15；图标 ≤ 48px，属于小东西换状态，不是 morph 外框），
 *   连点时从当前角度、当前速度接着转 → 减少动态时直接换成新形状。
 * - 同时收成中心点、或从中心点长出的线 → 淡入淡出 150ms ease-ds → 减少动态时直接换。
 * - 跟着一块面板一起动的箭头（手风琴、折叠区的展开箭头）传 spring="smooth"，和面板高度同一条弹簧、同拍（§5.3）。
 * - 键盘触发（Enter / 空格按下的按钮）→ 0ms。
 */
type Line = readonly [x1: number, y1: number, x2: number, y2: number]
type Shape = readonly [Line, Line, Line]

const C: Line = [8, 8, 8, 8]

const SHAPES = {
  menu: [[3, 4, 13, 4], [3, 8, 13, 8], [3, 12, 13, 12]],
  plus: [[8, 2.5, 8, 13.5], [2.5, 8, 13.5, 8], C],
  minus: [C, [2.5, 8, 13.5, 8], C],
  equals: [C, [3, 6, 13, 6], [3, 10, 13, 10]],
  check: [[3, 8.5, 6.5, 12], [6.5, 12, 13, 4.5], C],
  more: [[3, 8, 3, 8], [8, 8, 8, 8], [13, 8, 13, 8]],
  play: [[4.5, 3, 12.5, 8], [12.5, 8, 4.5, 13], [4.5, 13, 4.5, 3]],
  pause: [[5.5, 3.5, 5.5, 12.5], C, [10.5, 3.5, 10.5, 12.5]],
  external: [[4.5, 11.5, 11.5, 4.5], [6, 4.5, 11.5, 4.5], [11.5, 4.5, 11.5, 10]],
  arrow: [[2.5, 8, 13.5, 8], [9, 3.5, 13.5, 8], [13.5, 8, 9, 12.5]],
  chevron: [[6, 3.5, 10.5, 8], [10.5, 8, 6, 12.5], C],
} as const satisfies Record<string, Shape>

/** 名称 → 形状 + 旋转角度。同一 shape 的图标属于同一旋转组。 */
const ICONS = {
  menu: { shape: "menu", rotate: 0 },
  plus: { shape: "plus", rotate: 0 },
  close: { shape: "plus", rotate: 45 },
  minus: { shape: "minus", rotate: 0 },
  equals: { shape: "equals", rotate: 0 },
  check: { shape: "check", rotate: 0 },
  more: { shape: "more", rotate: 0 },
  play: { shape: "play", rotate: 0 },
  pause: { shape: "pause", rotate: 0 },
  external: { shape: "external", rotate: 0 },
  "arrow-right": { shape: "arrow", rotate: 0 },
  "arrow-down": { shape: "arrow", rotate: 90 },
  "arrow-left": { shape: "arrow", rotate: 180 },
  "arrow-up": { shape: "arrow", rotate: 270 },
  "chevron-right": { shape: "chevron", rotate: 0 },
  "chevron-down": { shape: "chevron", rotate: 90 },
  "chevron-left": { shape: "chevron", rotate: 180 },
  "chevron-up": { shape: "chevron", rotate: 270 },
} as const satisfies Record<string, { shape: keyof typeof SHAPES; rotate: number }>

type MorphIconName = keyof typeof ICONS

const MORPH_ICON_NAMES = Object.keys(ICONS) as MorphIconName[]

/** 端点与旋转走弹簧（默认 snappy）；透明度只是配角，150ms 淡入淡出，比形状先到。 */
const FADE = { duration: DUR.fast, ease: EASE_OUT } as const
const MOTION = {
  snappy: { ...SPRINGS.snappy, opacity: FADE },
  smooth: { ...SPRINGS.smooth, opacity: FADE },
} as const
const instant = { duration: 0 } as const

/**
 * 旋转走最短路径：记住累计角度，270° → 0° 转 +90°，而不是倒转 270°。
 * 正好差 180°（折角上下翻）时两个方向一样远：取和上一次相反的方向，翻回去走原路（DESIGN.md §5.3 原路返回），中途反悔也是掉头而不是接着转。
 */
function useContinuousAngle(target: number) {
  const angle = React.useRef(target)
  const last = React.useRef(0)
  let delta = ((((target - angle.current) % 360) + 540) % 360) - 180
  if (Math.abs(delta) === 180) delta = last.current < 0 ? 180 : -180
  if (delta) last.current = delta
  angle.current += delta
  return angle.current
}

function MorphIcon({
  name,
  size = 16,
  spring = "snappy",
  className,
  "aria-label": ariaLabel,
}: {
  name: MorphIconName
  size?: number
  /** 跟着面板一起动时用 smooth，与面板同拍；单独的图标用默认 snappy */
  spring?: keyof typeof MOTION
  className?: string
  "aria-label"?: string
}) {
  const { shape, rotate } = ICONS[name]
  const lines = SHAPES[shape]
  const angle = useContinuousAngle(rotate)
  const reduced = useReducedMotion()
  const transition = reduced || fromKeyboard() ? instant : MOTION[spring]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={cn("shrink-0 overflow-visible", className)}
    >
      <motion.g initial={false} animate={{ rotate: angle }} transition={transition} style={{ transformBox: "view-box", transformOrigin: "8px 8px" }}>
        {lines.map(([x1, y1, x2, y2], i) => {
          const line = lines[i]
          const hidden = line === C
          return (
            <motion.line
              key={i}
              initial={false}
              animate={{ x1, y1, x2, y2, opacity: hidden ? 0 : 1 }}
              transition={transition}
            />
          )
        })}
      </motion.g>
    </svg>
  )
}

export { MORPH_ICON_NAMES, MorphIcon, type MorphIconName }
