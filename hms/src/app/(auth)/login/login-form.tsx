"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { loginAction, type FormState } from "../actions";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      {notice && <Alert tone="info">{notice}</Alert>}
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email" required>
        <Input name="email" type="email" autoComplete="username" autoFocus required />
      </Field>
      <Field label="Password" htmlFor="password" required>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" className="w-full" loading={pending}>
        Sign in
      </Button>
      <p className="text-center text-[13px]">
        <a href="/forgot-password" className="text-accent hover:underline">
          Forgot password?
        </a>
      </p>
    </form>
  );
}
