import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FilePlus2, ShieldAlert } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { can, canAny } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { getEncounterWorkspace } from "@/server/domains/clinical/workspace";
import { NOTE_TEMPLATES, SECTION_LABELS, sectionsFor } from "@/server/domains/clinical/templates";
import { STAGE_LABELS } from "@/server/domains/queue/state-machine";
import { NON_CANCELLABLE } from "@/server/domains/clinical/orders";
import { bmi } from "@/server/domains/clinical/vital-flags";
import { formatDateTime } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden } from "@/components/ui/misc";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog, ActionForm, ConfirmAction } from "@/components/forms/action-form";
import { PatientBanner } from "@/components/patient/banner";
import { NoteEditor } from "@/components/clinical/note-editor";
import { OrderForm } from "@/components/clinical/order-form";
import { OrderResults } from "@/components/clinical/order-results";
import { FlagBadge } from "@/components/clinical/flag-badge";
import { UploadForm } from "@/components/clinical/upload-form";
import { PrescriptionForm } from "@/components/clinical/prescription-form";
import { PrescriptionList } from "@/components/clinical/prescription-list";
import {
  encounterPrescriptions,
  listFrequencies,
  listMedications,
} from "@/server/domains/pharmacy/prescribing";
import { pharmacyAvailability } from "@/server/domains/pharmacy/service";
import { load } from "../../_lib/guard";
import { StageButtons } from "../../queue/stage-buttons";
import { PayerPanel } from "./payer-panel";
import { QUEUE_TRANSITIONS, transitionPermission } from "@/server/domains/queue/state-machine";
import {
  acknowledgeCriticalAction,
  addDiagnosisAction,
  addendumAction,
  cancelOrderAction,
  cancelPrescriptionItemAction,
  completeOrderAction,
  createNoteAction,
  recordTriageAction,
  recordVitalsAction,
  reviewResultAction,
  updateDiagnosisAction,
  vitalsErrorAction,
} from "../actions";

export const metadata: Metadata = { title: "Visit workspace" };

const TABS = ["summary", "vitals", "notes", "diagnoses", "orders", "medications"] as const;
type Tab = (typeof TABS)[number];
const ACUITY = [
  { value: "IMMEDIATE", label: "Immediate" },
  { value: "VERY_URGENT", label: "Very urgent" },
  { value: "URGENT", label: "Urgent" },
  { value: "STANDARD", label: "Standard" },
  { value: "NON_URGENT", label: "Non-urgent" },
];

