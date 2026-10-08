"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { MorphIcon } from "@/components/ui/morph-icon"
import { Tooltip } from "@/components/ui/tooltip"
import { useGeometryInvariant } from "@/components/ui/invariant"

/**
 * 分步图解的步骤条（multi-region-failover、vector-search 共用）：左边暂停（aria-pressed），右边一组步骤按钮。
 * - 每个按钮是「第 2 步，共 6 步：降级」，当前步 aria-current=step、只有它在 Tab 序列里；方向键、Home、End 换步，点一步跳过去（onStep）。
 * - 每步一条 2px 的进度，由图解自己的帧循环直接写：容器里的 [data-fill] 依次是各步的填充，写 transform: scaleX(0–1)（匀速，时间驱动）。
 * - 步骤名在容器宽 ≥ 576（@xl/steps）时显示；窄时只留进度条，当前步看图里节点的状态，名字在按钮的读屏名里；按钮热区 44 高。
 *   窄时不截断显示：六格各约 40 宽，四字的名字会截成「回…」。
 * 动效：进度条（时间）→ 匀速；跳步（指针、键盘）→ 直接到位；暂停 → 图解的速率走 smooth 缓停。
 */
function StorySteps({
  steps,
  current,
  onStep,
  paused,
  onPausedChange,
  ref,
  className,
}: {
  steps: string[]
  current: number
  onStep: (index: number) => void
  paused: boolean
  onPausedChange: (paused: boolean) => void
  /** 步骤按钮的容器：图解在帧循环里找它的 [data-fill] 写进度 */
  ref?: React.Ref<HTMLDivElement>
  className?: string
}) {
  const box = React.useRef<HTMLDivElement | null>(null)
  // 不变量：看得见的步骤名不许被截断（「回到均分」截成「回…」）；放不下就该藏到 @xl/steps 以下
  useGeometryInvariant("StorySteps", box, (el) => {
    const cut = [...el.querySelectorAll<HTMLElement>("[data-slot=story-step-name]")].find((n) => n.offsetWidth > 0 && n.scrollWidth > n.clientWidth + 0.5)
    return cut ? `步骤名「${cut.textContent}」被截断（${cut.clientWidth}px 放不下 ${cut.scrollWidth}px）` : null
  })
  const go = (i: number) => {
    const to = (i + steps.length) % steps.length
    onStep(to)
    box.current?.querySelectorAll<HTMLElement>("button")[to]?.focus({ preventScroll: true })
  }
  return (
    <div className={cn("@container/steps flex items-start gap-3", className)}>
      <Tooltip content={paused ? "播放" : "暂停"}>
        <Button variant="secondary" size="icon" aria-label="暂停动画" aria-pressed={paused} onClick={() => onPausedChange(!paused)} className="shrink-0 rounded-full">
          <MorphIcon name={paused ? "play" : "pause"} />
        </Button>
      </Tooltip>
      <div
        ref={(el) => {
          box.current = el
          if (typeof ref === "function") ref(el)
          else if (ref) ref.current = el
        }}
        role="group"
        aria-label="步骤"
        data-slot="story-steps"
        className="grid min-w-0 flex-1 grid-flow-col auto-cols-fr gap-2"
        onKeyDown={(e) => {
          const to = { ArrowRight: current + 1, ArrowLeft: current - 1, ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: steps.length - 1 }[e.key]
          if (to === undefined) return
          e.preventDefault()
          go(to)
        }}
      >
        {steps.map((name, i) => (
          <button
            key={name}
            type="button"
            aria-label={`第 ${i + 1} 步，共 ${steps.length} 步：${name}`}
            aria-current={current === i ? "step" : undefined}
            tabIndex={current === i ? 0 : -1}
            onClick={() => go(i)}
            className="grid min-h-11 min-w-0 content-start gap-1.5 rounded-sm px-1 py-2 text-left outline-none focus-visible:focus-ring"
          >
            <span className="relative h-0.5 overflow-hidden rounded-full bg-line">
              <span data-fill className="absolute inset-0 origin-left bg-fg" style={{ transform: "scaleX(0)" }} />
            </span>
            <span data-slot="story-step-name" className={cn("hidden truncate text-xs @xl/steps:block", current === i ? "text-fg" : "text-fg-muted")}>{name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export { StorySteps }
