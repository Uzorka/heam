"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { useServerAction } from "@/components/forms/use-action";
import { useToast } from "@/components/forms/toaster";
import { receiveGoodsAction } from "../../../actions";

interface Item {
  id: string;
  name: string;
  unit: string;
  outstanding: number;
  trackExpiry: boolean;
}
interface Line {
  include: boolean;
  quantity: string;
  lotNumber: string;
  expiryDate: string;
  manufacturer: string;
  quarantine: boolean;
}

export function ReceiveForm({
  purchaseOrderId,
  items,
  locations,
}: {
  purchaseOrderId: string;
  items: Item[];
  locations: { id: string; name: string }[];
}) {
  const toast = useToast();
  const { run, pending, error, fieldErrors } = useServerAction(receiveGoodsAction);
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [locationId, setLocationId] = React.useState(locations[0]?.id ?? "");
  const [deliveryNote, setDeliveryNote] = React.useState("");
  const init = () =>
    Object.fromEntries(
      items.map((i) => [
        i.id,
        {
          include: true,
          quantity: String(i.outstanding),
          lotNumber: "",
          expiryDate: "",
          manufacturer: "",
          quarantine: false,
        },
      ]),
    ) as Record<string, Line>;
  const [lines, setLines] = React.useState<Record<string, Line>>(init);
  const update = (id: string, patch: Partial<Line>) =>
    setLines((ls) => ({ ...ls, [id]: { ...ls[id]!, ...patch } }));
  const included = items.filter((i) => lines[i.id]?.include);

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          {
            purchaseOrderId,
            locationId,
            deliveryNote: deliveryNote.trim() || undefined,
            idempotencyKey: key,
            lines: included.map((i) => {
              const l = lines[i.id]!;
              return {
                poItemId: i.id,
                quantity: Number(l.quantity) || 0,
                lotNumber: l.lotNumber,
                expiryDate: l.expiryDate || undefined,
                manufacturer: l.manufacturer.trim() || undefined,
                quarantine: l.quarantine,
              };
            }),
          },
          (r) => {
            toast(r.duplicate ? `Already recorded as ${r.ref}.` : `Goods received: ${r.ref}.`);
            setKey(crypto.randomUUID());
            setLines(init());
            setDeliveryNote("");
          },
        );
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Receive into" htmlFor="grn-location" required>
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Supplier delivery note / invoice no." htmlFor="grn-note">
          <Input value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} />
        </Field>
      </div>
      {items.map((i, idx) => {
        const l = lines[i.id]!;
        const err = (f: string) => fieldErrors[`lines.${included.indexOf(i)}.${f}`];
        return (
          <fieldset key={i.id} className="rounded-md border border-border p-3" disabled={i.outstanding === 0}>
            <legend className="px-1 text-[13px] font-medium">
              {i.name} - {i.outstanding} {i.unit}(s) outstanding
            </legend>
            <label className="mb-2 flex items-center gap-2 text-[14px]">
              <Checkbox checked={l.include} onChange={(e) => update(i.id, { include: e.target.checked })} />{" "}
              Received in this delivery
            </label>
            {l.include && (
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Quantity" htmlFor={`grn-${idx}-q`} required error={err("quantity")}>
                  <Input
                    type="number"
                    min={1}
                    max={i.outstanding}
                    value={l.quantity}
                    onChange={(e) => update(i.id, { quantity: e.target.value })}
                  />
                </Field>
                <Field label="Lot / batch no." htmlFor={`grn-${idx}-lot`} required error={err("lotNumber")}>
                  <Input value={l.lotNumber} onChange={(e) => update(i.id, { lotNumber: e.target.value })} />
                </Field>
                <Field
                  label="Expiry date"
                  htmlFor={`grn-${idx}-exp`}
                  required={i.trackExpiry}
                  error={err("expiryDate")}
                >
                  <Input
                    type="date"
                    value={l.expiryDate}
                    onChange={(e) => update(i.id, { expiryDate: e.target.value })}
                  />
                </Field>
                <Field label="Manufacturer" htmlFor={`grn-${idx}-mfr`}>
                  <Input
                    value={l.manufacturer}
                    onChange={(e) => update(i.id, { manufacturer: e.target.value })}
                  />
                </Field>
                <label className="flex items-start gap-2 text-[14px] sm:col-span-4">
                  <Checkbox
                    checked={l.quarantine}
                    onChange={(e) => update(i.id, { quarantine: e.target.checked })}
                    className="mt-0.5"
                  />
                  <span>
                    Quarantine this lot
                    <span className="block text-xs text-muted">
                      e.g. damaged packaging or awaiting quality checks. It cannot be dispensed until an
                      approver releases it.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </fieldset>
        );
      })}
      <Button type="submit" loading={pending} disabled={included.length === 0 || !locationId}>
        Record goods received
      </Button>
    </form>
  );
}
