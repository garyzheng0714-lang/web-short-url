import * as React from "react"
import { ListFilter, X } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DUR, EASE_OUT, SPRINGS } from "@/components/ui/ease"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { SwapText } from "@/components/ui/popup"
import { SearchField } from "@/components/ui/search-field"
import { fieldTrigger } from "@/components/ui/select"

/**
 * 筛选工具栏：列表、表格上方的一行——搜索框（可选）+ 条件胶囊「字段 · 值 ×」+「筛选」两级菜单（字段 → 值）+「清除」。
 * - 一行一族（DESIGN.md K6、§3.11，2026-10-08）：「筛选」是可拨的，和搜索框同一张凹面（select 的 fieldTrigger：同高 28、同圆角、同底同线，
 *   浅色深色都一样）；「清除」跟着这一行用同一张面，不另起一种外形。行尾的排序写 Select（SelectTrigger 高 28，「排序：最近下单 ▾」）。
 *   原来是无底的 ghost，和有凹面的搜索框一行两种外形。图标那一侧离边 6，和搜索框的放大镜同一条线。
 * - 一个字段一个胶囊：单选字段再选一个值就替换；multiple 字段的值是勾选（菜单不关），胶囊写「进行中、待评审」，超过两个写「3 项」。
 * - 菜单是 DropdownMenu 的子菜单：→ 进入字段的值、← 回到字段、Esc 关闭并把焦点还给「筛选」；当前值打勾，hint（例如条数）在右侧。
 * - 删一个胶囊：焦点交给后一个胶囊的 ×（没有就前一个，再没有就「筛选」）；「清除」清掉条件和搜索词，焦点回「筛选」。
 *   「清除」只在有条件或搜索词时出现，它在这一行的最后，出现消失不挤动别的东西。
 * - 增删、清除经 role="status" 播报。搜索框就是 SearchField（Esc 清空、输入法组字照常）。
 * - 窄容器（< 480，容器查询）：搜索框占满一行；「筛选」「清除」和行尾控件排一行（行尾控件靠右），胶囊排在它们下面。
 *   这样行尾控件（排序）不会因为胶囊占位被挤成单独吊着的一行（2026-10-06 点验 390 宽）。
 *
 * 动效（DESIGN.md §5.1、§5.2；谁引起 → 用哪条 → 减少动态时）：
 * - 指针选值 / 点 × / 点清除 → 新胶囊从 .9 长到 1、淡入 200；离开的胶囊 150ms 缩到 .9 淡出、弹出文档流；
 *   后面的胶囊和按钮走 smooth 让位（换行时能跳过整行，所以用 smooth）→ 减少动态时不缩放、不位移，只淡入淡出。
 * - 同一字段换了值 → 胶囊里的值 blur 4 交叉（淡入 200 / 淡出 150，SwapText）→ 减少动态时只淡入淡出。
 * - 键盘（Enter / 空格选值、删胶囊、清除）→ 0ms：直接出现、直接消失、直接补位。
 * - 菜单本身的进出（从按钮长出、子菜单从字段旁长出）照 DropdownMenu。
 */

type FilterOption = { value: string; label?: string; hint?: React.ReactNode }
type FilterField = {
  id: string
  label: string
  icon?: React.ReactNode
  options: (string | FilterOption)[]
  /** 可以勾几个值；默认一个字段只取一个值 */
  multiple?: boolean
}
type FilterValue = Record<string, string[]>

const INSTANT = { duration: 0 } as const
/** 工具条里的触发器：高 28，和搜索框同一张面（fieldTrigger） */
const TRIGGER = "hit-area relative inline-flex h-(--ds-h-sm) shrink-0 px-(--ds-pad-row)"
const MOVE = { layout: SPRINGS.smooth } as const
const opt = (o: string | FilterOption): FilterOption => (typeof o === "string" ? { value: o } : o)
const nameOf = (f: FilterField, v: string) => opt(f.options.find((o) => opt(o).value === v) ?? v).label ?? v
const summary = (f: FilterField, values: string[]) => (values.length > 2 ? `${values.length} 项` : values.map((v) => nameOf(f, v)).join("、"))

