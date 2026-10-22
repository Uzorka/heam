"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/server/action";

/**
 * Call a typed server action from a client component. Success messages are only shown when the
 * server confirmed the change - never optimistically.
 */
export function useServerAction<I, O>(
  action: (input: I) => Promise<ActionResult<O>>,
  opts: { refresh?: boolean } = {},
) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [result, setResult] = React.useState<O | null>(null);

  const run = React.useCallback(
    (input: I, onSuccess?: (data: O) => void) => {
      setError(null);
      setFieldErrors({});
      start(async () => {
        try {
          const r = await action(input);
          if (r.ok) {
            setResult(r.data);
            if (opts.refresh !== false) router.refresh();
            onSuccess?.(r.data);
          } else {
            setError(r.error);
            setFieldErrors(r.fieldErrors ?? {});
          }
        } catch {
          setError("Could not reach the server. Check your connection; nothing was confirmed as saved.");
        }
      });
    },
    [action, opts.refresh, router],
  );

  const reset = React.useCallback(() => {
    setError(null);
    setFieldErrors({});
    setResult(null);
  }, []);

  return { run, pending, error, fieldErrors, result, reset };
}
