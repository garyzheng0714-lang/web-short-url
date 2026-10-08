import * as React from "react"
import { Check, Search } from "lucide-react"
import { AnimatePresence, motion, useComposedRefs, useReducedMotion } from "motion/react"
import type { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

import { EXIT, SPRINGS } from "@/components/ui/ease"
import { FluidHoverHighlight, useFluidHover, type ItemRect } from "@/components/ui/fluid-hover"
import { fromKeyboard, isComposing } from "@/components/ui/hotkeys"
import { PopupMotion, usePopup } from "@/components/ui/popup"

/**
 * 菜单面（DESIGN.md K2、§3.1「控件」、§4.2、§4.3、§5）：下拉菜单、右键菜单与它们的子菜单共用的面、行、选中底与搜索框。
 * Radix 的内容层 asChild 到 MenuBody，进出场交给 popup.tsx 的 PopupMotion（anchored）。
 * - 面：最小宽 176，内边距 --ds-pad-popover（6），圆角 rounded-popover（比卡片小一档）；底色与阴影由调用处的 Elevated 给。
 *   会滚动时才给滚动条让位（scroll-safe-fit）。
 * - 行与触发器同高：h-(--ds-h-md) 36 · 紧凑 28，左右 --ds-pad-row 8 · 6，图标 --ds-icon 16 · 14、到字 --ds-gap-control 8 · 4，
 *   字 --ds-text-control 15 · 13 / 500；行圆角 rounded-popover-item = 菜单圆角 − 内边距（同心）。
 * - 悬停（ui/fluid-hover）：整张菜单只有一块悬停底，指针在空隙、内边距、末行之后也落在最近的行上，点空隙等于点亮着的那行；
 *   菜单里高亮就是焦点，不画环；键盘与指针共用同一个亮着的行（指针移到哪行，焦点就在哪行，但不算键盘焦点）。
 *   键盘焦点（:focus-visible）落在行上时，同色的底画在行自己身上、直接换行，跟随的那块让开——焦点守卫按行自己的底量键盘焦点。
 *   指针进入时底从勾选的单选行长出来（from），打开点亮的行原地淡入。
 * - 选中：单选组勾选的那行垫一块 bg-selected，换选中时滑到新行；复选每个勾上的行一块，上下贴着的合成一块（相接的角变直）。
 * - 打开即可操作：打开两帧后焦点落到第一个可用行（Enter 就是它）；有搜索框时焦点在框里，直接打字；静止展示的不抢焦点。
 * - 行尾快捷键（MenuShortcut）平时透明，这一行亮着（悬停或键盘移到）时淡入。
 * 动效：指针悬停底 fast（0.08s）滑过去，键盘焦点行的底直接换；选中底换行 moderate（0.16s），淡入 fast、淡出 EXIT.moderate；合并的直角 160ms；
 * 勾淡入 80 / 淡出 60；快捷键淡入 80 / 淡出 60。减少动态 → 悬停底、选中底直接到位，只留淡入淡出。
 */
const menuSurface =
  "relative isolate min-w-44 overflow-y-auto overscroll-contain rounded-popover p-(--ds-pad-popover) text-fg outline-none select-none scroll-safe-fit"
const menuItemClass = [
  "group/item relative flex h-(--ds-h-md) cursor-default items-center gap-(--ds-gap-control) rounded-popover-item px-(--ds-pad-row) outline-none select-none focus-visible:bg-hover",
  "text-(length:--ds-text-control) leading-(--ds-lh-control) font-medium text-fg data-disabled:pointer-events-none data-disabled:opacity-40",
  "[&_svg]:size-(--ds-icon) [&_svg]:shrink-0 [&_svg]:text-fg",
]
const ROW = "[role=menuitem], [role=menuitemcheckbox], [role=menuitemradio]"
const ENABLED_ROW = ROW.split(", ").map((r) => `${r}:not([data-disabled])`).join(", ")
/** 这张菜单自己的可用行（子菜单挂在别处，不算） */
const enabledRows = (menu: Element) => [...menu.querySelectorAll<HTMLElement>(ENABLED_ROW)].filter((el) => el.closest("[role=menu]") === menu)

type Row = { kind: string; checked: boolean; group: Element | null }

/** 菜单里的行按文档顺序登记进跟随悬停（序号 = 第几行），并读出勾选状态；行增删（搜索筛选）、勾选变化时重读 */
function useMenuRows(node: React.RefObject<HTMLElement | null>, register: (index: number, element: HTMLElement | null) => void) {
  const [rows, setRows] = React.useState<Row[]>([])
  const elements = React.useRef<HTMLElement[]>([])
  React.useLayoutEffect(() => {
    const root = node.current
    if (!root) return
    const read = () => {
      const found = [...root.querySelectorAll<HTMLElement>(ROW)].filter((el) => el.closest("[role=menu]") === root)
      found.forEach((el, i) => register(i, el))
      for (let i = found.length; i < elements.current.length; i++) register(i, null)
      elements.current = found
      const next = found.map((el) => ({ kind: el.getAttribute("role") ?? "", checked: el.getAttribute("aria-checked") === "true", group: el.closest("[role=group]") }))
      setRows((prev) => (prev.length === next.length && prev.every((r, i) => r.kind === next[i].kind && r.checked === next[i].checked && r.group === next[i].group) ? prev : next))
    }
    read()
    const watch = new MutationObserver(read)
    watch.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-checked"] })
    return () => {
      watch.disconnect()
      elements.current.forEach((_, i) => register(i, null))
      elements.current = []
    }
  }, [node, register])
  return { rows, elements }
}

const SELECTED = "pointer-events-none absolute top-0 left-0 -z-10 bg-selected rounded-popover-item"
const box = (r: ItemRect) => ({ x: r.left, y: r.top, width: r.width, height: r.height })
const abuts = (a?: ItemRect, b?: ItemRect) => Boolean(a && b && Math.abs(a.top + a.height - b.top) < 0.5)

/** 选中底：单选每组一块（换选中时滑过去）；复选每个勾上的行一块，上下贴着的合成一块 */
function MenuSelection({ rows, rects }: { rows: Row[]; rects: readonly (ItemRect | undefined)[] }) {
  const reduce = useReducedMotion() ?? false
  const groups: Element[] = []
  const radios: { index: number; rect: ItemRect }[] = []
  rows.forEach((row, index) => {
    const rect = rects[index]
    if (row.kind !== "menuitemradio" || !row.checked || !rect || !row.group || groups.includes(row.group)) return
    groups.push(row.group)
    radios.push({ index, rect })
  })
  const checked = (i: number) => rows[i]?.kind === "menuitemcheckbox" && rows[i].checked
  return (
    <AnimatePresence initial={false}>
      {radios.map(({ rect }, n) => (
        <motion.div
          key={`radio-${n}`}
          aria-hidden
          data-slot="menu-selected"
          className={SELECTED}
          initial={{ opacity: 0, ...box(rect) }}
          animate={{ opacity: 1, ...box(rect) }}
          exit={{ opacity: 0, transition: EXIT.moderate }}
          transition={{ ...(reduce ? { duration: 0 } : SPRINGS.moderate), opacity: SPRINGS.fast }}
        />
      ))}
      {rows.map((_, i) => {
        const rect = rects[i]
        if (!checked(i) || !rect) return null
        const up = checked(i - 1) && abuts(rects[i - 1], rect)
        const down = checked(i + 1) && abuts(rect, rects[i + 1])
        return (
          <motion.div
            key={`check-${i}`}
            aria-hidden
            data-slot="menu-selected"
            className={cn(SELECTED, "transition-[border-radius] duration-(--ds-dur-moderate) ease-ds", up && "rounded-t-none", down && "rounded-b-none")}
            style={box(rect)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: EXIT.fast }}
            transition={SPRINGS.fast}
          />
        )
      })}
    </AnimatePresence>
  )
}

