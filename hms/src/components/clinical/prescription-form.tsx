"use client";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useServerAction } from "@/components/forms/use-action";
import { useToast } from "@/components/forms/toaster";
import { suggestQuantity } from "@/lib/dosing";
import { createPrescriptionAction } from "@/app/(app)/encounters/actions";

export interface MedOption {
  id: string;
  label: string;
  defaultRoute: string;
  dispensingUnit: string;
  controlled: boolean;
  formularyStatus: string;
  /** Usable units in this branch's pharmacies; null when the user cannot see stock. */
  inStock: number | null;
}
export interface FreqOption {
  id: string;
  code: string;
  label: string;
  timesPerDay: number | null;
}

interface Line {
  key: string;
  medicationId: string;
  dose: string;
  route: string;
  frequencyId: string;
  durationDays: string;
  prn: boolean;
  quantity: string;
  instructions: string;
}

// Keys must be identical on the server and in the browser (they feed element ids), so no random UUIDs.
const blank = (key: string): Line => ({
  key,
  medicationId: "",
  dose: "",
  route: "",
  frequencyId: "",
  durationDays: "",
  prn: false,
  quantity: "",
  instructions: "",
});

export function PrescriptionForm({
  encounterId,
  medications,
  frequencies,
  allergies,
}: {
  encounterId: string;
  medications: MedOption[];
  frequencies: FreqOption[];
  allergies: string[];
}) {
  const toast = useToast();
  const { run, pending, error, fieldErrors } = useServerAction(createPrescriptionAction);
  const idp = React.useId();
  const nextKey = React.useRef(1);
  const fresh = () => blank(String(nextKey.current++));
  const [lines, setLines] = React.useState<Line[]>(() => [blank("0")]);
  const [notes, setNotes] = React.useState("");
  const [allergiesReviewed, setAllergiesReviewed] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const update = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  if (frequencies.length === 0) {
    return (
      <Alert tone="warning" title="No approved dose frequencies">
        Prescribing is unavailable until a clinician approves the dose-frequency list in the medication
        catalogue.
      </Alert>
    );
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          {
            encounterId,
            notes: notes.trim() || undefined,
            allergiesReviewed,
            password,
            items: lines.map((l) => ({
              medicationId: l.medicationId,
              dose: l.dose,
              route: l.route,
              frequencyId: l.frequencyId,
              durationDays: l.durationDays ? Number(l.durationDays) : undefined,
              prn: l.prn,
              quantity: l.quantity ? Number(l.quantity) : 0,
              instructions: l.instructions.trim() || undefined,
            })),
          },
          (ref) => {
            toast(`Prescription ${ref} signed and sent to the pharmacy.`);
            setLines([fresh()]);
            setNotes("");
            setPassword("");
            setAllergiesReviewed(false);
          },
        );
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {lines.map((l, idx) => {
        const med = medications.find((m) => m.id === l.medicationId);
        const freq = frequencies.find((f) => f.id === l.frequencyId);
        const suggestion = suggestQuantity(
          l.dose,
          freq?.timesPerDay,
          l.durationDays ? Number(l.durationDays) : null,
        );
        const err = (f: string) => fieldErrors[`items.${idx}.${f}`];
        const id = (f: string) => `${idp}-${l.key}-${f}`;
        return (
          <fieldset key={l.key} className="rounded-md border border-border p-3">
            <legend className="px-1 text-[13px] font-medium">Medicine {idx + 1}</legend>
            <div className="grid gap-3 md:grid-cols-6">
              <Field
                label="Medicine"
                htmlFor={id("med")}
                required
                error={err("medicationId")}
                className="md:col-span-3"
              >
                <Select
                  value={l.medicationId}
                  onChange={(e) => {
                    const m = medications.find((x) => x.id === e.target.value);
                    update(l.key, { medicationId: e.target.value, route: l.route || m?.defaultRoute || "" });
                  }}
                >
                  <option value="">Choose…</option>
                  {medications.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                      {m.inStock !== null
                        ? m.inStock > 0
                          ? ` - ${m.inStock} in stock`
                          : " - none in stock"
                        : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={`Dose${med ? ` (${med.dispensingUnit}s or amount)` : ""}`}
                htmlFor={id("dose")}
                required
                error={err("dose")}
              >
                <Input
                  value={l.dose}
                  onChange={(e) => update(l.key, { dose: e.target.value })}
                  placeholder="e.g. 1"
                />
              </Field>
              <Field label="Route" htmlFor={id("route")} required error={err("route")}>
                <Input value={l.route} onChange={(e) => update(l.key, { route: e.target.value })} />
              </Field>
              <Field label="Frequency" htmlFor={id("freq")} required error={err("frequencyId")}>
                <Select
                  value={l.frequencyId}
                  onChange={(e) => update(l.key, { frequencyId: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {frequencies.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.code} - {f.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Days" htmlFor={id("days")} error={err("durationDays")}>
                <Input
                  type="number"
                  min={1}
                  value={l.durationDays}
                  onChange={(e) => update(l.key, { durationDays: e.target.value })}
                />
              </Field>
              <Field
                label={`Quantity to supply${med ? ` (${med.dispensingUnit}s)` : ""}`}
                htmlFor={id("qty")}
                required
                error={err("quantity")}
                hint={
                  suggestion ? `Calculated: ${suggestion}. Confirm or change.` : "Enter the total to supply."
                }
                className="md:col-span-2"
              >
                <Input
                  type="number"
                  min={1}
                  value={l.quantity}
                  onChange={(e) => update(l.key, { quantity: e.target.value })}
                />
              </Field>
              <div className="flex items-end gap-2 md:col-span-2">
                {suggestion && String(suggestion) !== l.quantity && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => update(l.key, { quantity: String(suggestion) })}
                  >
                    Use {suggestion}
                  </Button>
                )}
                <label className="flex min-h-9 items-center gap-2 text-[14px]">
                  <Checkbox checked={l.prn} onChange={(e) => update(l.key, { prn: e.target.checked })} /> As
                  needed (PRN)
                </label>
              </div>
              <Field
                label="Instructions for the patient"
                htmlFor={id("instr")}
                className="md:col-span-5"
                error={err("instructions")}
              >
                <Input
                  value={l.instructions}
                  onChange={(e) => update(l.key, { instructions: e.target.value })}
                  placeholder="e.g. after meals"
                />
              </Field>
              <div className="flex items-end justify-end">
                {lines.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    aria-label={`Remove medicine ${idx + 1}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden /> Remove
                  </Button>
                )}
              </div>
            </div>
            {med && (med.controlled || med.formularyStatus !== "FORMULARY" || med.inStock === 0) && (
              <p className="mt-2 flex flex-wrap gap-1.5">
                {med.controlled && <Badge tone="warning">Controlled drug</Badge>}
                {med.formularyStatus === "RESTRICTED" && <Badge tone="warning">Restricted formulary</Badge>}
                {med.formularyStatus === "NON_FORMULARY" && <Badge tone="outline">Non-formulary</Badge>}
                {med.inStock === 0 && <Badge tone="outline">Not in stock at this branch</Badge>}
              </p>
            )}
          </fieldset>
        );
      })}
      {lines.length < 20 && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setLines((ls) => [...ls, fresh()])}
        >
          <Plus className="h-4 w-4" aria-hidden /> Add another medicine
        </Button>
      )}
      <Field label="Note to pharmacy (optional)" htmlFor="rx-notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
      <Alert
        tone={allergies.length ? "warning" : "info"}
        title={allergies.length ? "Recorded allergies" : undefined}
      >
        {allergies.length ? allergies.join(", ") : "No active allergies are recorded for this patient."} No
        automated allergy or interaction checking is configured - check clinically before signing.
      </Alert>
      {allergies.length > 0 && (
        <label className="flex items-start gap-2 text-[14px]">
          <Checkbox
            checked={allergiesReviewed}
            onChange={(e) => setAllergiesReviewed(e.target.checked)}
            className="mt-0.5"
          />
          I have reviewed the recorded allergies for every medicine on this prescription.
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Your password (electronic signature)"
          htmlFor="rx-password"
          required
          error={fieldErrors.password}
        >
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      </div>
      <Button
        type="submit"
        loading={pending}
        disabled={!password || (allergies.length > 0 && !allergiesReviewed)}
      >
        Sign prescription
      </Button>
    </form>
  );
}
