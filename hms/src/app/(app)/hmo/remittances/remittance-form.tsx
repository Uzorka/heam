"use client";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { useServerAction } from "@/components/forms/use-action";
import { useToast } from "@/components/forms/toaster";
import { parseNairaToKobo } from "@/lib/money";
import { importRemittanceAction } from "../actions";

interface Line {
  key: string;
  claimRef: string;
  paid: string;
  denied: string;
  reason: string;
}

const toKobo = (s: string) => {
  if (!s.trim()) return 0;
  try {
    return Number(parseNairaToKobo(s));
  } catch {
    return Number.NaN;
  }
};

/**
 * Enter a payer's payment advice. Lines can be pasted as CSV: claim reference, amount paid,
 * amount denied, reason (amounts in naira).
 */
export function RemittanceForm({ payers, today }: { payers: { id: string; name: string }[]; today: string }) {
  const toast = useToast();
  const { run, pending, error, fieldErrors } = useServerAction(importRemittanceAction);
  const idp = React.useId();
  const next = React.useRef(1);
  const blank = (p: Partial<Line> = {}): Line => ({
    key: String(next.current++),
    claimRef: "",
    paid: "",
    denied: "",
    reason: "",
    ...p,
  });
  const [payerId, setPayerId] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [date, setDate] = React.useState(today);
  const [total, setTotal] = React.useState("");
  const [lines, setLines] = React.useState<Line[]>(() => [
    { key: "0", claimRef: "", paid: "", denied: "", reason: "" },
  ]);
  const [paste, setPaste] = React.useState("");
  const update = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const sum = lines.reduce((s, l) => s + (toKobo(l.paid) || 0), 0);

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          {
            payerId,
            payerReference: reference,
            receivedDate: date,
            totalKobo: toKobo(total),
            lines: lines
              .filter((l) => l.claimRef.trim())
              .map((l) => ({
                claimRef: l.claimRef,
                paidKobo: toKobo(l.paid),
                deniedKobo: toKobo(l.denied),
                reason: l.reason.trim() || undefined,
              })),
          },
          (ref) => {
            toast(`Remittance ${ref} reconciled.`);
            setReference("");
            setTotal("");
            setLines([blank()]);
          },
        );
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Payer" htmlFor={`${idp}-payer`} required error={fieldErrors.payerId}>
          <Select value={payerId} onChange={(e) => setPayerId(e.target.value)}>
            <option value="">Choose…</option>
            {payers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Payer's payment reference"
          htmlFor={`${idp}-ref`}
          required
          error={fieldErrors.payerReference}
        >
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Date received" htmlFor={`${idp}-date`} required error={fieldErrors.receivedDate}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field
          label="Total on advice (₦)"
          htmlFor={`${idp}-total`}
          required
          error={fieldErrors.totalKobo}
          hint={`Lines add up to ₦${(sum / 100).toFixed(2)}`}
        >
          <Input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
        </Field>
      </div>
      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-[14px] font-medium">Paste lines from a spreadsheet</summary>
        <p className="mt-2 text-[13px] text-muted">
          One claim per line: claim reference, paid, denied, reason (comma or tab separated, amounts in
          naira).
        </p>
        <Textarea
          className="mt-2"
          rows={4}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          aria-label="Pasted remittance lines"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-2"
          onClick={() => {
            const parsed = paste
              .split(/\r?\n/)
              .map((r) => r.split(/\t|,/).map((c) => c.trim().replace(/^"|"$/g, "")))
              .filter((c) => c[0] && /^CLM-/i.test(c[0]))
              .map((c) =>
                blank({ claimRef: c[0]!, paid: c[1] ?? "", denied: c[2] ?? "", reason: c[3] ?? "" }),
              );
            if (parsed.length) setLines(parsed);
          }}
        >
          Use pasted lines
        </Button>
      </details>
      {lines.map((l, idx) => (
        <div key={l.key} className="grid items-end gap-2 sm:grid-cols-[10rem_8rem_8rem_1fr_auto]">
          <Field
            label={`Claim ${idx + 1}`}
            htmlFor={`${idp}-${l.key}-c`}
            error={fieldErrors[`lines.${idx}.claimRef`]}
          >
            <Input
              value={l.claimRef}
              onChange={(e) => update(l.key, { claimRef: e.target.value })}
              placeholder="CLM-2026-000001"
            />
          </Field>
          <Field label="Paid (₦)" htmlFor={`${idp}-${l.key}-p`} error={fieldErrors[`lines.${idx}.paidKobo`]}>
            <Input
              inputMode="decimal"
              value={l.paid}
              onChange={(e) => update(l.key, { paid: e.target.value })}
            />
          </Field>
          <Field label="Denied (₦)" htmlFor={`${idp}-${l.key}-d`}>
            <Input
              inputMode="decimal"
              value={l.denied}
              onChange={(e) => update(l.key, { denied: e.target.value })}
            />
          </Field>
          <Field label="Reason" htmlFor={`${idp}-${l.key}-r`}>
            <Input value={l.reason} onChange={(e) => update(l.key, { reason: e.target.value })} />
          </Field>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={lines.length === 1}
            onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
            aria-label={`Remove line ${idx + 1}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setLines((ls) => [...ls, blank()])}
        >
          <Plus className="h-4 w-4" aria-hidden /> Add line
        </Button>
        <Button type="submit" loading={pending}>
          Reconcile remittance
        </Button>
      </div>
    </form>
  );
}