/** 菜单里的搜索框（DropdownMenuSearch）交给菜单面的把手 */
type SearchHandle = { input: () => HTMLInputElement | null; append: (text: string) => void; back: () => void }
const SearchHost = React.createContext<((handle: SearchHandle | null) => void) | null>(null)

/**
 * 菜单面（下拉菜单、右键菜单与它们的子菜单共用）：Radix 的内容层 asChild 到这里，事件处理先跑 Radix 的、再跑这里的。
 * focusFirst：打开两帧后把焦点放到第一个可用行（子菜单不放：指针悬停打开时焦点留在父行上）。
 */
function MenuBody({
  children,
  focusFirst = true,
  ref,
  onPointerEnter,
  onPointerMove,
  onPointerLeave,
  onClick,
  onScroll,
  onFocus,
  onBlur,
  onKeyDownCapture,
  ...props
}: Omit<React.ComponentProps<typeof PopupMotion>, "children"> & { children?: React.ReactNode; focusFirst?: boolean }) {
  // 只看挂载那一刻：静止展示的菜单被人关掉时，退场途中不再去抢焦点
  const [resting] = React.useState(usePopup().resting)
  const node = React.useRef<HTMLDivElement>(null)
  const refs = useComposedRefs(node, ref)
  const hover = useFluidHover(node)
  const { rows, elements } = useMenuRows(node, hover.registerItem)
  const search = React.useRef<SearchHandle | null>(null)
  const register = React.useCallback((handle: SearchHandle | null) => void (search.current = handle), [])
  // 谁点亮了这一行：指针进入时底从勾选行长出来；打开与键盘点亮的行原地淡入，不从勾选行滑过去
  const litBy = React.useRef<"open" | "pointer" | "keyboard">("open")
  // 焦点行是键盘焦点（:focus-visible）时，底画在行自己身上，跟随的那块底让开：焦点守卫按行自己的底量键盘焦点（focus-guard.tsx）
  const [keyLit, setKeyLit] = React.useState(false)
  React.useEffect(() => {
    if (!focusFirst || resting) return
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const root = node.current
        const now = document.activeElement
        if (!root || search.current || (now && now !== root && root.contains(now))) return
        // 指针打开的不算键盘焦点（不然 Chrome 把程序聚焦也算成 :focus-visible，后面整串指针换行都被当成键盘）
        enabledRows(root)[0]?.focus({ preventScroll: true, focusVisible: fromKeyboard() } as FocusOptions)
      })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [focusFirst, resting])
  const checkedRadio = rows.findIndex((r) => r.kind === "menuitemradio" && r.checked)
  return (
    <SearchHost value={register}>
      <PopupMotion
        ref={refs}
        anchored
        {...props}
        onPointerEnter={(e) => {
          onPointerEnter?.(e)
          litBy.current = "pointer"
          hover.handlers.onPointerEnter(e)
        }}
        onPointerMoveCapture={(e) => {
          // 指针移到哪行，Radix 就把焦点给哪行；抢先一步用 focusVisible: false 聚焦，这一串就不算键盘焦点，
          // 悬停底照常跟随滑动。有子菜单开着时不抢：Radix 要判断指针是不是正往子菜单去
          const row = (e.target as Element).closest<HTMLElement>(ROW)
          const root = e.currentTarget
          if (e.pointerType === "touch" || !row || row === document.activeElement || row.closest("[role=menu]") !== root || row.hasAttribute("data-disabled")) return
          if (root.querySelector(":scope [aria-haspopup=menu][data-state=open]")) return
          row.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
        }}
        onPointerMove={(e) => {
          onPointerMove?.(e)
          litBy.current = "pointer"
          hover.handlers.onPointerMove(e)
        }}
        onPointerLeave={(e) => {
          onPointerLeave?.(e)
          hover.handlers.onPointerLeave(e)
        }}
        onClick={(e) => {
          onClick?.(e)
          hover.handlers.onClick(e)
        }}
        onScroll={(e) => {
          onScroll?.(e)
          hover.handlers.onScroll()
        }}
        onFocus={(e) => {
          onFocus?.(e)
          const index = elements.current.indexOf(e.target as HTMLElement)
          if (index >= 0) hover.setActiveIndex(index)
          // 焦点到了行以外的东西（搜索框）：没有行亮着；菜单面自己接焦点（指针离开行、在空隙里）不算
          else if (e.target !== e.currentTarget) hover.setActiveIndex(null)
          setKeyLit(index >= 0 && (e.target as HTMLElement).matches(":focus-visible"))
        }}
        onBlur={(e) => {
          onBlur?.(e)
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          hover.setActiveIndex(null)
          setKeyLit(false)
        }}
        onKeyDownCapture={(e) => {
          onKeyDownCapture?.(e)
          litBy.current = "keyboard"
          redirectToSearch(e, search.current)
        }}
      >
        <MenuSelection rows={rows} rects={hover.isMeasured ? hover.itemRects : []} />
        <FluidHoverHighlight hover={hover} hidden={keyLit} from={litBy.current === "pointer" && checkedRadio >= 0 ? checkedRadio : null} className="rounded-popover-item" />
        {children}
      </PopupMotion>
    </SearchHost>
  )
}

