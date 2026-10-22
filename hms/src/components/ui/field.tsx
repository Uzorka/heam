import * as React from "react";
import { cn } from "@/lib/utils";

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Label + control + hint + error, wired with aria-describedby for screen readers. */
export function Field({ label, htmlFor, error, hint, required, className, children }: FieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const child = React.isValidElement<Record<string, unknown>>(children)
    ? React.cloneElement(children, {
        id: htmlFor,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
        "aria-required": required || undefined,
      })
    : children;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        )}
      </label>
      {child}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Summary of all field errors at the top of a form (WCAG 3.3.1). */
export function ErrorSummary({ errors, title = "Please fix the following:" }: { errors: Record<string, string | undefined>; title?: string }) {
  const entries = Object.entries(errors).filter((e): e is [string, string] => !!e[1]);
  if (!entries.length) return null;
  return (
    <div role="alert" tabIndex={-1} className="rounded-md border border-danger/30 bg-danger-soft p-4 text-sm">
      <p className="font-medium text-danger">{title}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {entries.map(([k, v]) => (
          <li key={k}>
            {k === "_form" ? (
              v
            ) : (
              <a href={`#${k.replace(/\./g, "-")}`} className="underline underline-offset-2">
                {v}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
