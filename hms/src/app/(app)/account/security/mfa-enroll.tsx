"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { useServerAction } from "@/components/forms/use-action";
import { useToast } from "@/components/forms/toaster";
import { beginMfaAction, confirmMfaAction } from "../actions";

export function MfaEnroll() {
  const toast = useToast();
  const begin = useServerAction(beginMfaAction, { refresh: false });
  const confirm = useServerAction(confirmMfaAction);
  const [code, setCode] = React.useState("");
  if (!begin.result) {
    return (
      <div className="space-y-2">
        {begin.error && <Alert tone="danger">{begin.error}</Alert>}
        <Button loading={begin.pending} onClick={() => begin.run({})}>
          Set up two-step verification
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-[14px]">
        <li>Open an authenticator app (e.g. Google Authenticator, Microsoft Authenticator).</li>
        <li>Scan the code below, or enter the key manually.</li>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL QR code */}
      <img
        src={begin.result.qrDataUrl}
        alt="QR code for your authenticator app"
        width={180}
        height={180}
        className="rounded-md border border-border bg-white p-2"
      />
      <p className="text-[13px]">
        Manual key:{" "}
        <code className="break-all rounded bg-surface-2 px-1.5 py-0.5 font-mono">{begin.result.secret}</code>
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          confirm.run({ code }, () => toast("Two-step verification is on."));
        }}
      >
        <Field
          label="6-digit code"
          htmlFor="totp"
          error={confirm.fieldErrors.code ?? confirm.error ?? undefined}
        >
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="w-36 text-center tracking-[0.3em]"
          />
        </Field>
        <Button type="submit" loading={confirm.pending}>
          Turn on
        </Button>
      </form>
    </div>
  );
}
