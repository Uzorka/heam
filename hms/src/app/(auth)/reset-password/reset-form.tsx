"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { resetPasswordAction, type FormState } from "../actions";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(resetPasswordAction, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <input type="hidden" name="token" value={token} />
      <Field label="New password" htmlFor="password" required>
        <Input name="password" type="password" autoComplete="new-password" required />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm" required>
        <Input name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" className="w-full" loading={pending}>
        Set password
      </Button>
    </form>
  );
}
