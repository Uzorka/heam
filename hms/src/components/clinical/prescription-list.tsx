import type * as React from "react";
import { Badge } from "@/components/ui/badge";
import { formatCalendarDate, formatDateTime } from "@/lib/time";

export const RX_ITEM_STATUS: Record<
  string,
  { label: string; tone: "neutral" | "warning" | "accent" | "success" | "outline" }
> = {
  PENDING: { label: "Awaiting pharmacist", tone: "neutral" },
  QUERIED: { label: "Pharmacy query", tone: "warning" },
  VERIFIED: { label: "Verified", tone: "accent" },
  PARTIALLY_DISPENSED: { label: "Part dispensed", tone: "accent" },
  DISPENSED: { label: "Dispensed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "outline" },
};

export const RX_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SIGNED: "Active",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

interface ItemLike {
  id: string;
  status: string;
  dose: string;
  route: string;
  durationDays: number | null;
  prn: boolean;
  quantity: number;
  quantityDispensed: number;
  instructions: string | null;
  pharmacistNote: string | null;
  cancelReason: string | null;
  medication: {
    genericName: string;
    strength: string;
    form: string;
    brandName: string | null;
    dispensingUnit: string;
  };
  frequency: { code: string; label: string };
  dispenses: {
    id: string;
    quantity: number;
    dispensedAt: Date;
    reversedAt: Date | null;
    lot: { lotNumber: string; expiryDate: Date | null };
  }[];
}

interface RxLike {
  id: string;
  ref: string;
  status: string;
  prescriberId: string;
  signedAt: Date | null;
  notes: string | null;
  prescriber: { displayName: string };
  items: ItemLike[];
}

export function medicationLabel(m: ItemLike["medication"]) {
  return `${m.genericName} ${m.strength} ${m.form.toLowerCase()}${m.brandName ? ` (${m.brandName})` : ""}`;
}

export function sigLine(i: ItemLike) {
  return `${i.dose} ${i.route} ${i.frequency.code}${i.durationDays ? ` for ${i.durationDays} day${i.durationDays === 1 ? "" : "s"}` : ""}${i.prn ? " as needed" : ""}`;
}

export function PrescriptionList<R extends RxLike>({
  prescriptions,
  cancelItem,
  showLots = false,
}: {
  prescriptions: R[];
  cancelItem?: (item: R["items"][number], rx: R) => React.ReactNode;
  showLots?: boolean;
}) {
  return (
    <div className="space-y-3">
      {prescriptions.map((rx) => (
        <section key={rx.id} className="rounded-md border border-border">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-[13px]">
            <span>
              <span className="font-mono">{rx.ref}</span> · {rx.prescriber.displayName}
              {rx.signedAt && <> · signed {formatDateTime(rx.signedAt)}</>}
            </span>
            <Badge tone={rx.status === "SIGNED" ? "accent" : "outline"}>
              {RX_STATUS_LABEL[rx.status] ?? rx.status}
            </Badge>
          </header>
          <ul className="divide-y divide-border">
            {rx.items.map((i) => {
              const st = RX_ITEM_STATUS[i.status] ?? { label: i.status, tone: "neutral" as const };
              return (
                <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                  <div className="min-w-0 text-[14px]">
                    <p className="font-medium">{medicationLabel(i.medication)}</p>
                    <p className="text-[13px] text-muted">
                      {sigLine(i)} · supply {i.quantity} {i.medication.dispensingUnit}(s)
                      {i.quantityDispensed > 0 && ` · ${i.quantityDispensed} dispensed`}
                    </p>
                    {i.instructions && <p className="text-[13px]">{i.instructions}</p>}
                    {i.pharmacistNote && (
                      <p className="text-[13px] text-warning">Pharmacist: {i.pharmacistNote}</p>
                    )}
                    {i.cancelReason && <p className="text-[13px] text-muted">Stopped: {i.cancelReason}</p>}
                    {showLots && i.dispenses.length > 0 && (
                      <ul className="mt-1 text-[13px] text-muted">
                        {i.dispenses.map((d) => (
                          <li key={d.id}>
                            {d.quantity} from lot <span className="font-mono">{d.lot.lotNumber}</span>
                            {d.lot.expiryDate && ` (exp ${formatCalendarDate(d.lot.expiryDate)})`} ·{" "}
                            {formatDateTime(d.dispensedAt)}
                            {d.reversedAt && " · reversed"}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {cancelItem?.(i as R["items"][number], rx)}
                  </div>
                </li>
              );
            })}
          </ul>
          {rx.notes && (
            <p className="border-t border-border px-3 py-2 text-[13px] text-muted">Note: {rx.notes}</p>
          )}
        </section>
      ))}
    </div>
  );
}
