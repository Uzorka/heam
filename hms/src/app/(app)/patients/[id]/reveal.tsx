"use client";
import * as React from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/forms/use-action";
import { revealIdentifierAction } from "../actions";

/** Reveals an identity number for 30 seconds. Every reveal is audited on the server. */
export function RevealIdentifier({ identifierId, masked }: { identifierId: string; masked: string }) {
  const { run, pending, error, result, reset } = useServerAction(revealIdentifierAction, { refresh: false });
  React.useEffect(() => {
    if (!result) return;
    const t = setTimeout(reset, 30_000);
    return () => clearTimeout(t);
  }, [result, reset]);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono">{result ? result.value : masked}</span>
      {!result && (
        <Button type="button" variant="link" size="sm" loading={pending} onClick={() => run({ identifierId })}>
          <Eye className="h-3.5 w-3.5" aria-hidden /> Reveal
        </Button>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
