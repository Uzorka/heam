import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { getPayer } from "@/server/domains/hmo/payers";
import { formatNaira } from "@/lib/money";
import { formatCalendarDate, todayLocal } from "@/lib/time";
import { PAYER_STATUS, statusText } from "@/lib/billing-labels";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog, ConfirmAction } from "@/components/forms/action-form";
import { load } from "../../../_lib/guard";
import {
  decideTariffAction,
  proposeTariffAction,
  savePayerAction,
  savePlanAction,
  setPayerStatusAction,
  setPlanStatusAction,
} from "../../actions";
import { payerFields } from "../payer-fields";

export const metadata: Metadata = { title: "Payer" };

export default async function PayerPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await load(ctx, `/hmo/payers/${id}`, () => getPayer(ctx, id));
  if (!res.ok) {
    if (res.kind === "notfound") notFound();
    return <Forbidden message={res.message} />;
  }
  const p = res.data;
  const manage = can(ctx, "hmo.partner.manage");
  const activate = can(ctx, "hmo.partner.activate");
  const services = manage
    ? await prisma.serviceItem.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true },
      })
    : [];
  const st = PAYER_STATUS[p.status]!;
  return (
    <>
      <Link prefetch={false} href="/hmo/payers" className="text-[13px] text-muted hover:text-foreground">
        ← Payers
      </Link>
      <PageHeader
        title={p.name}
        description={
          <>
            <span className="font-mono">{p.code}</span> · {statusText(p.scheme)}
            {p.providerCode && <> · provider code {p.providerCode}</>}
          </>
        }
        actions={
          <>
            <Badge tone={st.tone}>{st.label}</Badge>
            {manage && (
              <ActionDialog
                action={savePayerAction}
                fixed={{ id: p.id }}
                trigger="Edit"
                title={`Edit ${p.name}`}
                submitLabel="Save"
                successMessage="Payer updated."
                fields={payerFields(p)}
              />
            )}
            {activate && p.status !== "ACTIVE" && (
              <ActionDialog
                action={setPayerStatusAction}
                fixed={{ id: p.id, status: "ACTIVE" }}
                trigger="Activate contract"
                triggerVariant="primary"
                title="Activate this payer"
                description="Only with a signed agreement on file. Record what you checked."
                submitLabel="Activate"
                successMessage="Payer activated."
                fields={[
                  {
                    name: "contractEvidence",
                    label: "Contract evidence (document reference, signatories, date)",
                    type: "textarea",
                    required: true,
                  },
                ]}
              />
            )}
            {activate && p.status === "ACTIVE" && (
              <ActionDialog
                action={setPayerStatusAction}
                fixed={{ id: p.id, status: "SUSPENDED" }}
                trigger="Suspend"
                triggerVariant="ghost"
                title="Suspend this payer"
                description="New services are billed to patients until reactivated."
                submitLabel="Suspend"
                tone="danger"
                successMessage="Payer suspended."
                fields={[{ name: "contractEvidence", label: "Reason", type: "textarea", required: true }]}
              />
            )}
          </>
        }
      />
      {p.status === "PENDING_VERIFICATION" && (
        <Alert tone="warning" className="mb-4" title="Not a verified contract">
          {p.sourceNote ?? "Pending verification."} Visits for this payer are billed to the patient until the
          contract is activated.
        </Alert>
      )}
      <Card className="mb-5">
        <CardBody className="grid gap-2 text-[14px] sm:grid-cols-2">
          <p>
            <span className="text-muted">Contract:</span>{" "}
            {p.contractStart && p.contractEnd
              ? `${formatCalendarDate(p.contractStart)} – ${formatCalendarDate(p.contractEnd)}`
              : "not recorded"}
          </p>
          <p>
            <span className="text-muted">Evidence:</span> {p.contractEvidence ?? "none"}
          </p>
          <p>
            <span className="text-muted">Contact:</span>{" "}
            {[p.contactName, p.contactPhone, p.contactEmail].filter(Boolean).join(" · ") || "—"}
          </p>
          <p>
            <span className="text-muted">Claims email:</span> {p.claimsEmail ?? "—"}
          </p>
        </CardBody>
      </Card>
      <Card className="mb-5">
        <CardHeader
          title="Plans"
          actions={
            manage && (
              <ActionDialog
                action={savePlanAction}
                fixed={{ payerId: p.id }}
                trigger="Add plan"
                title="Add a plan"
                submitLabel="Save"
                successMessage="Plan added."
                fields={[
                  { name: "code", label: "Code", type: "text", required: true },
                  { name: "name", label: "Plan name", type: "text", required: true },
                  {
                    name: "billingModel",
                    label: "Billing model",
                    type: "select",
                    required: true,
                    defaultValue: "FEE_FOR_SERVICE",
                    options: [
                      { value: "FEE_FOR_SERVICE", label: "Fee for service" },
                      { value: "CAPITATION", label: "Capitation" },
                    ],
                  },
                  {
                    name: "copayBasisPoints",
                    label: "Patient co-pay (basis points, 1000 = 10%)",
                    type: "number",
                    defaultValue: "0",
                  },
                  { name: "notes", label: "Benefits / exclusions summary", type: "textarea" },
                ]}
              />
            )
          }
        />
        {p.plans.length === 0 ? (
          <EmptyState title="No plans" />
        ) : (
          <TableWrap>
            <Table>
              <tbody>
                {p.plans.map((pl) => (
                  <TR key={pl.id}>
                    <TD>
                      <span className="font-medium">{pl.name}</span>{" "}
                      <span className="font-mono text-xs text-muted">{pl.code}</span>
                      {pl.notes && <span className="block text-[13px] text-muted">{pl.notes}</span>}
                    </TD>
                    <TD className="text-[13px]">
                      {statusText(pl.billingModel)} · co-pay {pl.copayBasisPoints / 100}%
                    </TD>
                    <TD>
                      <Badge tone={PAYER_STATUS[pl.status]!.tone}>{PAYER_STATUS[pl.status]!.label}</Badge>
                    </TD>
                    <TD className="text-right">
                      {activate && pl.status !== "ACTIVE" && p.status === "ACTIVE" && (
                        <ConfirmAction
                          action={setPlanStatusAction}
                          fixed={{ id: pl.id, status: "ACTIVE" }}
                          trigger="Activate"
                          title={`Activate ${pl.name}?`}
                          description="Visits on this plan will be billed to the payer using approved tariffs."
                          submitLabel="Activate"
                          successMessage="Plan activated."
                        />
                      )}
                      {activate && pl.status === "ACTIVE" && (
                        <ConfirmAction
                          action={setPlanStatusAction}
                          fixed={{ id: pl.id, status: "SUSPENDED" }}
                          trigger="Suspend"
                          triggerVariant="ghost"
                          title={`Suspend ${pl.name}?`}
                          description="New services are billed to the patient."
                          submitLabel="Suspend"
                          successMessage="Plan suspended."
                        />
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
      <Card>
        <CardHeader
          title="Tariffs and benefit rules"
          description="Agreed rates per service (optionally per plan). Approved by finance, effective-dated, and never edited once approved."
          actions={
            manage && (
              <ActionDialog
                action={proposeTariffAction}
                fixed={{ payerId: p.id }}
                trigger="Propose tariff"
                title="Propose a tariff line"
                submitLabel="Propose"
                successMessage="Tariff proposed for approval."
                fields={[
                  {
                    name: "serviceItemId",
                    label: "Service",
                    type: "select",
                    required: true,
                    options: services.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
                  },
                  {
                    name: "planId",
                    label: "Plan (blank = all plans)",
                    type: "select",
                    options: p.plans.map((pl) => ({ value: pl.id, label: pl.name })),
                  },
                  {
                    name: "coverage",
                    label: "Coverage",
                    type: "select",
                    required: true,
                    defaultValue: "COVERED",
                    options: [
                      { value: "COVERED", label: "Covered" },
                      { value: "EXCLUDED", label: "Excluded (patient pays)" },
                    ],
                  },
                  { name: "amountKobo", label: "Agreed tariff (if covered)", type: "money" },
                  { name: "copayBasisPoints", label: "Co-pay override (basis points)", type: "number" },
                  { name: "requiresPreauth", label: "Requires pre-authorisation", type: "checkbox" },
                  {
                    name: "effectiveFrom",
                    label: "Effective from",
                    type: "date",
                    required: true,
                    defaultValue: todayLocal(),
                  },
                  { name: "note", label: "Source / note", type: "textarea" },
                ]}
              />
            )
          }
        />
        {p.tariffs.length === 0 ? (
          <EmptyState title="No tariffs">
            Visits for this payer are held for HMO resolution until services are mapped.
          </EmptyState>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Service</TH>
                  <TH>Plan</TH>
                  <TH className="text-right">Tariff</TH>
                  <TH>Rules</TH>
                  <TH>Effective</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <tbody>
                {p.tariffs.map((t) => (
                  <TR key={t.id}>
                    <TD>
                      {t.serviceItem.name}
                      <span className="block font-mono text-xs text-muted">{t.serviceItem.code}</span>
                    </TD>
                    <TD className="text-[13px]">{t.plan?.name ?? "All plans"}</TD>
                    <TD className="text-right tabular-nums">
                      {t.coverage === "EXCLUDED" ? "Excluded" : formatNaira(t.amountKobo!)}
                    </TD>
                    <TD className="text-[13px]">
                      {t.requiresPreauth && <Badge tone="warning">pre-auth</Badge>}{" "}
                      {t.copayBasisPoints !== null && `co-pay ${t.copayBasisPoints / 100}%`}
                      {t.note && <span className="block text-muted">{t.note}</span>}
                    </TD>
                    <TD className="text-[13px]">
                      {formatCalendarDate(t.effectiveFrom)}
                      {t.effectiveTo && ` – ${formatCalendarDate(t.effectiveTo)}`}
                    </TD>
                    <TD className="space-x-1">
                      <Badge tone={t.status === "APPROVED" ? "success" : "warning"}>
                        {statusText(t.status)}
                      </Badge>
                      {t.status === "DRAFT" && activate && t.createdById !== ctx.userId && (
                        <>
                          <ConfirmAction
                            action={decideTariffAction}
                            fixed={{ id: t.id, decision: "APPROVE" }}
                            trigger="Approve"
                            title="Approve tariff?"
                            description="It applies to services on or after its start date."
                            submitLabel="Approve"
                            successMessage="Tariff approved."
                          />
                          <ConfirmAction
                            action={decideTariffAction}
                            fixed={{ id: t.id, decision: "REJECT" }}
                            trigger="Reject"
                            triggerVariant="ghost"
                            title="Reject tariff?"
                            description="The proposal is kept on record as rejected."
                            submitLabel="Reject"
                            successMessage="Tariff rejected."
                          />
                        </>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
