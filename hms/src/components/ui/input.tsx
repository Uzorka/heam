import * as React from "react";
import { cn } from "@/lib/utils";

const base =
  "block w-full rounded-md border border-border bg-background px-3 text-[15px] text-foreground placeholder:text-muted/70 disabled:cursor-not-allowed disabled:bg-surface-2 aria-[invalid=true]:border-danger";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(base, "min-h-11 sm:min-h-9", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(base, "min-h-20 py-2", className)} {...props} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(base, "min-h-11 pr-8 sm:min-h-9", className)} {...props}>
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export function Checkbox({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn(
        "h-5 w-5 shrink-0 rounded border-border accent-[hsl(var(--accent))] sm:h-4 sm:w-4",
        className,
      )}
      {...props}
    />
  );
}
