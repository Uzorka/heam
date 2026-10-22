import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { patientAccount } from "@/server/domains/billing/payments";
import { formatNaira } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { METHOD_LABEL, statusText } from "@/lib/billing-labels";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog } from "@/components/forms/action-form";
import { load } from "../../../_lib/guard";
import { recordPaymentAction, requestRefundAction, reversePaymentAction } from "../../actions";

export const metadata: Metadata = { title: "Patient account" };

export default async function PatientAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await load(ctx, `/billing/patients/${id}`, () => patientAccount(ctx, id));
  if (!res.ok) {
    if (res.kind === "notfound") notFound();
    return <Forbidden message={res.message} />;
  }
  const { patient, invoices, payments, credit } = res.data;
  const collect =
    !!ctx.activeBranchId && can(ctx, "billing.payment.collect", { branchId: ctx.activeBranchId });
  return (
    <>
      <Link prefetch={false} href="/billing" className="text-[13px] text-muted hover:text-foreground">
        ← Cashier desk
      </Link>
      <PageHeader
        title={`${patient.givenName} ${patient.familyName}`}
        description={
          <>
            <span className="font-mono">{patient.mrn}</span> · unapplied credit{" "}
            <span className="font-semibold tabular-nums">{formatNaira(credit)}</span>
          </>
        }
        actions={
          collect && (
            <ActionDialog
              action={recordPaymentAction}
              fixed={{ patientId: patient.id, idempotencyKey: randomUUID() }}
              trigger="Record deposit"
              triggerVariant="primary"
              title="Record a deposit / prepayment"
              description="Held as patient credit and applied to bills later."
              submitLabel="Record deposit"
              successMessage="Deposit recorded."
              fields={[
                {
                  name: "method",
                  label: "Method",
                  type: "select",
                  required: true,
                  defaultValue: "CASH",
                  options: [
                    { value: "CASH", label: "Cash" },
                    { value: "POS", label: "POS / card" },
                    { value: "BANK_TRANSFER", label: "Bank transfer" },
                  ],
                },
                { name: "amountKobo", label: "Amount", type: "money", required: true },
                { name: "reference", label: "POS slip / transfer reference", type: "text" },
              ]}
            />
          )
        }
      />
      <Card className="mb-5">
        <CardHeader title="Invoices" />
        {invoices.length === 0 ? (
          <EmptyState title="No invoices" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Invoice</TH>
                  <TH>Visit</TH>
                  <TH className="text-right">Patient share</TH>
                  <TH className="text-right">Payer share</TH>
                  <TH className="text-right">Outstanding</TH>
                  <TH>
                    <span className="sr-only">Open</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {invoices.map((i) => (
                  <TR key={i.id}>
                    <TD>
                      <span className="font-mono text-[13px]">{i.ref}</span>{" "}
                      <Badge tone={i.status === "OPEN" ? "accent" : "outline"}>{statusText(i.status)}</Badge>
                    </TD>
                    <TD className="text-[13px]">
                      <span className="font-mono">{i.encounter.ref}</span>
                      <span className="block text-muted">{formatDateTime(i.encounter.arrivedAt)}</span>
                    </TD>
                    <TD className="text-right tabular-nums">{formatNaira(i.totals.patientTotal)}</TD>
                    <TD className="text-right tabular-nums">{formatNaira(i.totals.payerTotal)}</TD>
                    <TD className="text-right font-semibold tabular-nums">
                      {formatNaira(i.totals.outstanding)}
                    </TD>
                    <TD className="text-right">
                      <Button asChild size="sm" variant="secondary">
                        <Link prefetch={false} href={`/billing/invoices/${i.id}`}>
                          Open
                        </Link>
                      </Button>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
      <Card>
        <CardHeader title="Payments" />
        {payments.length === 0 ? (
          <EmptyState title="No payments" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Receipt</TH>
                  <TH>Method</TH>
                  <TH className="text-right">Amount</TH>
                  <TH className="text-right">Applied</TH>
                  <TH>Status</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {payments.map((p) => {
                  const applied = p.allocations.reduce((s, a) => s + a.amountKobo, 0n);
                  const refunded = p.refunds
                    .filter((r) => r.status !== "REJECTED")
                    .reduce((s, r) => s + r.amountKobo, 0n);
                  const free = p.status === "CONFIRMED" ? p.amountKobo - applied - refunded : 0n;
                  return (
                    <TR key={p.id}>
                      <TD className="text-[13px]">
                        <Link
                          prefetch={false}
                          href={`/billing/receipts/${p.id}`}
                          className="font-mono text-accent hover:underline"
                        >
                          {p.receiptNo ?? "pending"}
                        </Link>
                        <span className="block text-muted">
                          {formatDateTime(p.confirmedAt ?? p.createdAt)}
                        </span>
                      </TD>
                      <TD className="text-[13px]">
                        {METHOD_LABEL[p.method]}
                        {p.reference && <span className="block text-muted">{p.reference}</span>}
                      </TD>
                      <TD className="text-right tabular-nums">{formatNaira(p.amountKobo)}</TD>
                      <TD className="text-right tabular-nums">{formatNaira(applied)}</TD>
                      <TD>
                        <Badge
                          tone={
                            p.status === "CONFIRMED"
                              ? "success"
                              : p.status === "PENDING"
                                ? "warning"
                                : "outline"
                          }
                        >
                          {statusText(p.status)}
                        </Badge>
                        {refunded > 0n && (
                          <span className="block text-xs text-muted">refunds {formatNaira(refunded)}</span>
                        )}
                      </TD>
                      <TD className="space-x-1 text-right">
                        {free > 0n && can(ctx, "billing.refund.request", { branchId: p.branchId }) && (
                          <ActionDialog
                            action={requestRefundAction}
                            fixed={{ paymentId: p.id }}
                            trigger="Refund"
                            triggerVariant="ghost"
                            title={`Request a refund (up to ${formatNaira(free)})`}
                            description="Only unapplied money can be refunded. A second person approves before it is paid out."
                            submitLabel="Submit for approval"
                            successMessage="Refund requested."
                            fields={[
                              { name: "amountKobo", label: "Amount", type: "money", required: true },
                              {
                                name: "method",
                                label: "Refund by",
                                type: "select",
                                required: true,
                                defaultValue: p.method === "ONLINE" ? "BANK_TRANSFER" : p.method,
                                options: [
                                  { value: "CASH", label: "Cash" },
                                  { value: "POS", label: "POS reversal" },
                                  { value: "BANK_TRANSFER", label: "Bank transfer" },
                                ],
                              },
                              { name: "reason", label: "Reason", type: "textarea", required: true },
                            ]}
                          />
                        )}
                        {p.status === "CONFIRMED" &&
                          applied === 0n &&
                          refunded === 0n &&
                          can(ctx, "billing.refund.approve", { branchId: p.branchId }) && (
                            <ActionDialog
                              action={reversePaymentAction}
                              fixed={{ paymentId: p.id }}
                              trigger="Reverse"
                              triggerVariant="ghost"
                              title="Reverse a payment recorded in error"
                              description="The receipt stays on record, marked reversed."
                              submitLabel="Reverse"
                              tone="danger"
                              successMessage="Payment reversed."
                              fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
                            />
                          )}
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
