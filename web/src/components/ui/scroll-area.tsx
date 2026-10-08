import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * 滚动区（DESIGN.md §3.9）：滚动条不消失，平时细而淡，伸手去拿时才变宽变深。
 *
 * 几何：轨道宽 10、贴边，是整条点击区；滑块（画在 thumb 的 ::before 上）静止宽 4、指针在轨道上时 6，
 * 中心离边 7（居中再往里挪 2，滑块外沿离边 5 / 悬停 4）；thumb 本身占满轨道宽，按在滑块旁边也是抓住滑块，不会跳。
 * 轨道两端各让 4。视口按方向预留 --ds-scroll-safe（16 = 轨道 10 + 内容到轨道 6），显隐都不改内容宽度。
 * 颜色：fg 叠色 8% → 悬停 12% → 按住（拖动或点轨道）16%。
 * 根元素需有确定高度（或 max-h）才会滚动。
 *
 * 显隐（DESIGN.md §4.2「滚动条显隐 160 / 120」，即 moderate 档 --ds-dur-moderate / --ds-dur-moderate-exit）：默认 type="auto"，内容溢出就一直在。
 * 显隐只在溢出变化时（或使用方选了 type="hover" / "scroll"）发生：透明度 160ms 进；出场 120ms，
 * 先等 160ms 让滑块从 6 变回 4，再淡出，看得见它先收窄。滚动条常驻挂载（forceMount），只切 data-state，快速进出从当前透明度接着走。
 * 隐藏时不接指针，不挡内容边上的点击。键盘滚动只移动滑块（transform 由 Radix 逐帧写，不带过渡）。
 *
 * 边缘淡出：视口默认带 scroll-fade（横向 scroll-fade-x），哪一边还有内容才淡，滚到真正的头尾那一边清楚。
 * 遮罩只在视口上；滚动条是视口的兄弟元素，不被遮。
 *
 * 触屏（pointer: coarse）：不渲染自定义滚动条，视口直接用原生 overflow 滚动（惯性、回弹按系统来）；
 * 留白、焦点、淡出与桌面相同，ScrollBar 在这里什么都不画。
 */

const COARSE = "(pointer: coarse)"

function useCoarsePointer() {
  return React.useSyncExternalStore(
    (onChange) => {
      const mq = matchMedia(COARSE)
      mq.addEventListener("change", onChange)
      return () => mq.removeEventListener("change", onChange)
    },
    () => matchMedia(COARSE).matches,
    () => false
  )
}

/** 为 true 时在触屏原生滚动分支里：ScrollBar 不渲染 */
const NativeScrollContext = React.createContext(false)

function ScrollArea({
  className,
  children,
  orientation = "vertical",
  label,
  type = "auto",
  scrollHideDelay,
  dir,
  asChild: _asChild,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  orientation?: "vertical" | "horizontal" | "both"
  /** 给读屏的名字：视口成为一个有名字的区域（role="region"），键盘能聚焦后用方向键滚动 */
  label?: string
}) {
  const native = useCoarsePointer()
  const rootClass = cn(
    "relative rounded-control has-[>[data-slot=scroll-area-viewport]:focus-visible]:focus-ring-zone",
    className
  )
  const region = label ? { role: "region", "aria-label": label, tabIndex: 0 } : null
  const viewportClass = cn(
    "size-full rounded-inherit outline-none",
    orientation === "horizontal" ? "scroll-fade-x" : "scroll-fade",
    orientation !== "horizontal" && "scroll-safe",
    orientation !== "vertical" && "scroll-safe-x"
  )

  if (native) {
    return (
      <NativeScrollContext.Provider value>
        <div data-slot="scroll-area" dir={dir} className={rootClass} {...props}>
          <div
            data-slot="scroll-area-viewport"
            {...region}
            className={cn(
              viewportClass,
              orientation === "vertical" && "overflow-x-hidden overflow-y-auto",
              orientation === "horizontal" && "overflow-x-auto overflow-y-hidden",
              orientation === "both" && "overflow-auto"
            )}
          >
            {children}
          </div>
        </div>
      </NativeScrollContext.Provider>
    )
  }

  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      type={type}
      scrollHideDelay={scrollHideDelay}
      dir={dir}
      className={rootClass}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport data-slot="scroll-area-viewport" {...region} className={viewportClass}>
        {children}
      </ScrollAreaPrimitive.Viewport>
      {orientation !== "horizontal" ? <ScrollBar orientation="vertical" /> : null}
      {orientation !== "vertical" ? <ScrollBar orientation="horizontal" /> : null}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  const native = React.useContext(NativeScrollContext)
  if (native) return null
  const vertical = orientation === "vertical"
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      forceMount
      className={cn(
        "group/scrollbar flex touch-none select-none",
        "transition-opacity duration-(--ds-dur-moderate) ease-ds",
        "data-[state=hidden]:pointer-events-none data-[state=hidden]:opacity-0 data-[state=hidden]:delay-(--ds-dur-moderate) data-[state=hidden]:duration-(--ds-dur-moderate-exit)",
        vertical ? "h-full w-2.5 py-1" : "h-2.5 flex-col px-1",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className={cn(
          "relative flex-1",
          "before:absolute before:rounded-full before:bg-fg/8",
          "before:transition-[width,height,background-color] before:duration-(--ds-dur-moderate) before:ease-ds",
          "group-hover/scrollbar:before:bg-fg/12 group-active/scrollbar:before:bg-fg/16",
          vertical
            ? "before:inset-y-0 before:end-1.75 before:w-1 before:translate-x-1/2 group-hover/scrollbar:before:w-1.5 rtl:before:-translate-x-1/2"
            : "before:inset-x-0 before:bottom-1.75 before:h-1 before:translate-y-1/2 group-hover/scrollbar:before:h-1.5"
        )}
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
