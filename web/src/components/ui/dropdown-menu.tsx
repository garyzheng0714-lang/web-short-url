"use client"

import * as React from "react"
import { ChevronRight } from "lucide-react"
import { AnimatePresence, useComposedRefs } from "motion/react"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

import { useDensityProps } from "@/components/ui/density"
import { ELEVATION, Elevated } from "@/components/ui/elevated"
import { fromKeyboard } from "@/components/ui/hotkeys"
import { ItemCheck, MenuBody, MenuSearch, MenuShortcut, menuItemClass, menuSurface } from "@/components/ui/menu-body"
import { usePortalContainer } from "@/components/ui/portal-scope"
import { PopupContext, keepOutsideFocus, useOpenState, useOutsidePointerRelease, usePopup } from "@/components/ui/popup"

/**
 * 下拉菜单（DESIGN.md K3、§2.4、§4.3）：一个按钮后面的一组动作或选项。面、行、悬停底、选中底、搜索框与行尾快捷键见 menu-body.tsx（右键菜单共用）。
 * - 菜单面最大高 min(480, 可用高)；离触发器 8、离屏幕边 ≥ 8，放不下翻到对侧。底色与阴影由 Elevated 给（所在层 + 2，阴影固定第 3 层：
 *   对话框里打开的菜单仍分得出层）；在 Density 区域里打开的菜单跟着变紧凑（useDensityProps）。
 * - 复选项点了不关菜单（closeOnSelect 改回）；单选项点了停 300ms 再关，让勾和选中底走完（Esc、点外面、再点触发器立刻关）。
 *   停的时候页面照常接指针（popup.tsx 的 useOutsidePointerRelease）：点外面的那一下落到下面的元素上；按进了别处的输入框，焦点留在那里。
 * - 方向键首尾循环（loop），跳过禁用项；有搜索框时首行 ↑、末行 ↓ 回到框里。
 * 动效（popup.tsx 的 PopupMotion anchored；键盘与指针同一套）：
 * - 打开 → 透明度 + scaleY 0.96 + 朝触发器 4px，fast（0.08s）；方向跟着翻转后的实际一侧，原点在贴触发器的那条边。子菜单从父行旁横向滑入。
 * - 关闭 → EXIT.fast（0.06s），不回放进场。
 * - 减少动态 → 不缩放、不位移，只淡入淡出。
 * 关闭后焦点回到触发器；只有键盘关的显示焦点环（2026-10-06 共用层）。点到菜单外面关的，焦点留在点到的地方（Radix 原行为）。
 */
/** 过渡期，给还没接跟随悬停与 Elevated 的 select 用：行自己画高亮、面自己画底与阴影。select 迁完删除这两个导出 */
const dropdownMenuItemClass = cn(menuItemClass, "data-highlighted:bg-hover")
const dropdownMenuSurface = "min-w-44 overflow-hidden rounded-popover bg-menu p-(--ds-pad-popover) text-sm text-fg shadow-popover"

/** 单选点了以后停多久再关（DESIGN.md §4.3：让勾和选中底走完） */
const SETTLE_MS = 300

/** 触发器节点（关菜单时由这里回焦，Radix 不公开它的 triggerRef）与关掉整个菜单（子菜单里的单选也关根菜单） */
/** settle：单选点了以后停着等关——页面放开指针（release），面板也不再接指针（leaving） */
const MenuRoot = React.createContext<{ trigger: React.RefObject<HTMLElement | null>; close: () => void; settle: () => void; leaving: boolean } | null>(null)