/**
 * 有搜索框时，焦点在行上也能接着打字：字符与退格送进搜索框；输入法起手（组字）先把焦点交给框，字落在框里。
 * 空格留给行（选中这一行）。在首行按 ↑、末行按 ↓ 回到搜索框（框是行这一圈里的一站），列表滚回顶上。
 */
function redirectToSearch(e: React.KeyboardEvent<HTMLElement>, handle: SearchHandle | null) {
  const input = handle?.input()
  const target = e.target as HTMLElement
  if (!handle || !input || target === input || !target.matches(ROW) || e.metaKey || e.ctrlKey || e.altKey) return
  if (isComposing(e.nativeEvent) || e.key === "Process") return input.focus()
  const take = () => {
    e.preventDefault()
    e.stopPropagation()
    input.focus()
  }
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    const rows = enabledRows(e.currentTarget)
    if (target !== (e.key === "ArrowUp" ? rows[0] : rows[rows.length - 1])) return
    take()
    e.currentTarget.scrollTop = 0
  } else if (e.key.length === 1 && e.key !== " ") {
    take()
    handle.append(e.key)
  } else if (e.key === "Backspace") {
    take()
    handle.back()
  }
}

/**
 * 菜单顶上的搜索框（下拉菜单导出为 DropdownMenuSearch）：吸在菜单顶，左右上贴到菜单边（分隔线通栏），行从它下面滚过。受控：按 value 自己筛要渲染的行。
 * 打开两帧后自己拿焦点（静止展示的不拿），光标就是焦点；↓ / ↑ 进入首行 / 末行；回车不选任何行（只有移到的行才执行）。
 * 输入法组字途中不回传，组完回传一次（DESIGN.md「输入法」）。菜单关掉（框卸载）时清空，下次打开是全表（clearOnClose）。
 */
