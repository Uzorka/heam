"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { useServerAction } from "@/components/forms/use-action";
import { useToast } from "@/components/forms/toaster";
import { dispenseAction } from "../actions";

export interface LotOption {
  lotId: string;
  locationId: string;
  label: string;
  quantity: number;
  problem: string | null;
}

export function DispenseForm({
  itemId,
  remaining,
  unit,
  locations,
  lots,
}: {
  itemId: string;
  remaining: number;
  unit: string;
  locations: { id: string; name: string }[];
  lots: LotOption[];
}) {
  const toast = useToast();
  const { run, pending, error, fieldErrors } = useServerAction(dispenseAction);
  // One key per intended dispense: a double click or network retry cannot issue stock twice.
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [locationId, setLocationId] = React.useState(locations[0]?.id ?? "");
  const [lotId, setLotId] = React.useState("");
  const [quantity, setQuantity] = React.useState(String(remaining));
  const [counselled, setCounselled] = React.useState(false);
  const here = lots.filter((l) => l.locationId === locationId);
  const usable = here.filter((l) => !l.problem).reduce((s, l) => s + l.quantity, 0);
  const id = (f: string) => `disp-${itemId}-${f}`;

  if (locations.length === 0)
    return <Alert tone="warning">No pharmacy stock location is configured for this branch.</Alert>;

  return (
    <form
      noValidate
      className="space-y-3 rounded-md bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          {
            itemId,
            locationId,
            lotId: lotId || undefined,
            quantity: Number(quantity),
            counsellingGiven: counselled,
            idempotencyKey: key,
          },
          (r) => {
            toast(
              r.duplicate ? "Already dispensed - no stock was issued twice." : "Dispensed and stock updated.",
            );
            setKey(crypto.randomUUID());
          },
        );
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="From" htmlFor={id("loc")} required>
          <Select value={locationId} onChange={(e) => (setLocationId(e.target.value), setLotId(""))}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Lot"
          htmlFor={id("lot")}
          hint={`${usable} usable ${unit}(s) here. Expired, quarantined and recalled lots cannot be chosen.`}
          error={fieldErrors.lotId}
        >
          <Select value={lotId} onChange={(e) => setLotId(e.target.value)}>
            <option value="">Earliest expiry first (automatic)</option>
            {here.map((l) => (
              <option key={l.lotId} value={l.lotId} disabled={!!l.problem}>
                {l.label} - {l.quantity}
                {l.problem ? ` (${l.problem})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={`Quantity (${unit}s)`}
          htmlFor={id("qty")}
          required
          error={fieldErrors.quantity}
          hint={`${remaining} remaining on the prescription`}
        >
          <Input
            type="number"
            min={1}
            max={remaining}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-[14px]">
        <Checkbox checked={counselled} onChange={(e) => setCounselled(e.target.checked)} className="mt-0.5" />
        Patient (or carer) counselled on how to take this medicine
      </label>
      <Button type="submit" loading={pending} disabled={!quantity || Number(quantity) < 1}>
        Dispense
      </Button>
    </form>
  );
}
