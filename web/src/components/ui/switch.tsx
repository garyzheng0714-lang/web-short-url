"use client"

import * as React from "react"
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { SPRINGS } from "@/components/ui/ease"
import { useDensity } from "@/components/ui/density"

/**
 * 开关：立即生效的设置用它；需要保存才生效的用 Checkbox（DESIGN.md §4.3、§4.2、§3.1「控件」）。
 * 尺寸跟区域密度（ui/density）：默认轨道 34 × 20、圆钮 16；紧凑 28 × 16、圆钮 12；圆钮离轨道四边都是 2。
 * 点击热区上下补到 24（伪元素，不改布局）。写 label 时文字在开关右边，整行可点、可拖，文字就是开关的名字；不写 label 时要给 aria-label。
 * 颜色：关 bg-line-strong（悬停 line-strong-hover），开 bg-action；开的那层墨色的不透明度由圆钮位置算出，拖动时跟着走。
 * label 的字关着时 fg-muted、开着时 fg（80ms）。
 *
 * 圆钮（全部 moderate 0.16s 临界阻尼，可以打断；挂载时直接到位，开着挂载不会滑过来）：
 * - 悬停（只认鼠标；触屏没有悬停，不会留在悬停的形状）→ 圆钮横向长 2，成胶囊。
 * - 按住 → 再长到 +4、矮 4（紧凑 +3 / −3），竖向仍居中，像被手指压扁。
 * - 开着的时候多出来的宽度往左长，外缘始终贴着轨道那一头（离边 2）。
 * - 拖：按下后指针走开 2px 才算拖，圆钮 1:1 跟手，夹在轨道里（按住的宽度）；松手时过了中点就切换、没过就弹回。
 *   拖完松手的那一下不再算点击，不会切两次；系统取消手势（滚动接管）→ 弹回，不切换。
 * - 点击、空格、回车 → 圆钮滑到另一头。
 * 减少动态：圆钮直接到位，只留颜色。
 */
const METRICS = {
  default: { track: 34, height: 20, knob: 16, hover: 2, press: 4, squash: 4 },
  compact: { track: 28, height: 16, knob: 12, hover: 2, press: 3, squash: 3 },
} as const
/** 圆钮离轨道四边 */
const INSET = 2
/** 按下后指针走开这么远才算拖；手抖一两像素仍是点击 */
const DEAD_ZONE = 2

function useControllable(value: boolean | undefined, initial: boolean | undefined, onChange?: (v: boolean) => void) {
  const [inner, setInner] = React.useState(initial ?? false)
  const on = value ?? inner
  const set = (v: boolean) => {
    if (value === undefined) setInner(v)
    onChange?.(v)
  }
  return [on, set] as const
}