function DropdownMenu({ open, defaultOpen, onOpenChange, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const state = useOpenState(open, defaultOpen, onOpenChange)
  const trigger = React.useRef<HTMLElement | null>(null)
  const isOpen = React.useRef(state.open)
  isOpen.current = state.open
  const close = React.useCallback(() => isOpen.current && state.setOpen(false), [state])
  const release = useOutsidePointerRelease(state.open)
  const [leaving, setLeaving] = React.useState(false)
  const settle = React.useCallback(() => {
    release()
    setLeaving(true)
  }, [release])
  React.useLayoutEffect(() => {
    if (!state.open) setLeaving(false)
  }, [state.open])
  return (
    <PopupContext value={state}>
      <MenuRoot value={{ trigger, close, settle, leaving }}>
        <DropdownMenuPrimitive.Root {...props} open={state.open} onOpenChange={state.setOpen} />
      </MenuRoot>
    </PopupContext>
  )
}

function DropdownMenuTrigger({ ref, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  const root = React.useContext(MenuRoot)
  const refs = useComposedRefs(ref, root?.trigger)
  return <DropdownMenuPrimitive.Trigger ref={refs} {...props} />
}

function DropdownMenuContent({
  className,
  align = "end",
  sideOffset = 8,
  loop = true,
  onInteractOutside,
  onPointerDownOutside,
  onCloseAutoFocus,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const { open } = usePopup()
  const container = usePortalContainer()
  const density = useDensityProps()
  const root = React.useContext(MenuRoot)
  const outside = React.useRef(false)
  const pressedOutside = React.useRef(false)
  return (
    <AnimatePresence>
      {open ? (
        <DropdownMenuPrimitive.Portal forceMount container={container}>
          <Elevated asChild {...ELEVATION.popover}>
            <DropdownMenuPrimitive.Content
              forceMount
              asChild
              align={align}
              sideOffset={sideOffset}
              loop={loop}
              collisionPadding={8}
              onInteractOutside={(e) => {
                outside.current = true
                onInteractOutside?.(e)
              }}
              onPointerDownOutside={(e) => {
                pressedOutside.current = true
                onPointerDownOutside?.(e)
              }}
              onCloseAutoFocus={(e) => {
                onCloseAutoFocus?.(e)
                keepOutsideFocus(e, pressedOutside.current)
                const wasOutside = outside.current
                outside.current = false
                pressedOutside.current = false
                const trigger = root?.trigger.current
                if (e.defaultPrevented || fromKeyboard() || wasOutside || !trigger?.isConnected) return
                e.preventDefault()
                trigger.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
              }}
              {...density}
              {...props}
            >
              <MenuBody
                data-slot="dropdown-menu-content"
                leaving={root?.leaving}
                className={cn(menuSurface, "z-50 max-h-[min(480px,var(--radix-dropdown-menu-content-available-height))] origin-(--radix-dropdown-menu-content-transform-origin)", className)}
              >
                {children}
              </MenuBody>
            </DropdownMenuPrimitive.Content>
          </Elevated>
        </DropdownMenuPrimitive.Portal>
      ) : null}
    </AnimatePresence>
  )
}

function DropdownMenuItem({
  className,
  tone = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { tone?: "default" | "danger" }) {
  return <DropdownMenuPrimitive.Item className={cn(menuItemClass, tone === "danger" && "[&_svg]:text-danger", className)} {...props} />
}

const DropdownMenuShortcut = MenuShortcut
const DropdownMenuSearch = MenuSearch

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label className={cn("px-(--ds-pad-row) pt-2 pb-1 text-xs font-medium text-fg-muted", className)} {...props} />
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn("-mx-(--ds-pad-popover) my-1 h-px bg-line", className)} {...props} />
}

const DropdownMenuGroup = DropdownMenuPrimitive.Group

function DropdownMenuSub({ open, defaultOpen, onOpenChange, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  const state = useOpenState(open, defaultOpen, onOpenChange)
  return (
    <PopupContext value={state}>
      <DropdownMenuPrimitive.Sub {...props} open={state.open} onOpenChange={state.setOpen} />
    </PopupContext>
  )
}

/** 复选项：勾在行尾，点了不关菜单（closeOnSelect 改回点了就关）；相邻勾上的行合成一块选中底。 */
function DropdownMenuCheckboxItem({
  className,
  children,
  closeOnSelect = false,
  onSelect,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & { closeOnSelect?: boolean }) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(menuItemClass, className)}
      onSelect={(e) => {
        onSelect?.(e)
        if (!closeOnSelect) e.preventDefault()
      }}
      {...props}
    >
      {children}
      <ItemCheck indicator={DropdownMenuPrimitive.ItemIndicator} />
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

/** 单选组：同一组里只有一项选中（排序方式、视图密度）。选中底滑到新行，停 300ms 再关；要一直开着比较时在 onSelect 里 preventDefault。 */
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

function DropdownMenuRadioItem({ className, children, onSelect, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  const root = React.useContext(MenuRoot)
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(menuItemClass, className)}
      onSelect={(e) => {
        onSelect?.(e)
        if (e.defaultPrevented || !root) return
        e.preventDefault()
        root.settle()
        window.setTimeout(root.close, SETTLE_MS)
      }}
      {...props}
    >
      {children}
      <ItemCheck indicator={DropdownMenuPrimitive.ItemIndicator} />
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuSubTrigger({ className, children, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    // 子菜单开着、悬停底已经移走（指针进了子菜单）时，父行自己垫一块悬停色，看得出是从哪行展开的
    <DropdownMenuPrimitive.SubTrigger className={cn(menuItemClass, "data-[state=open]:not-data-[fluid-hover]:bg-hover", className)} {...props}>
      {children}
      <ChevronRight aria-hidden className="ml-auto" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

/** 子菜单：从父行旁横向滑入（fast），子菜单第一行与父行同一条上沿。 */
function DropdownMenuSubContent({
  className,
  sideOffset = 14,
  // −6 = −弹层内边距：子菜单第一项与父项同一条上沿（−4 时低 2px，2026-10-04 复查量到）
  alignOffset = -6,
  loop = true,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  const { open } = usePopup()
  const container = usePortalContainer()
  const density = useDensityProps()
  return (
    <AnimatePresence>
      {open ? (
        <DropdownMenuPrimitive.Portal forceMount container={container}>
          <Elevated asChild {...ELEVATION.popover}>
            <DropdownMenuPrimitive.SubContent forceMount asChild sideOffset={sideOffset} alignOffset={alignOffset} loop={loop} collisionPadding={8} updatePositionStrategy="always" {...density} {...props}>
              {/* 来源是父项（比父菜单内缩 6）：14 = 内缩 6 + 外壳间隔 8。窄屏按 Radix 实测的剩余空间定宽、长的项换行 */}
              <MenuBody
                focusFirst={false}
                data-slot="dropdown-menu-sub-content"
                className={cn(menuSurface, "z-50 max-h-[min(480px,var(--radix-dropdown-menu-content-available-height))] origin-(--radix-dropdown-menu-content-transform-origin) min-w-[min(11rem,var(--radix-dropdown-menu-content-available-width))] max-w-(--radix-dropdown-menu-content-available-width) [&_[role^=menuitem]]:h-auto [&_[role^=menuitem]]:min-h-(--ds-h-md) [&_[role^=menuitem]]:whitespace-normal [&_[role^=menuitem]]:break-words", className)}
              >
                {children}
              </MenuBody>
            </DropdownMenuPrimitive.SubContent>
          </Elevated>
        </DropdownMenuPrimitive.Portal>
      ) : null}
    </AnimatePresence>
  )
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  dropdownMenuItemClass,
  dropdownMenuSurface,
}
