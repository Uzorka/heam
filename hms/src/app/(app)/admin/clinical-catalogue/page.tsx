import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { listImagingCatalogue, listLabCatalogue } from "@/server/domains/catalogue/service";
import { VITAL_FIELDS } from "@/server/domains/clinical/vital-flags";
import { formatDate } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Forbidden, PageHeader } from "@/components/ui/misc";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionDialog, ConfirmAction } from "@/components/forms/action-form";
import { allowed } from "../../_lib/guard";
import {
  createImagingStudyAction,
  decideRangeAction,
  decideThresholdAction,
  proposeRangeAction,
  proposeThresholdAction,
  setLabTestActiveAction,
} from "./actions";
import { LabTestForm } from "./lab-test-form";

export const metadata: Metadata = { title: "Clinical catalogue" };
const TABS = ["lab", "imaging", "vitals"] as const;
const STATUS_TONE = { DRAFT: "warning", APPROVED: "success", RETIRED: "outline" } as const;

function ageLabel(min: number, max: number | null) {
  const fmt = (d: number) => (d >= 365 ? `${Math.round(d / 365)} y` : `${d} d`);
  if (min === 0 && max === null) return "all ages";
  return `${fmt(min)} – ${max === null ? "∞" : fmt(max)}`;
}

export default async function CataloguePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAuthContext();
  if (!(await allowed(ctx, "/admin/clinical-catalogue", ["lab.catalogue.manage", "clinical.rules.approve"])))
    return <Forbidden />;
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "lab";
  const manage = can(ctx, "lab.catalogue.manage");
  const approve = can(ctx, "clinical.rules.approve");
  const [tests, studies, thresholds] = await Promise.all([
    tab === "lab" ? listLabCatalogue() : [],
    tab === "imaging" ? listImagingCatalogue() : [],
    tab === "vitals"
      ? prisma.vitalThreshold.findMany({
          where: { status: { not: "RETIRED" } },
          orderBy: [{ parameter: "asc" }, { createdAt: "desc" }],
        })
      : [],
  ]);
  const decide = (id: string, action: typeof decideRangeAction, createdById: string | null) =>
    approve && createdById !== ctx.userId ? (
      <ConfirmAction
        action={action}
        fixed={{ id, decision: "APPROVE" }}
        trigger="Approve"
        triggerVariant="primary"
        title="Approve clinical rule"
        description="You confirm this has been validated for use at this hospital. Your name is recorded as the approving clinician."
        submitLabel="Approve"
        successMessage="Approved."
      />
    ) : approve ? (
      <span className="text-xs text-muted">Needs another approver</span>
    ) : null;

  return (
    <>
      <PageHeader
        title="Clinical catalogue"
        description="Tests, studies, reference ranges and vital-sign thresholds. Ranges and thresholds are clinical content: they produce flags only after approval by a clinician other than the author."
      />
      <LinkTabs
        label="Catalogue"
        current={tab}
        tabs={[
          { key: "lab", label: "Laboratory", href: "/admin/clinical-catalogue" },
          { key: "imaging", label: "Imaging", href: "/admin/clinical-catalogue?tab=imaging" },
          { key: "vitals", label: "Vital thresholds", href: "/admin/clinical-catalogue?tab=vitals" },
        ]}
      />
      {tab === "lab" && (
        <div className="space-y-5">
          {tests.map((t) => (
            <Card key={t.id}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {t.name} <span className="font-mono text-xs text-muted">{t.code}</span>{" "}
                    {!t.active && <Badge tone="outline">Inactive</Badge>}
                  </span>
                }
                description={`${t.specimenType}${t.turnaroundHours ? ` · turnaround ${t.turnaroundHours} h` : ""}`}
                actions={
                  manage && (
                    <ConfirmAction
                      action={setLabTestActiveAction}
                      fixed={{ testId: t.id, active: !t.active }}
                      trigger={t.active ? "Deactivate" : "Activate"}
                      triggerVariant="ghost"
                      title={t.active ? "Stop ordering this test?" : "Allow ordering again?"}
                      description="Existing orders and results are unaffected."
                      submitLabel={t.active ? "Deactivate" : "Activate"}
                      successMessage="Updated."
                    />
                  )
                }
              />
              <CardBody className="space-y-4">
                {t.components.map((c) => (
                  <div key={c.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[14px] font-medium">
                        {c.name}{" "}
                        <span className="text-xs font-normal text-muted">
                          (
                          {c.resultType === "CODED"
                            ? c.allowedValues.join(" / ")
                            : c.resultType === "NUMERIC"
                              ? (c.unit ?? "no unit")
                              : "free text"}
                          )
                        </span>
                      </p>
                      {manage && c.resultType !== "TEXT" && (
                        <ActionDialog
                          action={proposeRangeAction}
                          fixed={{ componentId: c.id }}
                          trigger="Propose range"
                          triggerVariant="ghost"
                          title={`Reference range: ${c.name}`}
                          description="Saved as a draft. A clinician with approval rights must approve it before it flags results."
                          submitLabel="Save draft"
                          successMessage="Range proposed."
                          fields={[
                            {
                              name: "sex",
                              label: "Applies to",
                              type: "select",
                              required: true,
                              defaultValue: "ANY",
                              options: [
                                { value: "ANY", label: "All" },
                                { value: "FEMALE", label: "Female" },
                                { value: "MALE", label: "Male" },
                              ],
                            },
                            {
                              name: "ageMinDays",
                              label: "From age (days)",
                              type: "number",
                              defaultValue: "0",
                            },
                            {
                              name: "ageMaxDays",
                              label: "Up to age (days, blank = no limit)",
                              type: "number",
                            },
                            ...(c.resultType === "NUMERIC"
                              ? ([
                                  { name: "low", label: `Low (${c.unit ?? ""})`, type: "text" },
                                  { name: "high", label: `High (${c.unit ?? ""})`, type: "text" },
                                  { name: "criticalLow", label: "Critical low", type: "text" },
                                  { name: "criticalHigh", label: "Critical high", type: "text" },
                                ] as const)
                              : ([
                                  {
                                    name: "normalText",
                                    label: "Expected normal value",
                                    type: "select",
                                    required: true,
                                    options: c.allowedValues.map((a) => ({ value: a, label: a })),
                                  },
                                ] as const)),
                            {
                              name: "source",
                              label: "Source / validation reference",
                              type: "textarea",
                              required: true,
                            },
                          ]}
                        />
                      )}
                    </div>
                    {c.ranges.length === 0 ? (
                      <p className="text-[13px] text-muted">
                        No reference range - results will not be flagged.
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {c.ranges.map((r) => (
                          <li key={r.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                            <Badge tone={STATUS_TONE[r.status]}>{r.status.toLowerCase()}</Badge>
                            <span>
                              {r.sex === "ANY" ? "All" : r.sex.toLowerCase()} ·{" "}
                              {ageLabel(r.ageMinDays, r.ageMaxDays)} ·{" "}
                              {r.normalText ??
                                `${r.low ?? "–"} to ${r.high ?? "–"}${r.criticalLow !== null || r.criticalHigh !== null ? ` (critical <${r.criticalLow ?? "–"} / >${r.criticalHigh ?? "–"})` : ""}`}
                            </span>
                            <span className="text-muted">· {r.source}</span>
                            {r.status === "APPROVED" && r.approvedAt && (
                              <span className="text-muted">· approved {formatDate(r.approvedAt)}</span>
                            )}
                            {r.status === "DRAFT" && decide(r.id, decideRangeAction, r.createdById)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </CardBody>
            </Card>
          ))}
          {manage && (
            <Card>
              <CardHeader title="Add a test" />
              <CardBody>
                <LabTestForm />
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {tab === "imaging" && (
        <Card>
          <CardHeader
            title="Imaging studies"
            actions={
              manage && (
                <ActionDialog
                  action={createImagingStudyAction}
                  trigger="Add study"
                  triggerVariant="primary"
                  title="Add imaging study"
                  submitLabel="Save"
                  successMessage="Study added."
                  fields={[
                    { name: "code", label: "Code", type: "text", required: true },
                    { name: "name", label: "Name", type: "text", required: true },
                    {
                      name: "modality",
                      label: "Modality",
                      type: "select",
                      required: true,
                      options: ["XRAY", "ULTRASOUND", "CT", "MRI", "ECG", "OTHER"].map((m) => ({
                        value: m,
                        label: m,
                      })),
                    },
                    { name: "bodyPart", label: "Body region", type: "text" },
                  ]}
                />
              )
            }
          />
          <ul className="divide-y divide-border text-[14px]">
            {studies.map((s) => (
              <li key={s.id} className="px-5 py-2.5">
                {s.name} <span className="font-mono text-xs text-muted">{s.code}</span> ·{" "}
                {s.modality.toLowerCase()}
                {s.bodyPart ? ` · ${s.bodyPart}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === "vitals" && (
        <Card>
          <CardHeader
            title="Adult vital-sign display thresholds"
            description="Used only to highlight values for staff. They never change triage, priority or treatment."
            actions={
              manage && (
                <ActionDialog
                  action={proposeThresholdAction}
                  trigger="Propose threshold"
                  triggerVariant="primary"
                  title="Propose vital-sign threshold"
                  submitLabel="Save draft"
                  successMessage="Threshold proposed."
                  fields={[
                    {
                      name: "parameter",
                      label: "Parameter",
                      type: "select",
                      required: true,
                      options: Object.entries(VITAL_FIELDS).map(([k, v]) => ({
                        value: k,
                        label: `${v.label} (${v.unit})`,
                      })),
                    },
                    { name: "low", label: "Low", type: "text" },
                    { name: "high", label: "High", type: "text" },
                    { name: "criticalLow", label: "Critical low", type: "text" },
                    { name: "criticalHigh", label: "Critical high", type: "text" },
                    { name: "source", label: "Source / guideline", type: "textarea", required: true },
                  ]}
                />
              )
            }
          />
          {thresholds.length === 0 ? (
            <CardBody>
              <Alert tone="info">No thresholds configured. Vital signs are shown without flags.</Alert>
            </CardBody>
          ) : (
            <ul className="divide-y divide-border text-[14px]">
              {thresholds.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
                  <Badge tone={STATUS_TONE[t.status]}>{t.status.toLowerCase()}</Badge>
                  <span className="font-medium">
                    {VITAL_FIELDS[t.parameter].label} ({VITAL_FIELDS[t.parameter].unit})
                  </span>
                  <span>
                    {t.low?.toString() ?? "–"} to {t.high?.toString() ?? "–"} · critical &lt;
                    {t.criticalLow?.toString() ?? "–"} / &gt;{t.criticalHigh?.toString() ?? "–"}
                  </span>
                  <span className="text-muted">· {t.source}</span>
                  {t.status === "DRAFT" && decide(t.id, decideThresholdAction, t.createdById)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
