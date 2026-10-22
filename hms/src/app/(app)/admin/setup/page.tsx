import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { listSetupFacts } from "@/server/domains/settings/service";
import { formatDate } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Forbidden, PageHeader } from "@/components/ui/misc";
import { ActionDialog } from "@/components/forms/action-form";
import { allowed } from "../../_lib/guard";
import { decideSetupFactAction } from "../actions";

export const metadata: Metadata = { title: "Setup checklist" };

const TONE = {
  UNKNOWN: "neutral",
  AWAITING_APPROVAL: "warning",
  VERIFIED: "success",
  REJECTED: "danger",
} as const;
const LABEL = {
  UNKNOWN: "Unknown",
  AWAITING_APPROVAL: "Awaiting approval",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
} as const;

const ROADMAP: [string, string, "done" | "next" | "planned"][] = [
  [
    "Phase 1",
    "Foundation: sign-in, MFA, roles & permissions, audit trail, configuration, patient registry, appointments, check-in, queue",
    "done",
  ],
  [
    "Phase 2",
    "Consultations, clinical notes & signatures, vitals/triage, diagnoses, orders, laboratory, imaging",
    "next",
  ],
  ["Phase 3", "Prescriptions, pharmacy dispensing, lot-level stock, suppliers, procurement", "planned"],
  [
    "Phase 4",
    "Service catalogue, billing, payments, HMO enrolment, coverage, pre-authorisation, claims, remittance",
    "planned",
  ],
  [
    "Phase 5",
    "Maternity (ANC, labour, delivery, newborn, postnatal), admissions, beds, discharge",
    "planned",
  ],
  [
    "Phase 6",
    "HR, rosters, payroll, patient portal, notifications, reports & exports, FHIR mapping, hardening",
    "planned",
  ],
];

export default async function SetupPage() {
  const ctx = await requireAuthContext();
  if (!(await allowed(ctx, "/admin/setup", ["settings.read", "setup.verify"]))) return <Forbidden />;
  const facts = await listSetupFacts();
  const canDecide = can(ctx, "setup.verify");
  const verified = facts.filter((f) => f.status === "VERIFIED").length;
  const categories = [...new Set(facts.map((f) => f.category))];

  return (
    <>
      <PageHeader
        title="Hospital setup checklist"
        description="Facts gathered from public sources are starting points only. Each must be confirmed by an authorised person before it is relied on. Nothing here is treated as true until verified."
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardBody>
            <p className="text-[13px] font-medium text-muted">Verification progress</p>
            <p className="tabular mt-1 text-2xl font-semibold">
              {verified} / {facts.length} verified
            </p>
            <div
              className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={facts.length}
              aria-valuenow={verified}
              aria-label="Facts verified"
            >
              <div
                className="h-full bg-accent"
                style={{ width: `${facts.length ? (verified / facts.length) * 100 : 0}%` }}
              />
            </div>
          </CardBody>
        </Card>
        <Alert tone="info" title="Integrations are off">
          HMO, payment, SMS/email and national exchange connections stay disabled until credentials,
          agreements and testing exist.
        </Alert>
      </div>

      <div className="space-y-5">
        {categories.map((cat) => (
          <Card key={cat}>
            <CardHeader title={cat} />
            <ul className="divide-y divide-border">
              {facts
                .filter((f) => f.category === cat)
                .map((f) => (
                  <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0 max-w-2xl">
                      <p className="font-medium">{f.label}</p>
                      <p className="text-[14px]">{f.value}</p>
                      <p className="text-xs text-muted">
                        Source: {f.source ?? "-"}
                        {f.verifiedBy && f.verifiedAt
                          ? ` · decided by ${f.verifiedBy.displayName} on ${formatDate(f.verifiedAt)}`
                          : ""}
                      </p>
                      {f.notes && <p className="mt-1 text-xs text-muted">Notes: {f.notes}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={TONE[f.status]}>{LABEL[f.status]}</Badge>
                      {canDecide && (
                        <ActionDialog
                          action={decideSetupFactAction}
                          fixed={{ id: f.id }}
                          trigger="Review"
                          triggerVariant="ghost"
                          title={f.label}
                          description="Correct the value if needed, then record your decision. Your name and the time are recorded."
                          submitLabel="Save decision"
                          successMessage="Decision recorded."
                          fields={[
                            {
                              name: "value",
                              label: "Value",
                              type: "textarea",
                              required: true,
                              defaultValue: f.value,
                            },
                            {
                              name: "status",
                              label: "Status",
                              type: "select",
                              required: true,
                              defaultValue: f.status,
                              options: Object.entries(LABEL).map(([value, label]) => ({ value, label })),
                            },
                            {
                              name: "notes",
                              label: "Notes / evidence",
                              type: "textarea",
                              defaultValue: f.notes ?? undefined,
                            },
                          ]}
                        />
                      )}
                    </div>
                  </li>
                ))}
            </ul>
          </Card>
        ))}

        <Card>
          <CardHeader
            title="Implementation roadmap"
            description="What this installation can and cannot do yet."
          />
          <ul className="divide-y divide-border">
            {ROADMAP.map(([phase, desc, status]) => (
              <li key={phase} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                <div className="max-w-3xl">
                  <p className="font-medium">{phase}</p>
                  <p className="text-[13px] text-muted">{desc}</p>
                </div>
                <Badge tone={status === "done" ? "success" : status === "next" ? "accent" : "outline"}>
                  {status === "done" ? "Available" : status === "next" ? "Next" : "Planned"}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
