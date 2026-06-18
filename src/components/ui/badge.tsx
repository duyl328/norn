import * as React from "react";

import { cn } from "@/lib/utils";

type BadgeTone = "default" | "success" | "warning" | "info" | "muted";

const tones: Record<BadgeTone, string> = {
  default: "border-border bg-secondary text-secondary-foreground",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  info: "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  muted: "border-border bg-muted text-muted-foreground",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ className, tone = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-sm border px-1.5 font-mono text-[11px] font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
