"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { useServerAction } from "@/components/forms/use-action";
import { useToast } from "@/components/forms/toaster";
import { recordCountAction } from "../../actions";

interface Line {
  id: string;
  label: string;
  lotNumber: string;
  unit: string;
  systemQty: number;
  countedQty: number | null;
  varianceNote: string | null;
}

/** Blind-ish entry: system quantities are shown only after a figure is typed, to reduce anchoring. */
export function CountForm({ countId, lines }: { countId: string; lines: Line[] }) {
  const toast = useToast();
  const { run, pending, error } = useServerAction(recordCountAction);
  const [vals, setVals] = React.useState<Record<string, { qty: string; note: string }>>(() =>
    Object.fromEntries(
      lines.map((l) => [
        l.id,
        { qty: l.countedQty === null ? "" : String(l.countedQty), note: l.varianceNote ?? "" },
      ]),
    ),
  );
  const submit = (final: boolean) =>
    run(
      {
        countId,
        submit: final,
        lines: lines
          .filter((l) => vals[l.id]!.qty !== "")
          .map((l) => ({
            lineId: l.id,
            countedQty: Number(vals[l.id]!.qty),
            varianceNote: vals[l.id]!.note.trim() || undefined,
          })),
      },
      () => toast(final ? "Count submitted for approval." : "Count saved."),
    );
  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH>Item / lot</TH>
              <TH>Counted</TH>
              <TH className="text-right">System</TH>
              <TH className="text-right">Variance</TH>
              <TH>Note</TH>
            </tr>
          </THead>
          <tbody>
            {lines.map((l) => {
              const v = vals[l.id]!;
              const counted = v.qty === "" ? null : Number(v.qty);
              const variance = counted === null ? null : counted - l.systemQty;
              return (
                <TR key={l.id}>
                  <TD>
                    {l.label}
                    <span className="block font-mono text-xs text-muted">{l.lotNumber}</span>
                  </TD>
                  <TD>
                    <Input
                      aria-label={`Counted quantity for ${l.label} lot ${l.lotNumber}`}
                      type="number"
                      min={0}
                      className="w-28"
                      value={v.qty}
                      onChange={(e) => setVals((s) => ({ ...s, [l.id]: { ...v, qty: e.target.value } }))}
                    />
                  </TD>
                  <TD className="text-right tabular-nums">{counted === null ? "-" : l.systemQty}</TD>
                  <TD className={`text-right tabular-nums ${variance ? "font-medium text-danger" : ""}`}>
                    {variance === null ? "-" : variance > 0 ? `+${variance}` : variance}
                  </TD>
                  <TD>
                    <Input
                      aria-label={`Variance note for ${l.label} lot ${l.lotNumber}`}
                      value={v.note}
                      onChange={(e) => setVals((s) => ({ ...s, [l.id]: { ...v, note: e.target.value } }))}
                    />
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" loading={pending} onClick={() => submit(false)}>
          Save progress
        </Button>
        <Button type="button" loading={pending} onClick={() => submit(true)}>
          Submit for approval
        </Button>
      </div>
    </div>
  );
}