function Switch({
  className,
  label,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  onClick,
  style,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  /** 开关右边的文字，整段可点，也是读屏念的名字 */
  label?: React.ReactNode
}) {
  const [on, setOn] = useControllable(checked, defaultChecked, onCheckedChange)
  const m = METRICS[useDensity()]
  const reduce = useReducedMotion() ?? false
  const [hovered, setHovered] = React.useState(false)
  const [pressed, setPressed] = React.useState(false)
  const travel = m.track - m.knob - INSET * 2
  const width = pressed ? m.knob + m.press : hovered ? m.knob + m.hover : m.knob
  const height = pressed ? m.knob - m.squash : m.knob
  // 开着时多出来的宽度往左长：外缘贴着轨道那一头
  const restX = (v: boolean, w: number) => (v ? INSET + travel - (w - m.knob) : INSET)

  const x = useMotionValue(restX(on, width))
  const w = useMotionValue(width)
  const h = useMotionValue(height)
  const y = useMotionValue((m.height - height) / 2)
  // 墨色 = 圆钮在它当前宽度下能走的范围里走了多少（悬停变宽、按住、拖动时都对）；尺寸从 ref 读，换密度不用重建
  const size = React.useRef(m)
  size.current = m
  const ink = useTransform(() => {
    const span = size.current.track - INSET * 2 - w.get()
    return Math.min(1, Math.max(0, (x.get() - INSET) / Math.max(1, span)))
  })

  const drag = React.useRef<{ x: number; from: number; moving: boolean } | null>(null)
  const dragged = React.useRef(false)
  const mounted = React.useRef(false)

  // 形状与位置：拖动途中指针说了算，这里让开；挂载与减少动态直接到位
  React.useEffect(() => {
    const instant = !mounted.current || reduce
    mounted.current = true
    const to = { x: restX(on, width), w: width, h: height, y: (m.height - height) / 2 }
    if (instant) return void (x.jump(drag.current?.moving ? x.get() : to.x), w.jump(to.w), h.jump(to.h), y.jump(to.y))
    animate(w, to.w, SPRINGS.moderate)
    animate(h, to.h, SPRINGS.moderate)
    animate(y, to.y, SPRINGS.moderate)
    if (!drag.current?.moving) animate(x, to.x, SPRINGS.moderate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, width, height, reduce, m])

  const lo = INSET
  const hi = m.track - INSET - (m.knob + m.press)
  const press = (e: React.PointerEvent<HTMLElement>) => {
    if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return
    setPressed(true)
    dragged.current = false
    drag.current = { x: e.clientX, from: x.get(), moving: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    // 外层可能被缩放（缩略图、展示台）：按实际缩放把指针位移换算回布局像素
    const el = e.currentTarget
    const scale = el.getBoundingClientRect().width / el.offsetWidth || 1
    const dx = (e.clientX - d.x) / scale
    if (!d.moving && Math.abs(dx) < DEAD_ZONE) return
    d.moving = true
    x.stop()
    x.set(Math.min(hi, Math.max(lo, d.from + dx)))
  }
  const release = (cancelled: boolean) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    setPressed(false)
    if (!d.moving) return
    // 松手的这一下浏览器还会补一个 click：标记一帧，点击处理里认出来不再切换
    dragged.current = true
    requestAnimationFrame(() => {
      dragged.current = false
    })
    const next = !cancelled && x.get() > (lo + hi) / 2
    if (next !== on) setOn(next)
    else animate(x, restX(on, m.knob), reduce ? { duration: 0 } : SPRINGS.moderate)
  }
  const pointer = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") setHovered(true)
    },
    onPointerLeave: () => setHovered(false),
    onPointerDown: press,
    onPointerMove: move,
    onPointerUp: () => release(false),
    onPointerCancel: () => release(true),
  }

  const root = (
    <SwitchPrimitive.Root
      data-slot="switch"
      checked={on}
      onCheckedChange={(v) => {
        if (!dragged.current) setOn(v)
      }}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e)
        // 拖动松手补来的 click：开关已经按位置决定了
        if (dragged.current) e.preventDefault()
      }}
      {...(label === undefined ? pointer : {})}
      className={cn(
        "group relative inline-flex shrink-0 cursor-pointer touch-pan-y rounded-full outline-none",
        // 热区补到 24 高：伪元素上下伸出，命中时就是开关本身
        "before:absolute before:inset-x-0 before:top-1/2 before:h-6 before:-translate-y-1/2",
        // 轨道保留凹槽，用注释墨色的内描边补出边界；悬停加深一档（line-strong → line-strong-hover）
        "bg-line-strong shadow-[inset_0_0_0_1px_var(--ds-fg-subtle)] transition-[background-color] duration-(--ds-dur-fast) ease-ds",
        "hover:bg-line-strong-hover in-[label:hover]:bg-line-strong-hover",
        "focus-visible:focus-ring-out",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
      {...props}
      style={{ width: m.track, height: m.height, ...style }}
    >
      <motion.span aria-hidden className="absolute inset-0 rounded-full bg-action transition-[background-color] duration-(--ds-dur-fast) ease-ds group-hover:bg-action-hover in-[label:hover]:bg-action-hover" style={{ opacity: ink }} />
      <SwitchPrimitive.Thumb asChild>
        {/* 关着时圆钮白；开着时读 action-fg，与中性墨色轨道形成反差 */}
        <motion.span
          data-slot="switch-thumb"
          className="absolute top-0 left-0 block rounded-full bg-primary-fg shadow-raised data-[state=checked]:bg-action-fg"
          style={{ x, y, width: w, height: h }}
        />
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  )
  if (label === undefined) return root
  // 整行可点、可拖：<label> 包住开关按钮，点文字等于点开关（名字也取这段文字）；
  // 横着拖归开关，竖着划照常滚动页面（touch-pan-y，触屏上不和滚动抢手势）
  return (
    <label
      data-slot="switch-field"
      data-disabled={disabled ? "" : undefined}
      {...pointer}
      className="group/field inline-flex min-h-6 touch-pan-y items-center gap-(--ds-gap-control) text-(length:--ds-text-control) leading-(--ds-lh-control) select-none data-disabled:cursor-not-allowed"
    >
      {root}
      <span className={cn("transition-[color] duration-(--ds-dur-fast) ease-ds group-data-disabled/field:opacity-40", on ? "text-fg" : "text-fg-muted")}>{label}</span>
    </label>
  )
}

export { Switch }
