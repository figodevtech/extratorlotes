import * as React from "react";
import { cn } from "@/lib/utils";

export function Progress({
  value = 0,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { value?: number }) {
  const safeValue = Math.max(0, Math.min(100, value));

  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-secondary", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safeValue}
      {...props}
    >
      <div
        className="h-full bg-primary transition-all duration-300"
        style={{ width: `${safeValue}%` }}
      />
    </div>
  );
}
