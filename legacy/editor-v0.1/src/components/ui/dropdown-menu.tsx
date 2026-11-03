import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal

export function DropdownMenuContent({ className = '', ...props }: DropdownMenuPrimitive.DropdownMenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={6}
        className={`z-50 min-w-52 rounded-md border border-[var(--border)] bg-[var(--panel)] p-1.5 text-[var(--ink)] shadow-xl outline-none ${className}`}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export function DropdownMenuItem({ className = '', ...props }: DropdownMenuPrimitive.DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      className={`flex cursor-default select-none items-center gap-2 rounded px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-[var(--line-wash)] ${className}`}
      {...props}
    />
  )
}

export function DropdownMenuSeparator() {
  return <DropdownMenuPrimitive.Separator className="my-1 border-t border-[var(--border)]" />
}
