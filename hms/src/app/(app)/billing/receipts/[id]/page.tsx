import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { getOrganization } from "@/server/domains/settings/service";
import { formatNaira } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { METHOD_LABEL, statusText } from "@/lib/billing-labels";
import { PrintButton } from "@/components/print-button";

export const metadata: Metadata = { title: "Receipt" };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const p = await prisma.payment.findUnique({
    where: { id },
    include: {
      patient: { select: { id: true, mrn: true, givenName: true, familyName: true } },
      allocations: { include: { invoice: { select: { ref: true } } } },
    },
  });
  if (!p || !can(ctx, "billing.read", { branchId: p.branchId })) notFound();
  const [org, cashier] = await Promise.all([
    getOrganization(),
    p.receivedById
      ? prisma.user.findUnique({ where: { id: p.receivedById }, select: { displayName: true } })
      : null,
  ]);
  const applied = p.allocations.reduce((s, a) => s + a.amountKobo, 0n);
  return (
    <div className="mx-auto max-w-md bg-white p-6 text-black">
      <div className="no-print mb-4 flex justify-between">
        <Link prefetch={false} href={`/billing/patients/${p.patient.id}`} className="text-[13px] text-muted">
          ← Patient account
        </Link>
        <PrintButton label="Print receipt" />
      </div>
      <p className="text-lg font-semibold">{org.name}</p>
      <p className="mb-3 text-[13px]">OFFICIAL RECEIPT {p.receiptNo ?? "(pending)"}</p>
      {p.status !== "CONFIRMED" && (
        <p className="mb-3 font-semibold">This payment is {statusText(p.status)} - not a valid receipt.</p>
      )}
      <dl className="grid grid-cols-2 gap-1 text-[14px]">
        <dt>Patient</dt>
        <dd>
          {p.patient.givenName} {p.patient.familyName}
        </dd>
        <dt>Hospital no.</dt>
        <dd className="font-mono">{p.patient.mrn}</dd>
        <dt>Date</dt>
        <dd>{formatDateTime(p.confirmedAt ?? p.createdAt)}</dd>
        <dt>Method</dt>
        <dd>
          {METHOD_LABEL[p.method]}
          {p.reference ? ` (${p.reference})` : ""}
        </dd>
        <dt className="font-semibold">Amount</dt>
        <dd className="font-semibold">{formatNaira(p.amountKobo)}</dd>
        <dt>Applied to</dt>
        <dd>{p.allocations.map((a) => a.invoice.ref).join(", ") || "—"}</dd>
        <dt>Not applied to a bill</dt>
        <dd>{formatNaira(p.amountKobo - applied)}</dd>
        <dt>Received by</dt>
        <dd>{cashier?.displayName ?? "Online payment"}</dd>
      </dl>
    </div>
  );
}
