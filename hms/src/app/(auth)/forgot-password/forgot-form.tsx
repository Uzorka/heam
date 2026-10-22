"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { forgotPasswordAction, type FormState } from "../actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(forgotPasswordAction, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.message && <Alert tone="info">{state.message}</Alert>}
      <Field label="Email" htmlFor="email" required>
        <Input name="email" type="email" autoComplete="username" required />
      </Field>
      <Button type="submit" className="w-full" loading={pending}>
        Request reset link
      </Button>
      <p className="text-center text-[13px]">
        <a href="/login" className="text-accent hover:underline">
          Back to sign in
        </a>
      </p>
    </form>
  );
}
