"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Generic error boundary. Shows only a reference - never stack traces or data. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The server already logged the error with its digest; nothing sensitive is logged client-side.
  }, [error]);
  return (
    <main id="main" className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 max-w-md text-[14px] text-muted">
        The page could not be loaded. If this keeps happening, contact IT support{error.digest ? ` and quote reference ${error.digest}` : ""}. Nothing you were working on has been confirmed as saved.
      </p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