function MenuSearch({
  value,
  onValueChange,
  clearOnClose = true,
  placeholder = "搜索",
  className,
  onKeyDown,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "defaultValue" | "onChange"> & {
  value: string
  onValueChange: (value: string) => void
  clearOnClose?: boolean
}) {
  const host = React.useContext(SearchHost)
  const [resting] = React.useState(usePopup().resting)
  const input = React.useRef<HTMLInputElement>(null)
  const [draft, setDraft] = React.useState(value)
  const composing = React.useRef(false)
  const latest = React.useRef({ draft, onValueChange, clearOnClose, value })
  latest.current = { draft, onValueChange, clearOnClose, value }
  React.useEffect(() => {
    if (!composing.current) setDraft(value)
  }, [value])
  const commit = React.useCallback((next: string) => {
    setDraft(next)
    if (!composing.current) latest.current.onValueChange(next)
  }, [])
  React.useEffect(() => {
    host?.({ input: () => input.current, append: (text) => commit(latest.current.draft + text), back: () => commit(latest.current.draft.slice(0, -1)) })
    return () => {
      host?.(null)
      if (latest.current.clearOnClose && latest.current.value !== "") latest.current.onValueChange("")
    }
  }, [host, commit])
  React.useEffect(() => {
    if (resting) return
    let inner = 0
    const outer = requestAnimationFrame(() => (inner = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }))))
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [resting])
  return (
    <div
      data-slot="menu-search"
      // ds-field：框的焦点由这一行自己表示（放大镜变深、线变粗，加上光标），不画环（DESIGN.md §4.3）
      className="ds-field group/search sticky -top-(--ds-pad-popover) z-10 -mx-(--ds-pad-popover) -mt-(--ds-pad-popover) mb-1 flex h-(--ds-h-md) items-center gap-(--ds-gap-control) border-b border-line bg-(--ds-surface,var(--ds-canvas)) px-[calc(var(--ds-pad-popover)+var(--ds-pad-row))]"
    >
      <Search aria-hidden className="size-(--ds-icon) shrink-0 text-fg-muted transition-[color,stroke-width] duration-(--ds-dur-fast) ease-ds group-focus-within/search:text-fg group-focus-within/search:stroke-2" />
      <input
        ref={input}
        type="text"
        role="searchbox"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => commit(e.target.value)}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={(e) => {
          composing.current = false
          commit(e.currentTarget.value)
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          // Esc、Tab 交给菜单（关闭 / 离开）；其余是打字或在这里处理的移动，不让菜单的首字母跳转看到
          if (e.defaultPrevented || e.key === "Escape" || e.key === "Tab") return
          e.stopPropagation()
          if (isComposing(e.nativeEvent)) return
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            const menu = e.currentTarget.closest<HTMLElement>("[role=menu]")
            const rows = menu ? enabledRows(menu) : []
            if (!rows.length) return
            e.preventDefault()
            ;(e.key === "ArrowDown" ? rows[0] : rows[rows.length - 1]).focus()
          } else if (e.key === "Enter") e.preventDefault()
        }}
        className={cn("min-w-0 flex-1 bg-transparent text-(length:--ds-text-control) leading-(--ds-lh-control) text-fg outline-none placeholder:text-fg-muted", className)}
        {...props}
      />
    </div>
  )
}

