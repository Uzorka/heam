import { can, type AuthContext } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { patientCoverages } from "@/server/domains/hmo/coverage";
import { formatCalendarDate, formatDateTime, todayLocal } from "@/lib/time";
import { ELIGIBILITY_LABEL, PAYER_STATUS, statusText } from "@/lib/billing-labels";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { ActionDialog, ConfirmAction } from "@/components/forms/action-form";
import {
  connectorEligibilityAction,
  endCoverageAction,
  enrolCoverageAction,
  manualEligibilityAction,
} from "../../hmo/actions";

/** HMO / insurance memberships with eligibility evidence. */
export async function CoverageTab({ ctx, patientId }: { ctx: AuthContext; patientId: string }) {
  const manage = can(ctx, "hmo.coverage.manage");
  const eligibility = can(ctx, "hmo.eligibility.record");
  const [coverages, plans] = await Promise.all([
    patientCoverages(ctx, patientId),
    manage
      ? prisma.payerPlan.findMany({
          include: { payer: { select: { name: true, status: true } } },
          orderBy: [{ payer: { name: "asc" } }, { name: "asc" }],
        })
      : [],
  ]);
  return (
    <Card>
      <CardHeader
        title="HMO / insurance cover"
        description="Membership details and how eligibility was confirmed. Pending payers are recorded but billed as patient pay until their contract is active."
        actions={
          manage && (
            <ActionDialog
              action={enrolCoverageAction}
              fixed={{ patientId }}
              trigger="Add cover"
              triggerVariant="primary"
              title="Record HMO / insurance cover"
              submitLabel="Save"
              successMessage="Cover recorded."
              fields={[
                {
                  name: "planId",
                  label: "Payer and plan",
                  type: "select",
                  required: true,
                  options: plans.map((p) => ({
                    value: p.id,
                    label: `${p.payer.name} - ${p.name}${p.payer.status !== "ACTIVE" ? " (payer pending)" : ""}`,
                  })),
                },
                { name: "memberNumber", label: "Member / enrollee number", type: "text", required: true },
                {
                  name: "relationship",
                  label: "Relationship to principal",
                  type: "select",
                  required: true,
                  defaultValue: "PRINCIPAL",
                  options: [
                    { value: "PRINCIPAL", label: "Principal" },
                    { value: "SPOUSE", label: "Spouse" },
                    { value: "CHILD", label: "Child" },
                    { value: "OTHER_DEPENDANT", label: "Other dependant" },
                  ],
                },
                { name: "principalName", label: "Principal's name (for dependants)", type: "text" },
                { name: "sponsor", label: "Employer / sponsor", type: "text" },
                {
                  name: "validFrom",
                  label: "Valid from",
                  type: "date",
                  required: true,
                  defaultValue: todayLocal(),
                },
                { name: "validTo", label: "Valid to", type: "date" },
              ]}
            />
          )
        }
      />
      {coverages.length === 0 ? (
        <EmptyState title="No cover recorded">
          Visits are billed to the patient unless cover is recorded.
        </EmptyState>
      ) : (
        <CardBody className="space-y-3">
          {coverages.map((c) => {
            const e = ELIGIBILITY_LABEL[c.eligibilityStatus]!;
            return (
              <section key={c.id} className="rounded-md border border-border p-3 text-[14px]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {c.payer.name} · {c.plan.name}{" "}
                      <Badge tone={PAYER_STATUS[c.payer.status]!.tone}>
                        {PAYER_STATUS[c.payer.status]!.label}
                      </Badge>
                    </p>
                    <p className="text-[13px] text-muted">
                      Member {c.memberNumber} · {statusText(c.relationship)}
                      {c.principalName && ` of ${c.principalName}`}
                      {c.sponsor && ` · ${c.sponsor}`} · {formatCalendarDate(c.validFrom)} –{" "}
                      {c.validTo ? formatCalendarDate(c.validTo) : "open"}
                      {c.plan.copayBasisPoints > 0 && ` · co-pay ${c.plan.copayBasisPoints / 100}%`}
                    </p>
                  </div>
                  <span className="flex flex-wrap items-center gap-1">
                    <Badge tone={c.status === "ACTIVE" ? "success" : "outline"}>{statusText(c.status)}</Badge>
                    <Badge tone={e.tone}>{e.label}</Badge>
                  </span>
                </div>
                {c.status === "ACTIVE" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {eligibility && (
                      <>
                        <ActionDialog
                          action={manualEligibilityAction}
                          fixed={{ coverageId: c.id }}
                          trigger="Record eligibility check"
                          title="Record an eligibility check"
                          description="What the payer told you by phone, portal or email. An eligible result needs their reference."
                          submitLabel="Save"
                          successMessage="Eligibility recorded."
                          fields={[
                            {
                              name: "method",
                              label: "How",
                              type: "select",
                              required: true,
                              defaultValue: "MANUAL_PHONE",
                              options: [
                                { value: "MANUAL_PHONE", label: "Phone call" },
                                { value: "MANUAL_PORTAL", label: "Payer web portal" },
                                { value: "MANUAL_EMAIL", label: "Email" },
                              ],
                            },
                            {
                              name: "outcome",
                              label: "Result",
                              type: "select",
                              required: true,
                              options: [
                                { value: "ELIGIBLE", label: "Eligible" },
                                { value: "NOT_ELIGIBLE", label: "Not eligible" },
                                { value: "UNREACHABLE", label: "Could not reach payer" },
                              ],
                            },
                            { name: "reference", label: "Payer's reference", type: "text" },
                            {
                              name: "evidence",
                              label: "Who confirmed and what they said",
                              type: "textarea",
                              required: true,
                            },
                          ]}
                        />
                        <ConfirmAction
                          action={connectorEligibilityAction}
                          fixed={{ coverageId: c.id }}
                          trigger="Check online"
                          triggerVariant="ghost"
                          title="Run an online eligibility check?"
                          description="Only works if a payer connector has been configured and tested. Failures are recorded as not verified."
                          submitLabel="Check"
                          successMessage="Check recorded - see the result below."
                        />
                      </>
                    )}
                    {manage && (
                      <ActionDialog
                        action={endCoverageAction}
                        fixed={{ coverageId: c.id }}
                        trigger="End cover"
                        triggerVariant="ghost"
                        title="End this cover"
                        submitLabel="End cover"
                        tone="danger"
                        successMessage="Cover ended."
                        fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
                      />
                    )}
                  </div>
                )}
                {c.checks.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-[13px] text-muted">
                    {c.checks.map((k) => (
                      <li key={k.id}>
                        {formatDateTime(k.checkedAt)} · {statusText(k.method)} · {statusText(k.outcome)}
                        {k.reference && ` · ref ${k.reference}`}
                        {k.errorCode && ` · ${statusText(k.errorCode)}`}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </CardBody>
      )}
    </Card>
  );
}
