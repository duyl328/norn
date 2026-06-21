import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";

import { cn } from "@/lib/utils";

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => {
  const [active, setActive] = React.useState(false);
  const inactiveTimerRef = React.useRef<number | null>(null);

  const activate = () => {
    if (inactiveTimerRef.current !== null) {
      window.clearTimeout(inactiveTimerRef.current);
    }

    setActive(true);
  };

  const deactivate = () => {
    if (inactiveTimerRef.current !== null) {
      window.clearTimeout(inactiveTimerRef.current);
      inactiveTimerRef.current = null;
    }

    setActive(false);
  };

  React.useEffect(() => {
    return () => {
      if (inactiveTimerRef.current !== null) {
        window.clearTimeout(inactiveTimerRef.current);
      }
    };
  }, []);

  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={cn("group/scroll-area relative overflow-hidden", active && "is-scroll-active", className)}
      type="always"
      {...props}
    >
      <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar onHoverStart={activate} onHoverEnd={deactivate} />
      <ScrollBar orientation="horizontal" onHoverStart={activate} onHoverEnd={deactivate} />
      <ScrollAreaPrimitive.Corner className="bg-transparent opacity-0" />
    </ScrollAreaPrimitive.Root>
  );
});
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

type ScrollBarProps = React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar> & {
  onHoverEnd?: () => void;
  onHoverStart?: () => void;
};

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  ScrollBarProps
>(({ className, orientation = "vertical", onHoverEnd, onHoverStart, onPointerEnter, onPointerLeave, ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    onPointerEnter={(event) => {
      onHoverStart?.();
      onPointerEnter?.(event);
    }}
    onPointerLeave={(event) => {
      onHoverEnd?.();
      onPointerLeave?.(event);
    }}
    className={cn(
      "flex touch-none select-none bg-transparent opacity-45 transition-opacity duration-200 group-[.is-scroll-active]/scroll-area:opacity-100",
      orientation === "vertical" && "h-full w-4 border-l border-l-transparent p-[3px]",
      orientation === "horizontal" && "h-4 flex-col border-t border-t-transparent p-[3px]",
      className,
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-[2px] bg-muted-foreground/30 transition-colors duration-200 group-[.is-scroll-active]/scroll-area:bg-muted-foreground/65" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export { ScrollArea, ScrollBar };
