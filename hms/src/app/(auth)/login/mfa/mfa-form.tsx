"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { mfaAction, type FormState } from "../../actions";

export function MfaForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(mfaAction, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Verification code" htmlFor="code" required>
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} autoFocus className="text-center text-lg tracking-[0.4em] tabular" />
      </Field>
      <Button type="submit" className="w-full" loading={pending}>
        Verify
      </Button>
    </form>
  );
}
