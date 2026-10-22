"use client";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useServerAction } from "@/components/forms/use-action";
import { verifyChainAction } from "./actions";

export function VerifyChainButton() {
  const { run, pending, error, result } = useServerAction(verifyChainAction, { refresh: false });
  return (
    <div className="space-y-2">
      <Button type="button" variant="secondary" loading={pending} onClick={() => run({})}>
        <ShieldCheck className="h-4 w-4" aria-hidden /> Verify integrity
      </Button>
      {error && <Alert tone="danger">{error}</Alert>}
      {result &&
        (result.ok ? (
          <Alert tone="success">Hash chain intact: {result.checked} events verified.</Alert>
        ) : (
          <Alert tone="danger" title="Integrity check failed">
            Chain broken at event #{result.brokenAtSeq}: {result.reason}. Escalate to the compliance officer and preserve database backups.
          </Alert>
        ))}
    </div>
  );
}
