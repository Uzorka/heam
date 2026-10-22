import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthContext } from "@/server/auth/session";
import { branchesWith, can } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { formatNaira } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { METHOD_LABEL, statusText } from "@/lib/billing-labels";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog } from "@/components/forms/action-form";
import { allowed } from "../../_lib/guard";
import { approveShiftAction, decideAdjustmentAction, decideRefundAction, refundPaidAction } from "../actions";

export const metadata: Metadata = { title: "Billing approvals" };
const TABS = ["adjustments", "refunds", "shifts"] as const;

function scope(b: "ALL" | string[]) {
  return b === "ALL" ? {} : { branchId: { in: b } };
}

export default async function BillingApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requireAuthContext();
  if (
    !(await allowed(ctx, "/billing/approvals", [
      "billing.discount.approve",
      "billing.refund.approve",
      "finance.close.approve",
      "billing.payment.collect",
    ]))
  )
    return <Forbidden />;
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as (typeof TABS)[number])
    : "adjustments";
  const billing = branchesWith(ctx, "billing.read");
  const [adjustments, refunds, shifts] = await Promise.all([
    tab === "adjustments"
      ? prisma.invoiceAdjustment.findMany({
          where: { status: "PENDING", invoice: scope(billing) },
          orderBy: { requestedAt: "asc" },
          include: {
            invoice: {
              select: {
                id: true,
                ref: true,
                branchId: true,
                patient: { select: { givenName: true, familyName: true, mrn: true } },
              },
            },
          },
        })
      : [],
    tab === "refunds"
      ? prisma.refund.findMany({
          where: { status: { in: ["REQUESTED", "APPROVED"] }, payment: scope(billing) },
          orderBy: { requestedAt: "asc" },
          include: {
            payment: {
              select: {
                id: true,
                receiptNo: true,
                branchId: true,
                patient: { select: { id: true, givenName: true, familyName: true, mrn: true } },
              },
            },
          },
        })
      : [],
    tab === "shifts"
      ? prisma.cashierShift.findMany({
          where: { status: "CLOSED", ...scope(branchesWith(ctx, "finance.close.approve")) },
          orderBy: { closedAt: "asc" },
        })
      : [],
  ]);
  const users = await prisma.user.findMany({
    where: {
      id: {
        in: [
          ...adjustments.map((a) => a.requestedById),
          ...refunds.map((r) => r.requestedById),
          ...shifts.map((s) => s.cashierId),
        ],
      },
    },
    select: { id: true, displayName: true },
  });
  const who = (id: string) => users.find((u) => u.id === id)?.displayName ?? "";
  return (
    <>
      <PageHeader
        title="Billing approvals"
        description="Money-changing decisions need a second person. You cannot approve your own requests."
      />
      <LinkTabs
        label="Approval types"
        current={tab}
        tabs={[
          { key: "adjustments", label: "Discounts & credit notes", href: "/billing/approvals" },
          { key: "refunds", label: "Refunds", href: "/billing/approvals?tab=refunds" },
          { key: "shifts", label: "Shift closes", href: "/billing/approvals?tab=shifts" },
        ]}
      />
      <Card>
        {tab === "adjustments" &&
          (adjustments.length === 0 ? (
            <EmptyState title="Nothing waiting" />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Invoice</TH>
                    <TH>Type</TH>
                    <TH className="text-right">Amount</TH>
                    <TH>Requested</TH>
                    <TH>
                      <span className="sr-only">Decide</span>
                    </TH>
                  </tr>
                </THead>
                <tbody>
                  {adjustments.map((a) => {
                    const perm =
                      a.type === "DISCOUNT" ? "billing.discount.approve" : "billing.refund.approve";
                    return (
                      <TR key={a.id}>
                        <TD>
                          <Link
                            prefetch={false}
                            href={`/billing/invoices/${a.invoice.id}`}
                            className="font-mono text-accent hover:underline"
                          >
                            {a.invoice.ref}
                          </Link>
                          <span className="block text-[13px] text-muted">
                            {a.invoice.patient.givenName} {a.invoice.patient.familyName}
                          </span>
                        </TD>
                        <TD className="text-[13px]">
                          {statusText(a.type)}
                          <span className="block text-muted">{a.reason}</span>
                        </TD>
                        <TD className="text-right tabular-nums">{formatNaira(a.amountKobo)}</TD>
                        <TD className="text-[13px]">
                          {who(a.requestedById)}
                          <span className="block text-muted">{formatDateTime(a.requestedAt)}</span>
                        </TD>
                        <TD className="space-x-1 text-right">
                          {a.requestedById !== ctx.userId &&
                            can(ctx, perm, { branchId: a.invoice.branchId }) && (
                              <>
                                <ActionDialog
                                  action={decideAdjustmentAction}
                                  fixed={{ id: a.id, decision: "APPROVE" }}
                                  trigger="Approve"
                                  triggerVariant="primary"
                                  title="Approve"
                                  submitLabel="Approve"
                                  successMessage="Approved."
                                  fields={[{ name: "note", label: "Note", type: "textarea" }]}
                                />
                                <ActionDialog
                                  action={decideAdjustmentAction}
                                  fixed={{ id: a.id, decision: "REJECT" }}
                                  trigger="Reject"
                                  triggerVariant="ghost"
                                  title="Reject"
                                  submitLabel="Reject"
                                  tone="danger"
                                  successMessage="Rejected."
                                  fields={[{ name: "note", label: "Reason", type: "textarea" }]}
                                />
                              </>
                            )}
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          ))}
        {tab === "refunds" &&
          (refunds.length === 0 ? (
            <EmptyState title="Nothing waiting" />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Patient / receipt</TH>
                    <TH className="text-right">Amount</TH>
                    <TH>Reason</TH>
                    <TH>Status</TH>
                    <TH>
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <tbody>
                  {refunds.map((r) => (
                    <TR key={r.id}>
                      <TD className="text-[13px]">
                        {r.payment.patient.givenName} {r.payment.patient.familyName}
                        <Link
                          prefetch={false}
                          href={`/billing/receipts/${r.payment.id}`}
                          className="block font-mono text-accent hover:underline"
                        >
                          {r.payment.receiptNo}
                        </Link>
                      </TD>
                      <TD className="text-right tabular-nums">
                        {formatNaira(r.amountKobo)}
                        <span className="block text-xs text-muted">by {METHOD_LABEL[r.method]}</span>
                      </TD>
                      <TD className="text-[13px]">
                        {r.reason}
                        <span className="block text-muted">{who(r.requestedById)}</span>
                      </TD>
                      <TD>
                        <Badge tone={r.status === "APPROVED" ? "success" : "warning"}>
                          {statusText(r.status)}
                        </Badge>
                      </TD>
                      <TD className="space-x-1 text-right">
                        {r.status === "REQUESTED" &&
                          r.requestedById !== ctx.userId &&
                          can(ctx, "billing.refund.approve", { branchId: r.payment.branchId }) && (
                            <>
                              <ActionDialog
                                action={decideRefundAction}
                                fixed={{ id: r.id, decision: "APPROVE" }}
                                trigger="Approve"
                                triggerVariant="primary"
                                title="Approve refund"
                                submitLabel="Approve"
                                successMessage="Refund approved."
                                fields={[{ name: "note", label: "Note", type: "textarea" }]}
                              />
                              <ActionDialog
                                action={decideRefundAction}
                                fixed={{ id: r.id, decision: "REJECT" }}
                                trigger="Reject"
                                triggerVariant="ghost"
                                title="Reject refund"
                                submitLabel="Reject"
                                tone="danger"
                                successMessage="Refund rejected."
                                fields={[{ name: "note", label: "Reason", type: "textarea" }]}
                              />
                            </>
                          )}
                        {r.status === "APPROVED" &&
                          can(ctx, "billing.payment.collect", { branchId: r.payment.branchId }) && (
                            <ActionDialog
                              action={refundPaidAction}
                              fixed={{ id: r.id }}
                              trigger="Mark paid out"
                              triggerVariant="primary"
                              title="Record that the refund was paid"
                              description="Cash refunds come out of your open shift."
                              submitLabel="Mark paid"
                              successMessage="Refund recorded as paid."
                              fields={[
                                { name: "reference", label: "Transfer / reversal reference", type: "text" },
                              ]}
                            />
                          )}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          ))}
        {tab === "shifts" && (
          <>
            <CardHeader title="Closed shifts awaiting approval" />
            {shifts.length === 0 ? (
              <EmptyState title="Nothing waiting" />
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <tr>
                      <TH>Cashier</TH>
                      <TH>Shift</TH>
                      <TH className="text-right">Expected</TH>
                      <TH className="text-right">Counted</TH>
                      <TH className="text-right">Variance</TH>
                      <TH>
                        <span className="sr-only">Approve</span>
                      </TH>
                    </tr>
                  </THead>
                  <tbody>
                    {shifts.map((s) => (
                      <TR key={s.id}>
                        <TD>{who(s.cashierId)}</TD>
                        <TD className="text-[13px]">
                          {formatDateTime(s.openedAt)} – {s.closedAt ? formatDateTime(s.closedAt) : ""}
                          {s.closeNote && <span className="block text-muted">{s.closeNote}</span>}
                        </TD>
                        <TD className="text-right tabular-nums">{formatNaira(s.expectedCashKobo ?? 0n)}</TD>
                        <TD className="text-right tabular-nums">{formatNaira(s.countedCashKobo ?? 0n)}</TD>
                        <TD
                          className={`text-right tabular-nums ${s.varianceKobo ? "font-semibold text-danger" : ""}`}
                        >
                          {formatNaira(s.varianceKobo ?? 0n)}
                        </TD>
                        <TD className="text-right">
                          {s.cashierId !== ctx.userId &&
                            can(ctx, "finance.close.approve", { branchId: s.branchId }) && (
                              <ActionDialog
                                action={approveShiftAction}
                                fixed={{ id: s.id }}
                                trigger="Approve"
                                triggerVariant="primary"
                                title="Approve shift close"
                                description={
                                  s.varianceKobo
                                    ? "There is a cash variance - record the explanation."
                                    : "No variance."
                                }
                                submitLabel="Approve"
                                successMessage="Shift approved."
                                fields={[{ name: "note", label: "Note", type: "textarea" }]}
                              />
                            )}
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </>
        )}
      </Card>
    </>
  );
}
