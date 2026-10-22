import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { getInvoice } from "@/server/domains/billing/payments";
import { getOrganization } from "@/server/domains/settings/service";
import { recordAudit } from "@/server/audit";
import { prisma } from "@/server/db";
import { formatNaira } from "@/lib/money";
import { formatCalendarDate, formatDateTime } from "@/lib/time";
import { DECISION_LABEL, PAYER_CLASS_LABEL } from "@/lib/billing-labels";
import { Forbidden } from "@/components/ui/misc";
import { PrintButton } from "@/components/print-button";
import { load } from "../../../../_lib/guard";

export const metadata: Metadata = { title: "Invoice (print)" };

export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await load(ctx, `/billing/invoices/${id}/print`, () => getInvoice(ctx, id));
  if (!res.ok) {
    if (res.kind === "notfound") notFound();
    return <Forbidden message={res.message} />;
  }
  const { inv, totals } = res.data;
  const org = await getOrganization();
  await recordAudit(prisma, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action: "billing.invoice.print",
    resourceType: "Invoice",
    resourceId: inv.id,
    patientId: inv.patientId,
    meta: ctx.meta,
  });
  const lines = inv.charges.filter((c) => c.status === "ACTIVE");
  return (
    <div className="mx-auto max-w-3xl bg-white p-6 text-black">
      <div className="no-print mb-4 flex justify-between">
        <Link prefetch={false} href={`/billing/invoices/${inv.id}`} className="text-[13px] text-muted">
          ← Back
        </Link>
        <PrintButton label="Print invoice" />
      </div>
      <header className="mb-4 border-b border-black pb-3">
        <p className="text-lg font-semibold">{org.name}</p>
        <p className="text-[13px]">
          {inv.status === "FINALISED" ? "INVOICE" : "STATEMENT (not final)"} {inv.ref} ·{" "}
          {formatDateTime(new Date())}
        </p>
      </header>
      <p className="mb-3 text-[14px]">
        Patient: {inv.patient.givenName} {inv.patient.familyName} ({inv.patient.mrn}) · Visit{" "}
        {inv.encounter.ref} · {formatCalendarDate(inv.encounter.arrivedAt)} ·{" "}
        {PAYER_CLASS_LABEL[inv.encounter.payerClass]}
      </p>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1">Service</th>
            <th className="py-1">Date</th>
            <th className="py-1 text-right">Qty</th>
            <th className="py-1 text-right">Unit</th>
            <th className="py-1 text-right">Payer</th>
            <th className="py-1 text-right">Patient</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((c) => (
            <tr key={c.id} className="border-b border-gray-300 align-top">
              <td className="py-1">
                {c.description}
                <span className="block text-[11px]">{DECISION_LABEL[c.decision]?.label}</span>
              </td>
              <td className="py-1">{formatCalendarDate(c.serviceDate)}</td>
              <td className="py-1 text-right">{c.quantity}</td>
              <td className="py-1 text-right">
                {c.unitPriceKobo === null ? "—" : formatNaira(c.unitPriceKobo)}
              </td>
              <td className="py-1 text-right">{formatNaira(c.payerPortionKobo)}</td>
              <td className="py-1 text-right">
                {c.patientPortionKobo === null ? "—" : formatNaira(c.patientPortionKobo)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto mt-4 grid max-w-xs grid-cols-2 gap-1 text-[14px]">
        <dt>Billed to payer</dt>
        <dd className="text-right">{formatNaira(totals.payerTotal)}</dd>
        <dt>Patient share</dt>
        <dd className="text-right">{formatNaira(totals.patientTotal)}</dd>
        <dt>Adjustments</dt>
        <dd className="text-right">-{formatNaira(totals.adjustments)}</dd>
        <dt>Paid</dt>
        <dd className="text-right">-{formatNaira(totals.paid)}</dd>
        <dt className="font-semibold">Balance due</dt>
        <dd className="text-right font-semibold">{formatNaira(totals.outstanding)}</dd>
      </dl>
      {totals.unresolved > 0 && (
        <p className="mt-3 text-[13px]">
          Some lines are awaiting pricing and are not included in the totals.
        </p>
      )}
    </div>
  );
}