/** 勾在行尾：16 · 紧凑 14，勾上时画出来（淡入 80 / 淡出 60）。indicator 传各自 Radix 的 ItemIndicator */
function ItemCheck({ indicator: Indicator }: { indicator: typeof DropdownMenuPrimitive.ItemIndicator }) {
  return (
    <span className="ml-auto flex size-(--ds-icon) items-center justify-center">
      <Indicator forceMount className="transition-opacity duration-(--ds-dur-fast-exit) ease-ds data-[state=checked]:duration-(--ds-dur-fast) data-[state=unchecked]:opacity-0">
        <Check aria-hidden className="text-fg!" />
      </Indicator>
    </span>
  )
}

/** 行尾快捷键：平时透明，这一行亮着（悬停或键盘移到）时淡入 80、离开淡出 60；触屏不显示。键位同时写在行的 aria-keyshortcuts 上 */
function MenuShortcut({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="menu-shortcut"
      className={cn(
        "ml-auto font-sans text-xs font-normal whitespace-nowrap text-fg-muted tabular-nums opacity-0 transition-opacity duration-(--ds-dur-fast-exit) ease-ds",
        "group-data-[fluid-hover]/item:opacity-100 group-data-[fluid-hover]/item:duration-(--ds-dur-fast) pointer-coarse:hidden",
        className
      )}
      {...props}
    />
  )
}

export { ItemCheck, MenuBody, MenuSearch, MenuShortcut, menuItemClass, menuSurface }