function FilterToolbar({
  fields,
  value: valueProp,
  defaultValue = {},
  onValueChange,
  query,
  onQueryChange,
  searchPlaceholder = "搜索",
  label = "筛选",
  children,
  className,
}: {
  fields: FilterField[]
  value?: FilterValue
  defaultValue?: FilterValue
  onValueChange?: (value: FilterValue) => void
  /** 传了 query / onQueryChange 才有搜索框 */
  query?: string
  onQueryChange?: (query: string) => void
  searchPlaceholder?: string
  /** 整组的名字，也是菜单按钮上的字 */
  label?: string
  /** 放在这一行末尾的别的控件（排序、视图切换） */
  children?: React.ReactNode
  className?: string
}) {
  const [inner, setInner] = React.useState(defaultValue)
  const value = valueProp ?? inner
  const commit = (next: FilterValue) => {
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v.length))
    if (valueProp === undefined) setInner(clean)
    onValueChange?.(clean)
  }
  const [message, setMessage] = React.useState("")
  const root = React.useRef<HTMLDivElement>(null)
  const pendingFocus = React.useRef<string | null>(null)
  const reduce = useReducedMotion()
  const still = Boolean(reduce) || fromKeyboard()

  const active = fields.filter((f) => value[f.id]?.length)
  const members = active.map((f) => `${f.id}:${value[f.id].join(",")}`).join("|")
  const dirty = active.length > 0 || Boolean(query)

  // 删掉胶囊、清除之后，焦点交给邻居或「筛选」按钮（等新的一行渲染出来再交）
  React.useLayoutEffect(() => {
    const id = pendingFocus.current
    if (id === null) return
    pendingFocus.current = null
    root.current?.querySelector<HTMLElement>(id ? `[data-remove="${CSS.escape(id)}"]` : "[data-slot=filter-trigger]")?.focus()
  })

  const setField = (f: FilterField, values: string[]) => {
    commit({ ...value, [f.id]: values })
    setMessage(values.length ? `${f.label}：${summary(f, values)}` : `已移除${f.label}`)
  }
  const remove = (f: FilterField) => {
    const i = active.indexOf(f)
    pendingFocus.current = active[i + 1]?.id ?? active[i - 1]?.id ?? ""
    const { [f.id]: _, ...rest } = value
    commit(rest)
    setMessage(`已移除${f.label}：${summary(f, value[f.id])}`)
  }
  const clear = () => {
    pendingFocus.current = ""
    commit({})
    onQueryChange?.("")
    setMessage("已清除筛选")
  }

  const enter = still
    ? { initial: false as const, exit: { opacity: 0, transition: INSTANT }, transition: INSTANT }
    : {
        initial: { opacity: 0, scale: reduce ? 1 : 0.9 },
        exit: { opacity: 0, scale: reduce ? 1 : 0.9, transition: { duration: DUR.fast, ease: EASE_OUT } },
        transition: { ...MOVE, scale: SPRINGS.smooth, opacity: { duration: DUR.base, ease: EASE_OUT } },
      }
  const slide = { layout: "position" as const, layoutDependency: members, transition: still || reduce ? { layout: INSTANT } : MOVE }

  return (
    <div ref={root} role="group" aria-label={label} data-slot="filter-toolbar" className={cn("@container/ft w-full", className)}>
      <div className="relative flex flex-wrap items-center gap-2 pointer-coarse:gap-y-4">
        {onQueryChange ? (
          <SearchField
            aria-label="搜索"
            placeholder={searchPlaceholder}
            value={query ?? ""}
            onValueChange={onQueryChange}
            // 小一档的搜索框：图标离两边一样远（角落同心），内边距跟着高度算
            className="h-(--ds-h-sm) w-full px-[calc((var(--ds-h-sm)-16px)/2)] @min-[480px]/ft:w-56"
          />
        ) : null}
        <AnimatePresence initial={false} mode="popLayout">
          {active.map((f) => (
            <motion.span
              key={f.id}
              {...slide}
              {...enter}
              animate={{ opacity: 1, scale: 1 }}
              data-slot="filter-chip"
              data-field={f.id}
              className="flex h-(--ds-h-sm) max-w-full min-w-0 items-center gap-1 rounded-control @max-[480px]/ft:order-1 bg-active pr-0.5 pl-2 text-sm text-fg"
            >
              <span className="shrink-0 text-fg-muted">{f.label}</span>
              <span aria-hidden className="shrink-0 text-fg-muted">·</span>
              <span className="relative min-w-0 truncate">
                <SwapText>{summary(f, value[f.id])}</SwapText>
              </span>
              <button
                type="button"
                data-remove={f.id}
                aria-label={`移除 ${f.label}：${summary(f, value[f.id])}`}
                onClick={() => remove(f)}
                className="hit-area relative grid size-6 shrink-0 place-items-center rounded-sm text-fg-muted outline-none transition-colors duration-(--ds-dur-fast) ease-ds hover:bg-hover hover:text-fg focus-visible:focus-ring"
              >
                <X className="size-4" aria-hidden />
              </button>
            </motion.span>
          ))}
          {/* 「筛选」和「清除」是一组：换行时一起走，「清除」不会单独掉到下一行 */}
          <motion.span key="actions" {...slide} className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" data-slot="filter-trigger" className={cn(fieldTrigger, TRIGGER, "ps-[calc((var(--ds-h-sm)-16px)/2)]")}>
                  <ListFilter aria-hidden />
                  {label}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {fields.map((f) => {
                  const current = value[f.id] ?? []
                  const options = f.options.map(opt)
                  const hint = (o: FilterOption) => (o.hint != null ? <span className="text-fg-muted tabular-nums">{o.hint}</span> : null)
                  return (
                    <DropdownMenuSub key={f.id}>
                      <DropdownMenuSubTrigger data-field={f.id}>
                        {f.icon}
                        <span className="flex-1">{f.label}</span>
                        {current.length ? <span className="max-w-24 truncate text-fg-muted">{summary(f, current)}</span> : null}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {f.multiple ? (
                          options.map((o) => (
                            <DropdownMenuCheckboxItem
                              key={o.value}
                              checked={current.includes(o.value)}
                              onSelect={(e) => e.preventDefault()}
                              onCheckedChange={(on) => setField(f, on ? [...current, o.value] : current.filter((v) => v !== o.value))}
                            >
                              <span className="flex-1">{o.label ?? o.value}</span>
                              {hint(o)}
                            </DropdownMenuCheckboxItem>
                          ))
                        ) : (
                          <DropdownMenuRadioGroup value={current[0] ?? ""} onValueChange={(v) => setField(f, [v])}>
                            {options.map((o) => (
                              <DropdownMenuRadioItem key={o.value} value={o.value}>
                                <span className="flex-1">{o.label ?? o.value}</span>
                                {hint(o)}
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <AnimatePresence initial={false}>
              {dirty ? (
                <motion.span key="clear" {...enter} animate={{ opacity: 1, scale: 1 }} className="flex">
                  <button type="button" data-slot="filter-clear" className={cn(fieldTrigger, TRIGGER)} onClick={clear}>
                    清除
                  </button>
                </motion.span>
              ) : null}
            </AnimatePresence>
          </motion.span>
        </AnimatePresence>
        {children ? <div className="ml-auto flex items-center gap-2">{children}</div> : null}
      </div>
      <p role="status" className="sr-only">
        {message}
      </p>
    </div>
  )
}

export { FilterToolbar, type FilterField, type FilterOption, type FilterValue }
