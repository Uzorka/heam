"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useServerAction } from "@/components/forms/use-action";
import { createPortalAccountAction } from "../../portal-actions";

/** Creates a patient portal login and shows the one-time setup link once. */
export function CreatePortalAccount({
  patientId,
  defaultEmail,
}: {
  patientId: string;
  defaultEmail?: string;
}) {
  const { run, pending, error, fieldErrors, result, reset } = useServerAction(createPortalAccountAction);
  const [email, setEmail] = React.useState(defaultEmail ?? "");
  const id = React.useId();
  return (
    <Dialog onOpenChange={(o) => !o && reset()}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          Create portal account
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Create patient portal account"
        description="The patient sets their own password from a one-time link. Verified guardians see their dependants' released records."
      >
        {error && <Alert tone="danger">{error}</Alert>}
        {result ? (
          <div className="space-y-3">
            <Alert tone="warning">
              Give this link only to the patient, in person or through a secure channel. It is shown once and
              expires {new Date(result.expiresAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}.
            </Alert>
            <Input
              readOnly
              value={result.setupLink}
              aria-label="Portal setup link"
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        ) : (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              run({ patientId, email });
            }}
          >
            <Field label="Patient's email (their sign-in)" htmlFor={id} required error={fieldErrors.email}>
              <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button type="submit" loading={pending}>
              Create account
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