export default async function EncounterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "summary";
  const res = await load(ctx, `/encounters/${id}`, () => getEncounterWorkspace(ctx, id));
  if (!res.ok) {
    if (res.kind === "notfound") notFound();
    return <Forbidden message={res.message} />;
  }
  const w = res.data;
  const { enc } = w;
  const b = enc.branchId;
  const open = enc.status === "OPEN";
  const href = (t: Tab) => `/encounters/${id}${t === "summary" ? "" : `?tab=${t}`}`;
  const [labTests, studies] =
    tab === "orders" && open && can(ctx, "clinical.order.create", { branchId: b })
      ? await Promise.all([
          prisma.labTestDefinition.findMany({
            where: { active: true },
            orderBy: { name: "asc" },
            select: { id: true, name: true, specimenType: true },
          }),
          prisma.imagingStudyDefinition.findMany({
            where: { active: true },
            orderBy: { name: "asc" },
            select: { id: true, name: true, modality: true },
          }),
        ])
      : [[], []];
  const prescriptions = await encounterPrescriptions(enc.id);
  const canPrescribe = open && can(ctx, "clinical.prescribe", { branchId: b });
  const [medications, frequencies, availability] =
    tab === "medications" && canPrescribe
      ? await Promise.all([
          listMedications(),
          listFrequencies({ approvedOnly: true }),
          pharmacyAvailability(b),
        ])
      : [[], [], new Map<string, number>()];
  const stageOptions = open
    ? QUEUE_TRANSITIONS[enc.queueStage]
        .filter(
          (to) => to !== "CANCELLED" && can(ctx, transitionPermission(enc.queueStage, to), { branchId: b }),
        )
        .map((to) => ({ to, label: `→ ${STAGE_LABELS[to]}`, needsNote: false }))
    : [];
  const myDraftCount = w.notes.filter((n) => n.status === "DRAFT" && n.authorId === ctx.userId).length;
  const unackedCritical = w.orders.flatMap((o) =>
    o.criticalAlerts.filter((a) => !a.acknowledgedAt).map((a) => ({ alert: a, order: o })),
  );

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link prefetch={false} href="/queue" className="text-[13px] text-muted hover:text-foreground">
          ← Visit queue
        </Link>
        {stageOptions.length > 0 && (
          <StageButtons encounterId={enc.id} version={enc.version} options={stageOptions} />
        )}
      </div>
      <PatientBanner
        p={enc.patient}
        age={w.age}
        activeAllergies={w.allergies.length}
        allergyNames={w.allergies.map((a) => `${a.substance}${a.severity === "SEVERE" ? " (severe)" : ""}`)}
      />
      <div className="mb-4 space-y-2">
        <p className="text-[13px] text-muted">
          <span className="font-mono">{enc.ref}</span> · {enc.visitType.name} · arrived{" "}
          {formatDateTime(enc.arrivedAt)} · <Badge tone="accent">{STAGE_LABELS[enc.queueStage]}</Badge>{" "}
          {!open && <Badge tone="outline">Visit closed</Badge>}
        </p>
        {w.access.level === "CURRENT_VISIT" && (
          <Alert tone="info">
            You can see and document this visit. Earlier history opens once you take the patient into your
            care.
          </Alert>
        )}
        {w.access.basis === "BREAK_GLASS" && (
          <Alert tone="warning" title="Emergency access in use">
            This access is time-limited and will be reviewed by compliance.
          </Alert>
        )}
        {unackedCritical.map(({ alert, order }) => (
          <Alert key={alert.id} tone="danger" title="Critical result - acknowledgement required">
            <span className="block">{alert.summary}</span>
            {can(ctx, "lab.critical.acknowledge", { branchId: b }) && (
              <span className="mt-2 block">
                <ActionDialog
                  action={acknowledgeCriticalAction}
                  fixed={{ alertId: alert.id }}
                  trigger="Acknowledge"
                  triggerVariant="danger"
                  title="Acknowledge critical result"
                  description={`${order.description} (${order.ref}). Your name and the time are recorded.`}
                  submitLabel="Acknowledge"
                  successMessage="Critical result acknowledged."
                  fields={[
                    {
                      name: "communicatedTo",
                      label: "Responsible clinician informed",
                      type: "text",
                      required: true,
                    },
                    {
                      name: "communicationMethod",
                      label: "How",
                      type: "select",
                      required: true,
                      defaultValue: "IN_PERSON",
                      options: [
                        { value: "IN_PERSON", label: "In person" },
                        { value: "PHONE", label: "Phone" },
                        { value: "IN_APP", label: "In this system" },
                      ],
                    },
                    { name: "notes", label: "Action taken", type: "textarea" },
                  ]}
                />
              </span>
            )}
          </Alert>
        ))}
      </div>

      <LinkTabs
        label="Visit sections"
        current={tab}
        tabs={[
          { key: "summary", label: "Summary", href: href("summary") },
          {
            key: "vitals",
            label: "Vitals & triage",
            href: href("vitals"),
            count: w.vitals.filter((v) => !v.enteredInErrorAt).length,
          },
          { key: "notes", label: "Notes", href: href("notes"), count: w.notes.length },
          {
            key: "diagnoses",
            label: "Diagnoses",
            href: href("diagnoses"),
            count: w.diagnoses.filter((d) => d.status !== "ENTERED_IN_ERROR").length,
          },
          { key: "orders", label: "Orders & results", href: href("orders"), count: w.orders.length },
          {
            key: "medications",
            label: "Medications",
            href: href("medications"),
            count: prescriptions.filter((p) => p.status !== "CANCELLED").length,
          },
        ]}
      />

      {tab === "summary" &&
        canAny(ctx, ["hmo.read", "billing.read", "queue.manage", "hmo.preauth.manage"], { branchId: b }) && (
          <PayerPanel ctx={ctx} enc={enc} />
        )}
      {tab === "summary" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="This visit" />
            <CardBody className="space-y-3 text-[14px]">
              {w.triage[0] ? (
                <p>
                  <span className="text-muted">Presenting complaint:</span> {w.triage[0].chiefComplaint} ·{" "}
                  <span className="text-muted">acuity (staff-assigned):</span>{" "}
                  {ACUITY.find((a) => a.value === w.triage[0]!.acuity)?.label ?? w.triage[0].acuity}
                </p>
              ) : (
                <p className="text-muted">No triage recorded yet.</p>
              )}
              {w.vitals.find((v) => !v.enteredInErrorAt) ? (
                <VitalsLine v={w.vitals.find((v) => !v.enteredInErrorAt)!} />
              ) : (
                <p className="text-muted">No vitals recorded yet.</p>
              )}
              <p>
                <span className="text-muted">Diagnoses:</span>{" "}
                {w.diagnoses
                  .filter((d) => d.status === "ACTIVE")
                  .map((d) => `${d.description}${d.certainty === "PROVISIONAL" ? " (provisional)" : ""}`)
                  .join("; ") || "None recorded"}
              </p>
              <p>
                <span className="text-muted">Orders:</span>{" "}
                {w.orders.length
                  ? `${w.orders.length} (${w.orders.filter((o) => o.status === "VERIFIED").length} with results)`
                  : "None"}
              </p>
              {myDraftCount > 0 && (
                <Alert tone="warning">You have {myDraftCount} unsigned draft note(s) on this visit.</Alert>
              )}
            </CardBody>
          </Card>
          <div className="space-y-5">
            <Card>
              <CardHeader title="Care team" />
              <ul className="divide-y divide-border text-[14px]">
                {enc.careTeam.map((c) => (
                  <li key={c.id} className="px-5 py-2">
                    {c.user.displayName} <span className="text-xs text-muted">· {c.role.toLowerCase()}</span>
                  </li>
                ))}
                {enc.careTeam.length === 0 && <li className="px-5 py-2 text-muted">Nobody assigned yet.</li>}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Problem list" description="Active problems from earlier visits" />
              <CardBody className="text-[14px]">
                {w.problemList === null ? (
                  <p className="text-muted">Visible once the patient is under your care.</p>
                ) : w.problemList.length === 0 ? (
                  <p className="text-muted">None recorded.</p>
                ) : (
                  <ul className="list-disc space-y-1 pl-5">
                    {w.problemList.map((d) => (
                      <li key={d.id}>
                        {d.description}{" "}
                        {d.code && <span className="font-mono text-xs text-muted">{d.code}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {tab === "vitals" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card>
              <CardHeader
                title="Vital signs"
                description={
                  w.thresholdsConfigured
                    ? "Flags show values outside the hospital's approved ranges - they are not a diagnosis."
                    : "No clinician-approved thresholds are configured, so values are not flagged."
                }
              />
              {w.vitals.length === 0 ? (
                <EmptyState title="No vitals recorded" />
              ) : (
                <TableWrap>
                  <Table>
                    <THead>
                      <tr>
                        <TH>Time</TH>
                        <TH>Temp °C</TH>
                        <TH>Pulse bpm</TH>
                        <TH>RR /min</TH>
                        <TH>BP mmHg</TH>
                        <TH>SpO₂ %</TH>
                        <TH>Wt kg</TH>
                        <TH>BMI</TH>
                        <TH>Pain</TH>
                        <TH>By</TH>
                        <TH>
                          <span className="sr-only">Actions</span>
                        </TH>
                      </tr>
                    </THead>
                    <tbody>
                      {w.vitals.map((v) => (
                        <TR key={v.id} className={v.enteredInErrorAt ? "text-muted line-through" : undefined}>
                          <TD className="whitespace-nowrap text-[13px]">{formatDateTime(v.measuredAt)}</TD>
                          <TD>
                            {v.values.temperatureC ?? "-"} <FlagBadge flag={v.flags.temperatureC} />
                          </TD>
                          <TD>
                            {v.values.pulseBpm ?? "-"} <FlagBadge flag={v.flags.pulseBpm} />
                          </TD>
                          <TD>
                            {v.values.respRatePerMin ?? "-"} <FlagBadge flag={v.flags.respRatePerMin} />
                          </TD>
                          <TD className="whitespace-nowrap">
                            {v.values.systolicMmHg
                              ? `${v.values.systolicMmHg}/${v.values.diastolicMmHg}`
                              : "-"}{" "}
                            <FlagBadge flag={v.flags.systolicMmHg ?? v.flags.diastolicMmHg} />
                          </TD>
                          <TD>
                            {v.values.spo2Pct ?? "-"} <FlagBadge flag={v.flags.spo2Pct} />
                          </TD>
                          <TD>{v.values.weightKg ?? "-"}</TD>
                          <TD>{bmi(v.values.weightKg, v.values.heightCm) ?? "-"}</TD>
                          <TD>{v.values.painScore ?? "-"}</TD>
                          <TD className="text-[13px]">{v.recordedBy.displayName}</TD>
                          <TD>
                            {v.enteredInErrorAt ? (
                              <span className="text-xs no-underline">Entered in error: {v.errorReason}</span>
                            ) : (
                              can(ctx, "clinical.vitals.record", { branchId: b }) && (
                                <ActionDialog
                                  action={vitalsErrorAction}
                                  fixed={{ id: v.id }}
                                  trigger="Error"
                                  triggerVariant="ghost"
                                  title="Mark as entered in error"
                                  description="The values stay visible (struck through) for the record. Re-record the correct values."
                                  submitLabel="Mark in error"
                                  tone="danger"
                                  successMessage="Marked as entered in error."
                                  fields={[
                                    { name: "reason", label: "Reason", type: "textarea", required: true },
                                  ]}
                                />
                              )
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
                title="Triage"
                description="Acuity is the assessing nurse's or doctor's judgement; the system never assigns it."
              />
              {w.triage.length === 0 ? (
                <EmptyState title="No triage recorded" />
              ) : (
                <ul className="divide-y divide-border text-[14px]">
                  {w.triage.map((t) => (
                    <li key={t.id} className="px-5 py-3">
                      <p className="font-medium">
                        {t.chiefComplaint} ·{" "}
                        <Badge tone="accent">
                          {ACUITY.find((a) => a.value === t.acuity)?.label ?? t.acuity}
                        </Badge>
                      </p>
                      {t.notes && <p className="mt-1 whitespace-pre-wrap text-[13px]">{t.notes}</p>}
                      <p className="text-xs text-muted">
                        {t.recordedBy.displayName} · {formatDateTime(t.recordedAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <div className="space-y-5">
            {open && can(ctx, "clinical.vitals.record", { branchId: b }) && (
              <Card>
                <CardHeader title="Record vitals" description="Leave blank anything not measured." />
                <CardBody>
                  <ActionForm
                    action={recordVitalsAction}
                    fixed={{ encounterId: enc.id }}
                    submitLabel="Save vitals"
                    successMessage="Vitals recorded."
                    resetOnSuccess
                    fields={[
                      { name: "temperatureC", label: "Temperature (°C)", type: "text", placeholder: "36.8" },
                      { name: "pulseBpm", label: "Pulse (bpm)", type: "number" },
                      { name: "respRatePerMin", label: "Resp. rate (/min)", type: "number" },
                      { name: "spo2Pct", label: "SpO₂ (%)", type: "number" },
                      { name: "systolicMmHg", label: "BP systolic (mmHg)", type: "number" },
                      { name: "diastolicMmHg", label: "BP diastolic (mmHg)", type: "number" },
                      { name: "weightKg", label: "Weight (kg)", type: "text" },
                      { name: "heightCm", label: "Height (cm)", type: "text" },
                      { name: "painScore", label: "Pain (0-10)", type: "number" },
                      { name: "notes", label: "Notes", type: "textarea" },
                    ]}
                  />
                </CardBody>
              </Card>
            )}
            {open && can(ctx, "clinical.triage.record", { branchId: b }) && (
              <Card>
                <CardHeader title="Triage assessment" />
                <CardBody>
                  <ActionForm
                    action={recordTriageAction}
                    fixed={{ encounterId: enc.id }}
                    submitLabel="Save triage"
                    successMessage="Triage recorded."
                    resetOnSuccess
                    fields={[
                      {
                        name: "chiefComplaint",
                        label: "Presenting complaint",
                        type: "text",
                        required: true,
                        span: 2,
                      },
                      {
                        name: "acuity",
                        label: "Acuity (your judgement)",
                        type: "select",
                        required: true,
                        options: ACUITY,
                        span: 2,
                      },
                      { name: "notes", label: "Notes", type: "textarea" },
                    ]}
                  />
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "notes" && (
        <div className="space-y-5">
          {(can(ctx, "clinical.note.write", { branchId: b }) ||
            can(ctx, "nursing.notes.write", { branchId: b })) && (
            <Card>
              <CardBody className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-muted">New note:</span>
                {(Object.keys(NOTE_TEMPLATES) as (keyof typeof NOTE_TEMPLATES)[])
                  .filter((t) =>
                    t === "NURSING"
                      ? can(ctx, "nursing.notes.write", { branchId: b })
                      : can(ctx, "clinical.note.write", { branchId: b }),
                  )
                  .map((t) => (
                    <ConfirmAction
                      key={t}
                      action={createNoteAction}
                      fixed={{ encounterId: enc.id, type: t }}
                      trigger={
                        <>
                          <FilePlus2 className="h-4 w-4" aria-hidden /> {NOTE_TEMPLATES[t].label}
                        </>
                      }
                      title={`Start a ${NOTE_TEMPLATES[t].label.toLowerCase()}`}
                      description={
                        open
                          ? "A draft is created that only you can edit until you sign it."
                          : "This visit is closed: the note will be a late entry, timestamped now."
                      }
                      submitLabel="Start draft"
                      successMessage="Draft created."
                    />
                  ))}
              </CardBody>
            </Card>
          )}
          {w.notes.length === 0 && (
            <Card>
              <EmptyState title="No notes on this visit" />
            </Card>
          )}
          {w.notes.map((n) => {
            const parent = n.parentNoteId ? w.notes.find((x) => x.id === n.parentNoteId) : null;
            const sections = sectionsFor(n.type).map((key) => ({ key, label: SECTION_LABELS[key] }));
            return (
              <Card
                key={n.id}
                className={n.type === "ADDENDUM" ? "ml-4 border-l-4 border-l-accent/40 sm:ml-8" : undefined}
              >
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {n.type === "ADDENDUM"
                        ? "Addendum"
                        : NOTE_TEMPLATES[n.type as keyof typeof NOTE_TEMPLATES]?.label}
                      {n.status === "SIGNED" ? (
                        <Badge tone="success">Signed</Badge>
                      ) : (
                        <Badge tone="warning">Draft</Badge>
                      )}
                    </span>
                  }
                  description={`${n.author.displayName}${n.author.jobTitle ? `, ${n.author.jobTitle}` : ""} · started ${formatDateTime(n.createdAt)}${n.signedAt ? ` · signed ${formatDateTime(n.signedAt)}` : ""}${parent ? " · addendum to an earlier note" : ""}`}
                  actions={
                    n.status === "SIGNED" &&
                    (can(ctx, "clinical.note.write", { branchId: b }) ||
                      can(ctx, "nursing.notes.write", { branchId: b })) && (
                      <ConfirmAction
                        action={addendumAction}
                        fixed={{ parentNoteId: n.id }}
                        trigger="Add addendum"
                        triggerVariant="ghost"
                        title="Add an addendum"
                        description="The original note stays unchanged. Your addendum is signed separately."
                        submitLabel="Start addendum"
                        successMessage="Addendum draft created."
                      />
                    )
                  }
                />
                <CardBody>
                  {n.hiddenDraft ? (
                    <p className="text-[13px] text-muted">Draft in progress - visible once signed.</p>
                  ) : n.status === "DRAFT" ? (
                    <NoteEditor
                      noteId={n.id}
                      initialVersion={n.version}
                      sections={sections}
                      initialContent={(n.content ?? {}) as Record<string, string>}
                      canSign={
                        n.type === "NURSING"
                          ? can(ctx, "nursing.notes.write", { branchId: b }) ||
                            can(ctx, "clinical.note.sign", { branchId: b })
                          : can(ctx, "clinical.note.sign", { branchId: b })
                      }
                    />
                  ) : (
                    <dl className="space-y-3 text-[14px]">
                      {sections
                        .filter((s) => ((n.content ?? {}) as Record<string, string>)[s.key]?.trim())
                        .map((s) => (
                          <div key={s.key}>
                            <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                              {s.label}
                            </dt>
                            <dd className="mt-0.5 whitespace-pre-wrap">
                              {((n.content ?? {}) as Record<string, string>)[s.key]}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "diagnoses" && (
        <Card>
          <CardHeader
            title="Diagnoses"
            description="Provisional vs confirmed is recorded explicitly. Nothing is suggested automatically."
            actions={
              can(ctx, "clinical.diagnosis.write", { branchId: b }) && (
                <ActionDialog
                  action={addDiagnosisAction}
                  fixed={{ encounterId: enc.id }}
                  trigger="Add diagnosis"
                  triggerVariant="primary"
                  title="Add diagnosis"
                  submitLabel="Save"
                  successMessage="Diagnosis recorded."
                  fields={[
                    { name: "description", label: "Diagnosis", type: "text", required: true, span: 2 },
                    { name: "code", label: "ICD-10 code (optional)", type: "text", placeholder: "e.g. B54" },
                    {
                      name: "certainty",
                      label: "Certainty",
                      type: "select",
                      required: true,
                      defaultValue: "PROVISIONAL",
                      options: [
                        { value: "PROVISIONAL", label: "Provisional / working" },
                        { value: "CONFIRMED", label: "Confirmed" },
                      ],
                    },
                    { name: "isPrimary", label: "Primary diagnosis for this visit", type: "checkbox" },
                    {
                      name: "onProblemList",
                      label: "Add to the patient's problem list (long-term)",
                      type: "checkbox",
                    },
                  ]}
                />
              )
            }
          />
          {w.diagnoses.length === 0 ? (
            <EmptyState title="No diagnoses recorded" />
          ) : (
            <ul className="divide-y divide-border">
              {w.diagnoses.map((d) => (
                <li
                  key={d.id}
                  className={`flex flex-wrap items-start justify-between gap-2 px-5 py-3 ${d.status === "ENTERED_IN_ERROR" ? "text-muted line-through" : ""}`}
                >
                  <div>
                    <p className="font-medium">
                      {d.description}{" "}
                      {d.code && <span className="font-mono text-xs text-muted">{d.code}</span>}{" "}
                      {d.isPrimary && <Badge tone="accent">Primary</Badge>}{" "}
                      <Badge
                        tone={
                          d.certainty === "CONFIRMED"
                            ? "success"
                            : d.certainty === "REFUTED"
                              ? "outline"
                              : "warning"
                        }
                      >
                        {d.certainty.toLowerCase()}
                      </Badge>{" "}
                      {d.status !== "ACTIVE" && (
                        <Badge tone="outline">{d.status.toLowerCase().replace(/_/g, " ")}</Badge>
                      )}{" "}
                      {d.onProblemList && <Badge tone="info">Problem list</Badge>}
                    </p>
                    <p className="text-xs text-muted">
                      {d.recordedBy.displayName} · {formatDateTime(d.recordedAt)}
                      {d.statusReason ? ` · ${d.statusReason}` : ""}
                    </p>
                  </div>
                  {d.status !== "ENTERED_IN_ERROR" &&
                    can(ctx, "clinical.diagnosis.write", { branchId: b }) && (
                      <ActionDialog
                        action={updateDiagnosisAction}
                        fixed={{ id: d.id, version: d.version }}
                        trigger="Update"
                        triggerVariant="ghost"
                        title={`Update: ${d.description}`}
                        submitLabel="Save"
                        successMessage="Diagnosis updated."
                        fields={[
                          {
                            name: "certainty",
                            label: "Certainty",
                            type: "select",
                            defaultValue: d.certainty,
                            options: [
                              { value: "PROVISIONAL", label: "Provisional" },
                              { value: "CONFIRMED", label: "Confirmed" },
                              { value: "REFUTED", label: "Refuted (ruled out)" },
                            ],
                          },
                          {
                            name: "status",
                            label: "Status",
                            type: "select",
                            defaultValue: d.status,
                            options: [
                              { value: "ACTIVE", label: "Active" },
                              { value: "RESOLVED", label: "Resolved" },
                              { value: "ENTERED_IN_ERROR", label: "Entered in error" },
                            ],
                          },
                          {
                            name: "onProblemList",
                            label: "On problem list",
                            type: "checkbox",
                            defaultChecked: d.onProblemList,
                          },
                          {
                            name: "reason",
                            label: "Reason (required if refuted or in error)",
                            type: "textarea",
                          },
                        ]}
                      />
                    )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "orders" && (
        <div className="space-y-5">
          {open && can(ctx, "clinical.order.create", { branchId: b }) && (
            <Card>
              <CardHeader
                title="New orders"
                description="Allergies are shown in the banner above. No automated interaction checking is configured."
              />
              <CardBody>
                <OrderForm
                  encounterId={enc.id}
                  labTests={labTests.map((t) => ({ id: t.id, name: t.name, hint: t.specimenType }))}
                  studies={studies.map((s) => ({ id: s.id, name: s.name, hint: s.modality.toLowerCase() }))}
                />
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Orders on this visit" />
            {w.orders.length === 0 ? (
              <EmptyState title="No orders" />
            ) : (
              <CardBody className="space-y-3">
                {w.orders.map((o) => (
                  <OrderResults
                    key={o.id}
                    o={o}
                    actions={
                      <>
                        {!NON_CANCELLABLE.includes(o.status) &&
                          can(ctx, "clinical.order.cancel", { branchId: b }) && (
                            <ActionDialog
                              action={cancelOrderAction}
                              fixed={{ orderId: o.id, version: o.version }}
                              trigger="Cancel"
                              triggerVariant="ghost"
                              title={`Cancel ${o.description}?`}
                              description="Cancelled orders cannot be resulted or charged."
                              submitLabel="Cancel order"
                              tone="danger"
                              successMessage="Order cancelled."
                              fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
                            />
                          )}
                        {o.status === "VERIFIED" &&
                          !o.reviewedAt &&
                          can(ctx, "clinical.results.review", { branchId: b }) && (
                            <ConfirmAction
                              action={reviewResultAction}
                              fixed={{ orderId: o.id }}
                              trigger="Mark reviewed"
                              triggerVariant="secondary"
                              title="Confirm you have reviewed this result"
                              description="Record that you have seen and acted on the result as clinically appropriate."
                              submitLabel="Mark reviewed"
                              successMessage="Result marked as reviewed."
                            />
                          )}
                        {(o.kind === "PROCEDURE" || o.kind === "REFERRAL") &&
                          o.status === "ORDERED" &&
                          can(ctx, "clinical.note.write", { branchId: b }) && (
                            <ConfirmAction
                              action={completeOrderAction}
                              fixed={{ orderId: o.id }}
                              trigger="Mark done"
                              triggerVariant="ghost"
                              title={`Mark ${o.kind.toLowerCase()} as done?`}
                              description="Document details in a note."
                              submitLabel="Mark done"
                              successMessage="Marked as done."
                            />
                          )}
                      </>
                    }
                  />
                ))}
              </CardBody>
            )}
          </Card>
          {can(ctx, "clinical.note.write", { branchId: b }) && (
            <Card>
              <CardHeader
                title="Attach a document to this visit"
                description="e.g. referral letter or results from another facility. The origin is recorded."
              />
              <CardBody>
                <UploadForm encounterId={enc.id} defaultKind="REFERRAL" />
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {tab === "medications" && (
        <div className="space-y-5">
          {canPrescribe && (
            <Card>
              <CardHeader
                title="New prescription"
                description="Signing sends the prescription to the pharmacy for verification. Signed prescriptions cannot be edited - cancel and re-prescribe instead."
              />
              <CardBody>
                <PrescriptionForm
                  encounterId={enc.id}
                  allergies={w.allergies.map(
                    (a) => `${a.substance}${a.severity === "SEVERE" ? " (severe)" : ""}`,
                  )}
                  frequencies={frequencies.map((f) => ({
                    id: f.id,
                    code: f.code,
                    label: f.label,
                    timesPerDay: f.timesPerDay === null ? null : Number(f.timesPerDay),
                  }))}
                  medications={medications.map((m) => ({
                    id: m.id,
                    label: `${m.genericName} ${m.strength} ${m.form.toLowerCase()}${m.brandName ? ` (${m.brandName})` : ""}`,
                    defaultRoute: m.defaultRoute,
                    dispensingUnit: m.dispensingUnit,
                    controlled: m.controlled,
                    formularyStatus: m.formularyStatus,
                    inStock: availability.get(m.inventoryProductId) ?? 0,
                  }))}
                />
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Prescriptions on this visit" />
            {prescriptions.length === 0 ? (
              <EmptyState title="No prescriptions" />
            ) : (
              <CardBody>
                <PrescriptionList
                  prescriptions={prescriptions}
                  cancelItem={(item, rx) =>
                    ["PENDING", "QUERIED", "VERIFIED"].includes(item.status) &&
                    item.quantityDispensed === 0 &&
                    ((rx.prescriberId === ctx.userId && can(ctx, "clinical.prescribe", { branchId: b })) ||
                      can(ctx, "clinical.order.cancel", { branchId: b })) ? (
                      <ActionDialog
                        action={cancelPrescriptionItemAction}
                        fixed={{ itemId: item.id }}
                        trigger="Cancel"
                        triggerVariant="ghost"
                        title={`Cancel ${item.medication.genericName}?`}
                        description="The pharmacy will no longer supply this item."
                        submitLabel="Cancel item"
                        tone="danger"
                        successMessage="Prescription item cancelled."
                        fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
                      />
                    ) : null
                  }
                />
              </CardBody>
            )}
          </Card>
        </div>
      )}

      {w.access.level === "FULL" && (
        <p className="mt-6 text-[13px]">
          <Link
            prefetch={false}
            href={`/patients/${enc.patientId}?tab=clinical`}
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            <ShieldAlert className="h-4 w-4" aria-hidden /> Full clinical history
          </Link>
        </p>
      )}
    </>
  );
}

function VitalsLine({
  v,
}: {
  v: { measuredAt: Date; values: Record<string, number | null>; flags: Partial<Record<string, string>> };
}) {
  const parts: [string, string | null, string | undefined][] = [
    ["T", v.values.temperatureC !== null ? `${v.values.temperatureC} °C` : null, v.flags.temperatureC],
    ["P", v.values.pulseBpm !== null ? `${v.values.pulseBpm} bpm` : null, v.flags.pulseBpm],
    [
      "RR",
      v.values.respRatePerMin !== null ? `${v.values.respRatePerMin}/min` : null,
      v.flags.respRatePerMin,
    ],
    [
      "BP",
      v.values.systolicMmHg !== null ? `${v.values.systolicMmHg}/${v.values.diastolicMmHg} mmHg` : null,
      v.flags.systolicMmHg ?? v.flags.diastolicMmHg,
    ],
    ["SpO₂", v.values.spo2Pct !== null ? `${v.values.spo2Pct}%` : null, v.flags.spo2Pct],
  ];
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-muted">Latest vitals ({formatDateTime(v.measuredAt)}):</span>
      {parts
        .filter((p) => p[1])
        .map(([k, val, flag]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="text-muted">{k}</span> {val} <FlagBadge flag={flag} />
          </span>
        ))}
    </p>
  );
}
