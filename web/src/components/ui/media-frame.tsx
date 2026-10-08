import * as React from "react"

import { cn } from "@/lib/utils"

import { Reveal } from "@/components/ui/reveal"

/**
 * 媒体框：放产品截图、录屏、真实页面的窗口。落地页的滚动步骤、功能格子里的每一张图都放在它里面。
 * 阴影三层、扩散等于负的纵向偏移，所以只往下投，四周没有灰晕：看起来是一张被轻轻托起的卡片，不是一块发光的板。
 * chrome：顶上加一条窗口栏（三个灰点 + 「来源 / 标题」），截图本身没有窗口外壳时用；action 放在窗口栏右端（例如终端的复制按钮）。
 * reveal：第一次滚进视口时以底边为原点从 0.97 放大到 1（Reveal variant="media"，截图档 700ms ease-ds-media），
 * 一页里只给主要的几张图用；减少动态时只留 200ms 淡入。框本身没有别的动画。
 */
function MediaFrame({
  className,
  chrome = false,
  source,
  title,
  reveal = false,
  action,
  children,
  ...props
}: Omit<React.ComponentProps<"figure">, "title"> & {
  chrome?: boolean
  /** 窗口栏右端的一个动作（只在 chrome 时显示） */
  action?: React.ReactNode
  /** 窗口栏里弱色的来源，如「来自 项目空间」 */
  source?: React.ReactNode
  /** 窗口栏里强色的页面标题 */
  title?: React.ReactNode
  reveal?: boolean
}) {
  const frame = (
    <figure
      data-slot="media-frame"
      className={cn(
        "m-0 flex flex-col overflow-hidden rounded-media bg-card shadow-media",
        "[&>img]:block [&>img]:w-full [&>video]:block [&>video]:w-full",
        className
      )}
      {...props}
    >
      {chrome ? (
        <div data-slot="media-frame-bar" className="flex h-10 shrink-0 items-center gap-4 border-b border-line px-4">
          <span aria-hidden className="flex gap-1.5">
            <span className="size-3 rounded-full bg-active" />
            <span className="size-3 rounded-full bg-active" />
            <span className="size-3 rounded-full bg-active" />
          </span>
          <span className="min-w-0 truncate text-sm">
            {source ? (
              <>
                <span className="text-fg-muted">{source}</span>
                <span className="text-fg-muted"> / </span>
              </>
            ) : null}
            <span className="text-fg">{title}</span>
          </span>
          {action ? <span className="ml-auto flex shrink-0">{action}</span> : null}
        </div>
      ) : null}
      {children}
    </figure>
  )
  return reveal ? (
    <Reveal variant="media" asChild>
      {frame}
    </Reveal>
  ) : (
    frame
  )
}

export { MediaFrame }
