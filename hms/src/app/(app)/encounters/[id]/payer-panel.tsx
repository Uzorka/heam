import Link from "next/link";
import type { Encounter } from "@prisma/client";
import { can, canAny, type AuthContext } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { invoiceTotals } from "@/server/domains/billing/charges";
import { formatNaira } from "@/lib/money";
import {
  ELIGIBILITY_LABEL,
  PAYER_STATUS,
  PREAUTH_TONE,
  statusText,
  PAYER_CLASS_LABEL,
} from "@/lib/billing-labels";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionDialog } from "@/components/forms/action-form";
import { encounterPayerAction, requestPreauthAction } from "../../hmo/actions";

/** How this visit is paid for: payer, cover, pre-authorisations and the running bill. */
export async function PayerPanel({
  ctx,
  enc,
}: {
  ctx: AuthContext;
  enc: Pick<Encounter, "id" | "patientId" | "branchId" | "payerClass" | "coverageId" | "status">;
}) {
  const b = enc.branchId;
  const seeBilling = can(ctx, "billing.read", { branchId: b });
  const changePayer =
    enc.status === "OPEN" && canAny(ctx, ["hmo.coverage.manage", "queue.manage"], { branchId: b });
  const preauthManage = can(ctx, "hmo.preauth.manage", { branchId: b });
  const [coverages, preauths, invoices, services] = await Promise.all([
    prisma.patientCoverage.findMany({
      where: { patientId: enc.patientId, status: "ACTIVE" },
      include: { payer: { select: { name: true, status: true } }, plan: { select: { name: true } } },
    }),
    canAny(ctx, ["hmo.read", "hmo.preauth.manage"], { branchId: b })
      ? prisma.preauthorization.findMany({ where: { encounterId: enc.id }, orderBy: { createdAt: "desc" } })
      : [],
    seeBilling
      ? prisma.invoice.findMany({ where: { encounterId: enc.id }, orderBy: { createdAt: "asc" } })
      : [],
    preauthManage && enc.coverageId
      ? prisma.serviceItem.findMany({
          where: {
            active: true,
            OR: [
              { category: { in: ["PROCEDURE", "IMAGING", "ADMISSION", "MATERNITY"] } },
              { charges: { some: { encounterId: enc.id, status: "ACTIVE" } } },
            ],
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true, code: true },
        })
      : [],
  ]);
  const current = coverages.find((c) => c.id === enc.coverageId);
  const totals = await Promise.all(
    invoices.map(async (i) => ({ inv: i, t: await invoiceTotals(prisma, i.id) })),
  );
  return (
    <Card className="mb-5">
      <CardHeader
        title="Payer & billing"
        actions={
          <>
            {changePayer && (
              <ActionDialog
                action={encounterPayerAction}
                fixed={{ encounterId: enc.id }}
                trigger="Change payer"
                title="How is this visit paid for?"
                description="Open charges are re-priced immediately. Insured visits need one of the patient's active covers."
                submitLabel="Save"
                successMessage="Payer updated and charges re-priced."
                fields={[
                  {
                    name: "payerClass",
                    label: "Payer",
                    type: "select",
                    required: true,
                    defaultValue: enc.payerClass === "UNDETERMINED" ? "CASH" : enc.payerClass,
                    options: [
                      { value: "CASH", label: "Cash / self-pay" },
                      { value: "HMO", label: "HMO / insurance" },
                      { value: "CORPORATE", label: "Corporate" },
                      { value: "PART_INSURED", label: "Part-insured" },
                    ],
                  },
                  {
                    name: "coverageId",
                    label: "Cover",
                    type: "select",
                    hint: coverages.length
                      ? undefined
                      : "No active cover recorded - add it on the patient's Coverage tab.",
                    defaultValue: enc.coverageId ?? undefined,
                    options: coverages.map((c) => ({
                      value: c.id,
                      label: `${c.payer.name} - ${c.plan.name} (${c.memberNumber})`,
                    })),
                  },
                ]}
              />
            )}
            {preauthManage && enc.coverageId && enc.status === "OPEN" && services.length > 0 && (
              <ActionDialog
                action={requestPreauthAction}
                fixed={{ encounterId: enc.id }}
                trigger="Request pre-authorisation"
                title="Request pre-authorisation"
                description="Amounts come from the payer's approved tariff. Submit it to the payer, then record their decision."
                submitLabel="Create request"
                successMessage="Pre-authorisation drafted."
                fields={[
                  {
                    name: "serviceItemIds",
                    label: "Services",
                    type: "multicheck",
                    options: services.map((s) => ({ value: s.id, label: s.name, hint: s.code })),
                  },
                  { name: "medicalNecessity", label: "Medical necessity", type: "textarea", required: true },
                ]}
              />
            )}
          </>
        }
      />
      <CardBody className="grid gap-3 text-[14px] sm:grid-cols-3">
        <div>
          <p className="text-[13px] text-muted">Payer</p>
          <p className="font-medium">{PAYER_CLASS_LABEL[enc.payerClass]}</p>
          {current ? (
            <p className="text-[13px]">
              {current.payer.name} · {current.plan.name} · {current.memberNumber}{" "}
              <Badge tone={PAYER_STATUS[current.payer.status]!.tone}>
                {PAYER_STATUS[current.payer.status]!.label}
              </Badge>{" "}
              <Badge tone={ELIGIBILITY_LABEL[current.eligibilityStatus]!.tone}>
                {ELIGIBILITY_LABEL[current.eligibilityStatus]!.label}
              </Badge>
            </p>
          ) : (
            enc.payerClass !== "CASH" &&
            enc.payerClass !== "UNDETERMINED" && (
              <p className="text-[13px] text-warning">No cover selected - billed as cash until set.</p>
            )
          )}
        </div>
        <div>
          <p className="text-[13px] text-muted">Pre-authorisations</p>
          {preauths.length === 0 ? (
            <p className="text-[13px]">None</p>
          ) : (
            preauths.map((p) => (
              <p key={p.id} className="text-[13px]">
                <Link
                  prefetch={false}
                  href={`/hmo/preauth/${p.id}`}
                  className="font-mono text-accent hover:underline"
                >
                  {p.ref}
                </Link>{" "}
                <Badge tone={PREAUTH_TONE[p.status]}>{statusText(p.status)}</Badge>
              </p>
            ))
          )}
        </div>
        {seeBilling && (
          <div>
            <p className="text-[13px] text-muted">Bill</p>
            {totals.length === 0 ? (
              <p className="text-[13px]">No charges yet</p>
            ) : (
              totals.map(({ inv, t }) => (
                <p key={inv.id} className="text-[13px]">
                  <Link
                    prefetch={false}
                    href={`/billing/invoices/${inv.id}`}
                    className="font-mono text-accent hover:underline"
                  >
                    {inv.ref}
                  </Link>{" "}
                  patient {formatNaira(t.patientTotal)} · payer {formatNaira(t.payerTotal)} · due{" "}
                  {formatNaira(t.outstanding)}
                  {t.unresolved > 0 && <Badge tone="danger"> {t.unresolved} to resolve</Badge>}
                </p>
              ))
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
