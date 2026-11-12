import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[2px] border border-rule px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-mute",
        className,
      )}
      {...props}
    />
  );
}
