"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useServerAction } from "@/components/forms/use-action";
import { issueResetAction } from "../../actions";

/** Issues a one-time password reset link and shows it once. */
export function ResetLinkButton({ userId }: { userId: string }) {
  const { run, pending, error, result, reset } = useServerAction(issueResetAction, { refresh: false });
  return (
    <Dialog onOpenChange={(o) => !o && reset()}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          Issue password reset link
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Password reset link"
        description="Also unlocks the account. Any earlier unused link stops working."
      >
        {error && <Alert tone="danger">{error}</Alert>}
        {result ? (
          <div className="space-y-3">
            <Alert tone="warning">
              Give this link only to the account holder, in person or through a secure channel. It is shown
              once.
            </Alert>
            <Input
              readOnly
              value={result.setupLink}
              aria-label="Reset link"
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        ) : (
          <Button loading={pending} onClick={() => run({ userId })}>
            Generate link
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
