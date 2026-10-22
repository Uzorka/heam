"use client";
import * as React from "react";
import { PenLine } from "lucide-react";
import type { ActionResult } from "@/server/action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useServerAction } from "@/components/forms/use-action";
import { useToast } from "@/components/forms/toaster";

/**
 * Electronic signature: the signed-in user re-enters their password. Used for notes, result
 * verification and reports.
 */
export function SignDialog<I extends { password: string }>({
  action,
  input,
  trigger,
  title,
  statement,
  successMessage,
  disabled,
  beforeSign,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous server actions
  action: (input: I) => Promise<ActionResult<any>>;
  input: Omit<I, "password">;
  trigger: string;
  title: string;
  statement: string;
  successMessage: string;
  disabled?: boolean;
  /** e.g. save the draft first; return false to abort. */
  beforeSign?: () => Promise<boolean>;
}) {
  const [open, setOpen] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const toast = useToast();
  const { run, pending, error, fieldErrors, reset } = useServerAction(action);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setPassword("");
          reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <PenLine className="h-4 w-4" aria-hidden /> {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description={statement}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (beforeSign && !(await beforeSign())) return;
            run({ ...input, password } as I, () => {
              toast(successMessage);
              setOpen(false);
              setPassword("");
            });
          }}
        >
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Your password" htmlFor="sign-password" required error={fieldErrors.password}>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!password}>
              Sign
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
