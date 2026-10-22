import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireAuthContext } from "@/server/auth/session";
import { can, canAny } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { getInvoice, patientCredit } from "@/server/domains/billing/payments";
import { formatNaira, koboToNairaString } from "@/lib/money";
import { formatCalendarDate, formatDateTime } from "@/lib/time";
import { DECISION_LABEL, METHOD_LABEL, statusText, PAYER_CLASS_LABEL } from "@/lib/billing-labels";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog, ConfirmAction } from "@/components/forms/action-form";
import { load } from "../../../_lib/guard";
import {
  applyCreditAction,
  finaliseInvoiceAction,
  manualChargeAction,
  recordPaymentAction,
  reevaluateChargeAction,
  requestAdjustmentAction,
  resolveChargeAction,
  voidChargeAction,
} from "../../actions";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await load(ctx, `/billing/invoices/${id}`, () => getInvoice(ctx, id));
  if (!res.ok) {
    if (res.kind === "notfound") notFound();
    return <Forbidden message={res.message} />;
  }
  const { inv, totals } = res.data;
  const b = inv.branchId;
  const open = inv.status === "OPEN";
  const collect = can(ctx, "billing.payment.collect", { branchId: b });
  const manage = can(ctx, "billing.invoice.manage", { branchId: b });
  const resolver = canAny(ctx, ["hmo.coverage.manage", "billing.invoice.manage"], { branchId: b });
  const [credit, services] = await Promise.all([
    collect ? patientCredit(prisma, inv.patientId) : 0n,
    manage && open
      ? prisma.serviceItem.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, code: true, name: true },
        })
      : [],
  ]);
  const active = inv.charges.filter((c) => c.status === "ACTIVE");
  return (
    <>
      <Link
        prefetch={false}
        href={`/billing/patients/${inv.patient.id}`}
        className="text-[13px] text-muted hover:text-foreground"
      >
        ← Patient account
      </Link>
      <PageHeader
        title={`Invoice ${inv.ref}`}
        description={
          <>
            {inv.patient.givenName} {inv.patient.familyName} ·{" "}
            <span className="font-mono">{inv.patient.mrn}</span> · visit{" "}
            <Link
              prefetch={false}
              href={`/hmo/visits/${inv.encounter.id}`}
              className="font-mono text-accent hover:underline"
            >
              {inv.encounter.ref}
            </Link>{" "}
            ({formatDateTime(inv.encounter.arrivedAt)}) · payer {PAYER_CLASS_LABEL[inv.encounter.payerClass]}
          </>
        }
        actions={
          <>
            <Badge tone={open ? "accent" : inv.status === "FINALISED" ? "success" : "outline"}>
              {statusText(inv.status)}
            </Badge>
            {open && canAny(ctx, ["billing.invoice.manage", "billing.payment.collect"], { branchId: b }) && (
              <ConfirmAction
                action={finaliseInvoiceAction}
                fixed={{ invoiceId: inv.id, version: inv.version }}
                trigger="Finalise"
                title="Finalise this invoice?"
                description="It will be locked. Later corrections need an approved credit note. New charges on this visit start a new invoice."
                submitLabel="Finalise"
                successMessage="Invoice finalised."
              />
            )}
          </>
        }
      />
      {totals.unresolved > 0 && (
        <Alert tone="warning" title={`${totals.unresolved} line(s) need resolution`} className="mb-4">
          A price is missing or the HMO tariff is not mapped. Nothing is charged at zero or silently moved to
          cash. Resolve each line before finalising.
        </Alert>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Patient share", totals.patientTotal],
          ["HMO / payer share", totals.payerTotal],
          ["Paid + adjustments", totals.paid + totals.adjustments],
          ["Outstanding", totals.outstanding],
        ].map(([label, v]) => (
          <Card key={label as string}>
            <CardBody>
              <p className="text-[13px] text-muted">{label as string}</p>
              <p className="text-xl font-semibold tabular-nums">{formatNaira(v as bigint)}</p>
            </CardBody>
          </Card>
        ))}
      </div>
      <Card className="mb-5">
        <CardHeader
          title="Lines"
          description="Each line shows where its price came from and how it is split between payer and patient."
          actions={
            manage &&
            open && (
              <ActionDialog
                action={manualChargeAction}
                fixed={{ encounterId: inv.encounter.id, idempotencyKey: randomUUID() }}
                trigger="Add charge"
                title="Add a manual charge"
                description="Use only for services not generated automatically. The price comes from the approved price list."
                submitLabel="Add charge"
                successMessage="Charge added."
                fields={[
                  {
                    name: "serviceItemId",
                    label: "Service",
                    type: "select",
                    required: true,
                    options: services.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
                  },
                  { name: "quantity", label: "Quantity", type: "number", required: true, defaultValue: "1" },
                  { name: "note", label: "Note", type: "text" },
                ]}
              />
            )
          }
        />
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Service</TH>
                <TH>Date</TH>
                <TH className="text-right">Qty × price</TH>
                <TH className="text-right">Payer</TH>
                <TH className="text-right">Patient</TH>
                <TH>Source</TH>
              </tr>
            </THead>
            <tbody>
              {inv.charges.map((c) => {
                const d = DECISION_LABEL[c.decision]!;
                return (
                  <TR key={c.id} className={c.status === "VOID" ? "opacity-60" : undefined}>
                    <TD>
                      <span className={c.status === "VOID" ? "line-through" : "font-medium"}>
                        {c.description}
                      </span>
                      <span className="block font-mono text-xs text-muted">
                        {c.serviceItem.code} · {statusText(c.sourceType)}
                      </span>
                      {c.status === "VOID" && (
                        <span className="block text-xs text-muted">Void: {c.voidReason}</span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-[13px]">{formatCalendarDate(c.serviceDate)}</TD>
                    <TD className="text-right tabular-nums">
                      {c.quantity} × {c.unitPriceKobo === null ? "—" : formatNaira(c.unitPriceKobo)}
                    </TD>
                    <TD className="text-right tabular-nums">{formatNaira(c.payerPortionKobo)}</TD>
                    <TD className="text-right font-medium tabular-nums">
                      {c.patientPortionKobo === null ? "—" : formatNaira(c.patientPortionKobo)}
                    </TD>
                    <TD className="max-w-xs text-[13px]">
                      <Badge tone={d.tone}>{d.label}</Badge>
                      {c.decisionNote && (
                        <span className="mt-1 block text-xs text-muted">{c.decisionNote}</span>
                      )}
                      {c.preauthRequired && !c.preauthId && <Badge tone="warning">Pre-auth required</Badge>}
                      {c.status === "ACTIVE" && open && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {c.needsResolution && resolver && (
                            <ActionDialog
                              action={resolveChargeAction}
                              fixed={{ chargeId: c.id }}
                              trigger="Patient pays"
                              triggerVariant="ghost"
                              title="Confirm the patient pays this line"
                              description={
                                c.unitPriceKobo === null
                                  ? "No approved price exists. Billing staff must enter the amount and the reason."
                                  : `The cash price ${formatNaira(c.unitPriceKobo)} will be charged to the patient. Tell the patient first.`
                              }
                              submitLabel="Confirm"
                              successMessage="Line resolved."
                              fields={[
                                ...(c.unitPriceKobo === null
                                  ? [
                                      {
                                        name: "unitPriceKobo",
                                        label: "Unit price",
                                        type: "money" as const,
                                        required: true,
                                      },
                                    ]
                                  : []),
                                {
                                  name: "note",
                                  label: "Reason / what the patient was told",
                                  type: "textarea",
                                  required: true,
                                },
                              ]}
                            />
                          )}
                          {resolver && c.decision !== "CASH_PRICE" && (
                            <ConfirmAction
                              action={reevaluateChargeAction}
                              fixed={{ chargeId: c.id }}
                              trigger="Re-check cover"
                              triggerVariant="ghost"
                              title="Re-check this line against current cover and tariffs?"
                              description="Use after a tariff is mapped, cover corrected or pre-authorisation approved."
                              submitLabel="Re-check"
                              successMessage="Line re-checked."
                            />
                          )}
                          {manage && c.sourceType === "MANUAL" && (
                            <ActionDialog
                              action={voidChargeAction}
                              fixed={{ chargeId: c.id }}
                              trigger="Void"
                              triggerVariant="ghost"
                              title="Void this manual charge"
                              submitLabel="Void"
                              tone="danger"
                              successMessage="Charge voided."
                              fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
                            />
                          )}
                        </span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
        {active.length === 0 && <p className="p-4 text-[14px] text-muted">No active charges.</p>}
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Payments applied"
            actions={
              collect &&
              inv.status !== "VOID" &&
              totals.outstanding > 0n && (
                <>
                  <ActionDialog
                    action={recordPaymentAction}
                    fixed={{ patientId: inv.patient.id, invoiceId: inv.id, idempotencyKey: randomUUID() }}
                    trigger="Take payment"
                    triggerVariant="primary"
                    title={`Take payment - ${formatNaira(totals.outstanding)} outstanding`}
                    description="Anything above the balance is kept as patient credit. Card and transfer payments need the slip or bank reference."
                    submitLabel="Record payment"
                    successMessage="Payment recorded."
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
                      {
                        name: "amountKobo",
                        label: "Amount received",
                        type: "money",
                        required: true,
                        defaultValue: koboToNairaString(totals.outstanding),
                      },
                      { name: "reference", label: "POS slip / transfer reference", type: "text" },
                    ]}
                  />
                  {credit > 0n && (
                    <ConfirmAction
                      action={applyCreditAction}
                      fixed={{ patientId: inv.patient.id, invoiceId: inv.id }}
                      trigger={`Apply credit (${formatNaira(credit)})`}
                      title="Apply the patient's credit to this invoice?"
                      description="Unapplied deposits and overpayments are used, oldest first, up to the balance."
                      submitLabel="Apply credit"
                      successMessage="Credit applied."
                    />
                  )}
                </>
              )
            }
          />
          <CardBody>
            {inv.allocations.length === 0 ? (
              <p className="text-[14px] text-muted">No payments applied yet.</p>
            ) : (
              <ul className="space-y-1 text-[14px]">
                {inv.allocations.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2">
                    <span>
                      <Link
                        prefetch={false}
                        className="font-mono text-accent hover:underline"
                        href={`/billing/receipts/${a.paymentId}`}
                      >
                        {a.payment.receiptNo}
                      </Link>{" "}
                      · {METHOD_LABEL[a.payment.method]} · {formatDateTime(a.createdAt)}
                    </span>
                    <span className="tabular-nums">{formatNaira(a.amountKobo)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Discounts and credit notes"
            actions={
              canAny(ctx, ["billing.payment.collect", "billing.invoice.manage"], { branchId: b }) &&
              totals.outstanding > 0n && (
                <ActionDialog
                  action={requestAdjustmentAction}
                  fixed={{ invoiceId: inv.id }}
                  trigger="Request adjustment"
                  title="Request a discount or credit note"
                  description="Approved by a different person before it changes the balance."
                  submitLabel="Submit for approval"
                  successMessage="Adjustment submitted for approval."
                  fields={[
                    {
                      name: "type",
                      label: "Type",
                      type: "select",
                      required: true,
                      defaultValue: "DISCOUNT",
                      options: [
                        { value: "DISCOUNT", label: "Discount" },
                        { value: "CREDIT_NOTE", label: "Credit note (billing error)" },
                        { value: "WRITE_OFF", label: "Write-off (unrecoverable)" },
                      ],
                    },
                    { name: "amountKobo", label: "Amount", type: "money", required: true },
                    { name: "reason", label: "Reason", type: "textarea", required: true },
                  ]}
                />
              )
            }
          />
          <CardBody>
            {inv.adjustments.length === 0 ? (
              <p className="text-[14px] text-muted">None.</p>
            ) : (
              <ul className="space-y-1 text-[14px]">
                {inv.adjustments.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2">
                    <span>
                      {statusText(a.type)} · {a.reason}{" "}
                      <Badge
                        tone={
                          a.status === "APPROVED" ? "success" : a.status === "PENDING" ? "warning" : "outline"
                        }
                      >
                        {statusText(a.status)}
                      </Badge>
                    </span>
                    <span className="tabular-nums">{formatNaira(a.amountKobo)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
      <p className="mt-4 text-[13px]">
        <Button asChild variant="link" size="sm">
          <Link prefetch={false} href={`/billing/invoices/${inv.id}/print`}>
            Printable invoice
          </Link>
        </Button>
      </p>
    </>
  );
}
