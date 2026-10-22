"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { useServerAction } from "@/components/forms/use-action";
import { useToast } from "@/components/forms/toaster";
import { placeOrdersAction } from "@/app/(app)/encounters/actions";

interface Option {
  id: string;
  name: string;
  hint?: string;
}

export function OrderForm({
  encounterId,
  labTests,
  studies,
}: {
  encounterId: string;
  labTests: Option[];
  studies: Option[];
}) {
  const toast = useToast();
  const { run, pending, error, fieldErrors } = useServerAction(placeOrdersAction);
  // One idempotency key per intended submission: a double click or retry cannot create duplicates.
  const [requestGroupId, setRequestGroupId] = React.useState(() => crypto.randomUUID());
  const [lab, setLab] = React.useState<string[]>([]);
  const [img, setImg] = React.useState<string[]>([]);
  const [procedure, setProcedure] = React.useState("");
  const [referral, setReferral] = React.useState("");
  const [priority, setPriority] = React.useState<"ROUTINE" | "URGENT" | "STAT">("ROUTINE");
  const [indication, setIndication] = React.useState("");
  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const count = lab.length + img.length + (procedure.trim() ? 1 : 0) + (referral.trim() ? 1 : 0);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          {
            encounterId,
            requestGroupId,
            priority,
            clinicalIndication: indication,
            items: [
              ...lab.map((labTestId) => ({ kind: "LAB" as const, labTestId })),
              ...img.map((imagingStudyId) => ({ kind: "IMAGING" as const, imagingStudyId })),
              ...(procedure.trim() ? [{ kind: "PROCEDURE" as const, description: procedure.trim() }] : []),
              ...(referral.trim() ? [{ kind: "REFERRAL" as const, description: referral.trim() }] : []),
            ],
          },
          (d) => {
            toast(`Ordered: ${d.refs.join(", ")}`);
            setLab([]);
            setImg([]);
            setProcedure("");
            setReferral("");
            setIndication("");
            setRequestGroupId(crypto.randomUUID());
          },
        );
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Laboratory</legend>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {labTests.length === 0 && (
              <p className="p-1 text-[13px] text-muted">No active tests in the catalogue.</p>
            )}
            {labTests.map((t) => (
              <label
                key={t.id}
                className="flex min-h-9 items-center gap-2 rounded px-1 text-[14px] hover:bg-surface-2"
              >
                <Checkbox checked={lab.includes(t.id)} onChange={() => toggle(lab, setLab, t.id)} />
                <span>
                  {t.name}
                  {t.hint && <span className="ml-1 text-xs text-muted">{t.hint}</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Imaging</legend>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {studies.length === 0 && (
              <p className="p-1 text-[13px] text-muted">No active studies in the catalogue.</p>
            )}
            {studies.map((t) => (
              <label
                key={t.id}
                className="flex min-h-9 items-center gap-2 rounded px-1 text-[14px] hover:bg-surface-2"
              >
                <Checkbox checked={img.includes(t.id)} onChange={() => toggle(img, setImg, t.id)} />
                <span>
                  {t.name}
                  {t.hint && <span className="ml-1 text-xs text-muted">{t.hint}</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Procedure (optional)" htmlFor="order-procedure">
          <Input
            value={procedure}
            onChange={(e) => setProcedure(e.target.value)}
            placeholder="e.g. Wound dressing"
          />
        </Field>
        <Field label="Referral (optional)" htmlFor="order-referral">
          <Input
            value={referral}
            onChange={(e) => setReferral(e.target.value)}
            placeholder="e.g. Ophthalmology, General Hospital"
          />
        </Field>
        <Field label="Priority" htmlFor="order-priority" required>
          <Select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
            <option value="ROUTINE">Routine</option>
            <option value="URGENT">Urgent</option>
            <option value="STAT">STAT (immediate)</option>
          </Select>
        </Field>
        <Field
          label="Clinical indication"
          htmlFor="order-indication"
          required
          error={fieldErrors.clinicalIndication}
          className="md:col-span-2"
        >
          <Textarea value={indication} onChange={(e) => setIndication(e.target.value)} rows={2} />
        </Field>
      </div>
      {fieldErrors.items && <p className="text-xs font-medium text-danger">{fieldErrors.items}</p>}
      <Button type="submit" loading={pending} disabled={count === 0}>
        Place {count || ""} order{count === 1 ? "" : "s"}
      </Button>
    </form>
  );
}
