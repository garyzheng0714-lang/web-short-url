import * as React from "react"
import { AnimatePresence } from "motion/react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

import { useDensityProps } from "@/components/ui/density"
import { ELEVATION, Elevated } from "@/components/ui/elevated"
import { usePortalContainer } from "@/components/ui/portal-scope"
import { PopupContext, PopupMotion, useOpenState, usePopup } from "@/components/ui/popup"

/**
 * 弹出层（DESIGN.md §2.4）：一小块临时内容（筛选、快速编辑、说明），只放一件事；需要确认的流程用 Dialog。
 * 宽 288，内边距 16，圆角 rounded-popover；离触发元素 8、离屏幕四边 ≥ 8，放不下翻到对侧；最大高 = 可用高，超出时内部滚动。
 * 底色与阴影由 Elevated 给（所在层 + 2，阴影固定第 3 层：对话框里打开的弹出层仍分得出层）；在 Density 区域里打开的跟着变紧凑。
 * 动效（popup.tsx 的 PopupMotion anchored；键盘与指针同一套）：
 * - 打开 → 透明度 + scaleY 0.96 + 朝触发元素 4px，fast（0.08s）；方向跟着翻转后的实际一侧，原点在贴触发元素的那条边。
 * - 关闭（点外面、PopoverClose、Esc）→ EXIT.fast（0.06s），不回放进场。打开途中再点 → 从当前值接着退。
 * - 减少动态 → 不缩放、不位移，只淡入淡出。
 */
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor
const PopoverClose = PopoverPrimitive.Close

function Popover({ open, defaultOpen, onOpenChange, ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const state = useOpenState(open, defaultOpen, onOpenChange)
  return (
    <PopupContext value={state}>
      <PopoverPrimitive.Root {...props} open={state.open} onOpenChange={state.setOpen} />
    </PopupContext>
  )
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 8,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const { open } = usePopup()
  const container = usePortalContainer()
  const density = useDensityProps()
  return (
    <AnimatePresence>
      {open ? (
        <PopoverPrimitive.Portal forceMount container={container}>
          <Elevated asChild {...ELEVATION.popover}>
            <PopoverPrimitive.Content forceMount asChild align={align} sideOffset={sideOffset} collisionPadding={8} {...density} {...props}>
              <PopupMotion
                anchored
                data-slot="popover-content"
                className={cn(
                  "z-50 max-h-(--radix-popover-content-available-height) w-72 origin-(--radix-popover-content-transform-origin) overflow-y-auto overscroll-contain rounded-popover p-4 text-sm text-fg outline-none",
                  className
                )}
              >
                {children}
              </PopupMotion>
            </PopoverPrimitive.Content>
          </Elevated>
        </PopoverPrimitive.Portal>
      ) : null}
    </AnimatePresence>
  )
}

export { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger }
