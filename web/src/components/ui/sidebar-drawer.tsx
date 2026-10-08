"use client"

import * as React from "react"
import { animate, AnimatePresence, motion, useMotionValue, usePresence, useReducedMotion, useTransform, type AnimationPlaybackControls } from "motion/react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { EXIT, FROM_FIRST_FRAME, SPRINGS } from "@/components/ui/ease"
import { nextFrame } from "@/components/ui/frame"
import { PopupScrim } from "@/components/ui/popup"

/**
 * 侧栏的窄屏抽屉（ui/sidebar 的部件，DESIGN.md §2.4「所贴的边外」）：Radix Dialog（模态、焦点锁定，标题是 label），
 * 离四周 8、圆角 card、最宽 = 容器宽 − 48；外框模式（responsive="container"）挂在外框里、从外框左边滑出。
 * 打开时焦点到可见的当前项，关闭后回打开它的入口。
 * 动效：面板从左边外滑进 moderate（0.16s），滑出 EXIT.moderate（0.12s）；进出推同一个进度，中途反悔从当前位置、当前速度接着走。
 * 遮罩随 PopupScrim。减少动态：不位移，只淡入（fast）淡出（EXIT.fast）。退场途中面板不接指针。
 */
function SidebarDrawer({ label, open, onOpenChange, frame, instant, className, children }: {
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 外框模式时的外框；整个应用传 null */
  frame: React.RefObject<HTMLDivElement | null> | null
  /** 这一次开合跳过动画（ui/sidebar 的 toggle({ instant })） */
  instant: React.RefObject<boolean>
  className?: string
  children: React.ReactNode
}) {
  const opener = React.useRef<HTMLElement | null>(null)
  const inFrame = Boolean(frame?.current)
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount container={inFrame ? frame!.current : undefined}>
            <DialogPrimitive.Overlay forceMount asChild>
              <PopupScrim data-slot="sidebar-overlay" className={inFrame ? "absolute" : undefined} />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content forceMount asChild aria-describedby={undefined} onOpenAutoFocus={(event) => {
              opener.current = document.activeElement as HTMLElement | null
              const current = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('[aria-current]:not([aria-current="false"])')
              if (!current || !current.checkVisibility() || current.closest("[inert]")) return
              event.preventDefault()
              current.focus({ preventScroll: true })
              current.scrollIntoView({ block: "nearest", behavior: "instant" })
            }} onCloseAutoFocus={(event) => {
              if (!opener.current?.isConnected) return
              event.preventDefault()
              opener.current.focus({ preventScroll: true })
            }}>
              {/* 抽屉的尺寸只由它自己定（贴着四周 8）：不接使用方给宽屏面板的 className */}
              <DrawerPanel instant={instant} className={cn(className, "top-(--ds-gutter) bottom-(--ds-gutter) left-(--ds-gutter) rounded-card bg-canvas shadow-overlay", inFrame ? "absolute" : "fixed", "z-50 max-w-[calc(100%-48px)] outline-none")}>
                <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
                {children}
              </DrawerPanel>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}

/** Radix 内容层 asChild 到这里：它给的 ref、style（模态层的 pointer-events）合并后传下去 */
function DrawerPanel({ style, instant, ...props }: React.ComponentProps<typeof motion.div> & { instant: React.RefObject<boolean> }) {
  const [present, safeToRemove] = usePresence()
  const reduce = useReducedMotion()
  const p = useMotionValue(0)
  const transform = useTransform(p, (v) => (reduce ? "none" : `translateX(calc((-100% - var(--ds-gutter)) * ${1 - v}))`))
  const opacity = useTransform(p, (v) => (reduce ? v : 1))
  const running = React.useRef<AnimationPlaybackControls | null>(null)
  const alive = React.useRef(present)
  alive.current = present
  React.useLayoutEffect(() => {
    running.current?.stop()
    const to = present ? 1 : 0
    if (instant.current) {
      p.set(to)
      // 等本轮提交结束再移除（同步调用会被 AnimatePresence 忽略）
      if (!present) queueMicrotask(() => safeToRemove())
      return
    }
    return nextFrame(() => {
      const transition = reduce ? (present ? SPRINGS.fast : EXIT.fast) : present ? SPRINGS.moderate : EXIT.moderate
      const a = animate(p, to, { ...transition, ...FROM_FIRST_FRAME })
      running.current = a
      if (!present) a.then(() => alive.current || safeToRemove())
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present])
  return <motion.div {...props} style={{ ...style, transform, opacity, pointerEvents: present ? style?.pointerEvents : "none" }} />
}

export { SidebarDrawer }
