"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

// Track open state so the trigger can TOGGLE (Radix's Select trigger only opens
// on pointer-down; a second click could otherwise re-open it immediately).
const SelectOpenContext = React.createContext<{ open: boolean; setOpen: (v: boolean) => void } | null>(null);

function Select({
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const [uncontrolled, setUncontrolled] = React.useState<boolean>(defaultOpen ?? false);
  const isControlled = open !== undefined;
  const actualOpen = isControlled ? open : uncontrolled;
  const setOpen = React.useCallback(
    (v: boolean) => {
      if (!isControlled) setUncontrolled(v);
      onOpenChange?.(v);
    },
    [isControlled, onOpenChange]
  );
  return (
    <SelectOpenContext.Provider value={{ open: !!actualOpen, setOpen }}>
      <SelectPrimitive.Root open={actualOpen} onOpenChange={setOpen} {...props}>
        {children}
      </SelectPrimitive.Root>
    </SelectOpenContext.Provider>
  );
}

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => {
  const ctx = React.useContext(SelectOpenContext);
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex h-10 w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background transition-colors hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground [&>span]:line-clamp-1",
        className
      )}
      {...props}
      onPointerDown={(e) => {
        props.onPointerDown?.(e);
        // Already open → close it ourselves and stop Radix from re-opening.
        if (ctx?.open && !e.defaultPrevented) {
          e.preventDefault();
          ctx.setOpen(false);
        }
      }}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50 transition-transform duration-200 data-[state=open]:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-lg border bg-background text-foreground shadow-lg",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
        position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)]"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-pointer select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
};
