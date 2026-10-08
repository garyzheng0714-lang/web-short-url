"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * 浮层挂在哪（2026-10-05）。浮层默认挂到 body；放在 PortalScope 里时，挂进这个格子自己。
 * 用在「一屏同时有好几份示例、只显示其中一份」的地方（组件页舞台的示例标签、首页缩略格）：
 * 静止就打开的浮层（defaultOpen 的提示、弹出层、菜单）跟着它所在的示例一起隐藏，不漏到别的标签或整页上。
 * 定位不变：格子不加 transform，浮层仍按视口定位（Radix Popper 的 fixed），只是 DOM 位置在格子里，继承它的显隐。
 * 浮层组件里写 `<XxxPrimitive.Portal container={usePortalContainer()}>`。
 */
const PortalContainer = React.createContext<HTMLElement | null>(null)

function PortalScope({ className, children, ...props }: React.ComponentProps<"div">) {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null)
  return (
    <div ref={setContainer} data-slot="portal-scope" className={cn("relative", className)} {...props}>
      <PortalContainer.Provider value={container}>{children}</PortalContainer.Provider>
    </div>
  )
}

/** 当前的浮层容器；不在 PortalScope 里时是 undefined（Radix 默认挂 body） */
function usePortalContainer() {
  return React.useContext(PortalContainer) ?? undefined
}

export { PortalScope, usePortalContainer }
