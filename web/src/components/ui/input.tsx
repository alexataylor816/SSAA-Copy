import * as React from "react";

import { cn } from "@/lib/utils";

const PICKER_TYPES = new Set(["time", "date", "datetime-local", "month", "week"]);

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onClick, ...props }, ref) => {
    const hasPicker = !!type && PICKER_TYPES.has(type);
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          hasPicker && "cursor-pointer",
          className,
        )}
        ref={ref}
        onClick={(event) => {
          // Browsers only open the time/date picker from the small icon; open it
          // from anywhere in the field. Typing into the segments still works.
          if (hasPicker && !props.disabled && !props.readOnly) {
            try {
              event.currentTarget.showPicker?.();
            } catch {
              // Not allowed in some contexts (e.g. cross-origin iframes); the icon still works.
            }
          }
          onClick?.(event);
        }}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
