import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, LogIn, Pencil } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { getPatientDetail } from "@/server/domains/patients/service";
import { getPatientTimeline } from "@/server/domains/patients/timeline";
import { getClinicalHistory } from "@/server/domains/clinical/workspace";
import { ClinicalHistory } from "./clinical-history";
import { listPatientAppointments } from "@/server/domains/appointments/service";
import { listPatientEncounters } from "@/server/domains/queue/service";
import { STAGE_LABELS } from "@/server/domains/queue/state-machine";
import { formatCalendarDate, formatDate, formatDateTime } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { DescriptionList, EmptyState, Forbidden } from "@/components/ui/misc";
import { LinkTabs } from "@/components/ui/tabs";
import { CoverageTab } from "./coverage-tab";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog, ConfirmAction } from "@/components/forms/action-form";
import { PatientBanner } from "@/components/patient/banner";
import { load } from "../../_lib/guard";
import {
  addContactAction,
  addGuardianAction,
  addIdentifierAction,
  changeAllergyStatusAction,
  completeRegistrationAction,
  deactivateContactAction,
  noKnownAllergiesAction,
  recordAllergyAction,
  recordConsentAction,
  revokeGuardianAction,
  setPatientStatusAction,
  verifyGuardianAction,
} from "../actions";
import { breakGlassAction } from "../../encounters/actions";
import { RevealIdentifier } from "./reveal";

export const metadata: Metadata = { title: "Patient record" };

const TABS = [
  "overview",
  "clinical",
  "allergies",
  "appointments",
  "visits",
  "coverage",
  "consents",
  "timeline",
] as const;
type Tab = (typeof TABS)[number];

const CONSENT_LABEL: Record<string, string> = {
  DATA_PROCESSING_NOTICE: "Privacy notice given",
  GENERAL_TREATMENT: "General consent to treatment",
  PHOTO_CAPTURE: "Photograph capture",
  SMS_REMINDERS: "SMS reminders",
  EMAIL_NOTICES: "Email notices",
  WHATSAPP_MESSAGES: "WhatsApp messages",
  PORTAL_ACCESS: "Patient portal access",
};
const ID_LABEL: Record<string, string> = {
  NIN: "NIN",
  NHIA_NUMBER: "NHIA number",
  PASSPORT: "Passport",
  VOTERS_CARD: "Voter's card",
  DRIVERS_LICENCE: "Driver's licence",
  OTHER: "Other",
};
const APPT_TONE: Record<string, "accent" | "success" | "neutral" | "warning" | "danger" | "outline"> = {
  BOOKED: "accent",
  CHECKED_IN: "success",
  COMPLETED: "neutral",
  CANCELLED: "outline",
  NO_SHOW: "warning",
  RESCHEDULED: "outline",
};

export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; registered?: string }>;
}) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";

  const res = await load(ctx, `/patients/${id}`, () => getPatientDetail(ctx, id));
  if (!res.ok) return res.kind === "notfound" ? notFound() : <Forbidden message={res.message} />;
  const d = res.data;
  const p = d.patient;
  const active = d.allergies.filter((a) => a.status === "ACTIVE");
  const editable = p.status !== "MERGED" && can(ctx, "patient.update");
  const href = (t: Tab) => `/patients/${id}${t === "overview" ? "" : `?tab=${t}`}`;

  const [appointments, encounters, timeline] = await Promise.all([
    tab === "appointments" && can(ctx, "appointment.read") ? listPatientAppointments(ctx, id) : null,
    tab === "visits" && can(ctx, "queue.read") ? listPatientEncounters(ctx, id) : null,
    tab === "timeline" ? getPatientTimeline(ctx, id) : null,
  ]);
  const clinical =
    tab === "clinical" && can(ctx, "clinical.read")
      ? await load(ctx, `/patients/${id}?tab=clinical`, () => getClinicalHistory(ctx, id))
      : null;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link prefetch={false} href="/patients" className="text-[13px] text-muted hover:text-foreground">
          ← Patients
        </Link>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button asChild variant="secondary" size="sm">
              <Link prefetch={false} href={`/patients/${id}/edit`}>
                <Pencil className="h-4 w-4" aria-hidden /> Edit details
              </Link>
            </Button>
          )}
          {p.status === "ACTIVE" && can(ctx, "appointment.manage") && (
            <Button asChild variant="secondary" size="sm">
              <Link prefetch={false} href={`/appointments/new?patientId=${id}`}>
                <CalendarPlus className="h-4 w-4" aria-hidden /> Book appointment
              </Link>
            </Button>
          )}
          {p.status === "ACTIVE" && can(ctx, "queue.manage") && (
            <Button asChild size="sm">
              <Link prefetch={false} href={`/queue/check-in?patientId=${id}`}>
                <LogIn className="h-4 w-4" aria-hidden /> Check in
              </Link>
            </Button>
          )}
        </div>
      </div>

      <PatientBanner
        p={p}
        age={d.age}
        activeAllergies={active.length}
        allergyNames={active.map((a) => a.substance)}
      />

      <div className="mb-4 space-y-2">
        {sp.registered && <Alert tone="success">Patient registered with MRN {p.mrn}.</Alert>}
        {p.status === "MERGED" && d.mergedInto && (
          <Alert tone="warning" title="This record was merged">
            It is kept for history only. Use the surviving record{" "}
            <Link prefetch={false} className="underline" href={`/patients/${d.mergedInto.id}`}>
              {d.mergedInto.mrn}
            </Link>
            .
          </Alert>
        )}
        {p.registrationStatus === "PROVISIONAL" && p.status === "ACTIVE" && (
          <Alert tone="warning" title="Registration incomplete">
            Record the date of birth (or estimated age), a contact phone, and confirm the privacy notice, then
            complete the registration.
            {editable && (
              <span className="mt-2 block">
                <ConfirmAction
                  action={completeRegistrationAction}
                  fixed={{ patientId: id }}
                  trigger="Mark registration complete"
                  title="Complete registration"
                  description="The system will check that the required details are present."
                  submitLabel="Complete registration"
                  successMessage="Registration completed."
                />
              </span>
            )}
          </Alert>
        )}
      </div>

      <LinkTabs
        label="Patient record sections"
        current={tab}
        tabs={[
          { key: "overview", label: "Overview", href: href("overview") },
          ...(can(ctx, "clinical.read")
            ? [{ key: "clinical", label: "Clinical", href: href("clinical") }]
            : []),
          { key: "allergies", label: "Allergies", href: href("allergies"), count: active.length },
          ...(can(ctx, "appointment.read")
            ? [{ key: "appointments", label: "Appointments", href: href("appointments") }]
            : []),
          ...(can(ctx, "queue.read") ? [{ key: "visits", label: "Visits", href: href("visits") }] : []),
          ...(can(ctx, "hmo.read") ? [{ key: "coverage", label: "Coverage", href: href("coverage") }] : []),
          { key: "consents", label: "Consents", href: href("consents") },
          { key: "timeline", label: "Timeline", href: href("timeline") },
        ]}
      />

      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Demographics" />
            <CardBody>
              <DescriptionList
                items={[
                  [
                    "Date of birth",
                    p.dateOfBirth
                      ? `${formatCalendarDate(p.dateOfBirth)}${p.dobProvenance === "ESTIMATED" ? " (estimated)" : ""}`
                      : null,
                  ],
                  ["Preferred name", p.preferredName],
                  ["Phone", p.phoneE164 ? formatPhone(p.phoneE164) : null],
                  ["Alternative phone", p.altPhoneE164 ? formatPhone(p.altPhoneE164) : null],
                  ["Email", p.email],
                  ["Address", [p.addressLine, p.city, p.lga, p.state].filter(Boolean).join(", ") || null],
                  ["Occupation", p.occupation],
                  ["Marital status", p.maritalStatus],
                  ["Referral source", p.referralSource],
                  ["Registered", formatDateTime(p.createdAt)],
                ]}
              />
            </CardBody>
          </Card>
          <div className="space-y-5">
            <Card>
              <CardHeader
                title="Next of kin & emergency contacts"
                actions={
                  editable && (
                    <ActionDialog
                      action={addContactAction}
                      fixed={{ patientId: id }}
                      trigger="Add"
                      title="Add contact"
                      submitLabel="Save contact"
                      successMessage="Contact added."
                      fields={[
                        { name: "name", label: "Name", type: "text", required: true },
                        { name: "relationship", label: "Relationship", type: "text", required: true },
                        { name: "phone", label: "Phone", type: "tel" },
                        {
                          name: "kind",
                          label: "Type",
                          type: "select",
                          required: true,
                          defaultValue: "BOTH",
                          options: [
                            { value: "BOTH", label: "Next of kin & emergency" },
                            { value: "NEXT_OF_KIN", label: "Next of kin only" },
                            { value: "EMERGENCY", label: "Emergency only" },
                          ],
                        },
                        { name: "addressLine", label: "Address", type: "text", span: 2 },
                        { name: "isPrimary", label: "Primary contact", type: "checkbox" },
                      ]}
                    />
                  )
                }
              />
              <CardBody>
                {d.contacts.length === 0 ? (
                  <p className="text-[13px] text-muted">No contacts recorded.</p>
                ) : (
                  <ul className="space-y-3">
                    {d.contacts.map((c) => (
                      <li key={c.id} className="flex items-start justify-between gap-2 text-[14px]">
                        <div>
                          <p className="font-medium">
                            {c.name} {c.isPrimary && <Badge tone="accent">Primary</Badge>}
                          </p>
                          <p className="text-[13px] text-muted">
                            {c.relationship}
                            {c.phoneE164 ? ` · ${formatPhone(c.phoneE164)}` : ""}
                          </p>
                        </div>
                        {editable && (
                          <ConfirmAction
                            action={deactivateContactAction}
                            fixed={{ contactId: c.id }}
                            trigger="Remove"
                            triggerVariant="ghost"
                            title="Remove contact?"
                            description="The contact is kept in history but no longer shown as current."
                            submitLabel="Remove"
                            tone="danger"
                            successMessage="Contact removed."
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title="Identity documents"
                actions={
                  editable && (
                    <ActionDialog
                      action={addIdentifierAction}
                      fixed={{ patientId: id }}
                      trigger="Add"
                      title="Add identity document"
                      description="Stored encrypted. Only staff with explicit permission can reveal the full number."
                      submitLabel="Save"
                      successMessage="Identity document added."
                      fields={[
                        {
                          name: "type",
                          label: "Type",
                          type: "select",
                          required: true,
                          defaultValue: "NIN",
                          options: Object.entries(ID_LABEL).map(([value, label]) => ({ value, label })),
                        },
                        { name: "value", label: "Number", type: "text", required: true },
                        { name: "issuer", label: "Issuer (optional)", type: "text" },
                      ]}
                    />
                  )
                }
              />
              <CardBody>
                {d.identifiers.length === 0 ? (
                  <p className="text-[13px] text-muted">None recorded.</p>
                ) : (
                  <ul className="space-y-2 text-[14px]">
                    {d.identifiers.map((i) => (
                      <li key={i.id} className="flex flex-wrap justify-between gap-2">
                        <span className="text-muted">{ID_LABEL[i.type]}</span>
                        {d.canRevealIdentifiers ? (
                          <RevealIdentifier identifierId={i.id} masked={i.masked} />
                        ) : (
                          <span className="font-mono">{i.masked}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title="Guardians & dependants"
                actions={
                  can(ctx, "patient.guardian.manage") && (
                    <ActionDialog
                      action={addGuardianAction}
                      fixed={{ dependentPatientId: id }}
                      trigger="Add guardian"
                      title="Add guardian"
                      description="Guardian links must be verified by a medical records officer before they grant any portal access."
                      submitLabel="Save"
                      successMessage="Guardian link recorded (unverified)."
                      fields={[
                        { name: "guardianName", label: "Guardian name", type: "text", required: true },
                        {
                          name: "relationship",
                          label: "Relationship",
                          type: "text",
                          required: true,
                          placeholder: "e.g. Mother",
                        },
                        { name: "guardianPhone", label: "Phone", type: "tel" },
                      ]}
                    />
                  )
                }
              />
              <CardBody className="space-y-3 text-[14px]">
                {d.guardians.length === 0 && d.dependents.length === 0 && (
                  <p className="text-[13px] text-muted">None recorded.</p>
                )}
                {d.guardians.map((g) => (
                  <div key={g.id} className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{g.guardianName}</p>
                      <p className="text-[13px] text-muted">
                        {g.relationship} ·{" "}
                        {g.verified ? (
                          <Badge tone="success">Verified</Badge>
                        ) : (
                          <Badge tone="warning">Unverified</Badge>
                        )}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {!g.verified && can(ctx, "patient.guardian.verify") && (
                        <ActionDialog
                          action={verifyGuardianAction}
                          fixed={{ relationshipId: g.id }}
                          trigger="Verify"
                          triggerVariant="ghost"
                          title="Verify guardian"
                          description="Must be a different person from whoever recorded the link."
                          submitLabel="Verify"
                          successMessage="Guardian verified."
                          fields={[
                            {
                              name: "evidence",
                              label: "Evidence checked",
                              type: "textarea",
                              required: true,
                              placeholder: "e.g. Birth certificate sighted",
                            },
                          ]}
                        />
                      )}
                      {can(ctx, "patient.guardian.manage") && (
                        <ActionDialog
                          action={revokeGuardianAction}
                          fixed={{ relationshipId: g.id }}
                          trigger="Revoke"
                          triggerVariant="ghost"
                          title="Revoke guardian link"
                          submitLabel="Revoke"
                          tone="danger"
                          successMessage="Guardian link revoked."
                          fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
                        />
                      )}
                    </div>
                  </div>
                ))}
                {d.dependents.map((g) => (
                  <p key={g.id}>
                    Guardian of{" "}
                    <Link
                      prefetch={false}
                      className="text-accent hover:underline"
                      href={`/patients/${g.dependent.id}`}
                    >
                      {g.dependent.givenName} {g.dependent.familyName}
                    </Link>{" "}
                    ({g.relationship})
                  </p>
                ))}
              </CardBody>
            </Card>
            {can(ctx, "patient.status.manage") && p.status !== "MERGED" && (
              <Card>
                <CardHeader title="Record status" description={p.statusReason ?? undefined} />
                <CardBody>
                  <ActionDialog
                    action={setPatientStatusAction}
                    fixed={{ patientId: id }}
                    trigger="Change status"
                    title="Change record status"
                    description="Records are never deleted. Marking deceased cancels future booked appointments."
                    submitLabel="Update status"
                    successMessage="Record status updated."
                    fields={[
                      {
                        name: "status",
                        label: "Status",
                        type: "select",
                        required: true,
                        defaultValue: p.status,
                        options: [
                          { value: "ACTIVE", label: "Active" },
                          { value: "INACTIVE", label: "Inactive" },
                          { value: "DECEASED", label: "Deceased" },
                        ],
                      },
                      { name: "deceasedDate", label: "Date of death (if deceased)", type: "date" },
                      { name: "reason", label: "Reason / source", type: "textarea", required: true },
                    ]}
                  />
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "allergies" && (
        <Card>
          <CardHeader
            title="Allergies"
            description="Shown on every clinical order screen. Reception entries are 'patient-reported' until a clinician verifies them."
            actions={
              can(ctx, "patient.allergy.record") &&
              p.status !== "MERGED" && (
                <>
                  {active.length === 0 && p.allergyReviewStatus !== "NO_KNOWN_ALLERGIES" && (
                    <ConfirmAction
                      action={noKnownAllergiesAction}
                      fixed={{ patientId: id }}
                      trigger="No known allergies"
                      title="Record no known allergies?"
                      description="Confirm the patient (or representative) was asked and reports no known allergies."
                      submitLabel="Confirm"
                      successMessage="Recorded: no known allergies."
                    />
                  )}
                  <ActionDialog
                    action={recordAllergyAction}
                    fixed={{ patientId: id }}
                    trigger="Add allergy"
                    triggerVariant="primary"
                    title="Record allergy"
                    submitLabel="Save allergy"
                    successMessage="Allergy recorded."
                    fields={[
                      {
                        name: "substance",
                        label: "Substance",
                        type: "text",
                        required: true,
                        placeholder: "e.g. Penicillin",
                      },
                      {
                        name: "category",
                        label: "Category",
                        type: "select",
                        required: true,
                        defaultValue: "DRUG",
                        options: [
                          { value: "DRUG", label: "Medicine" },
                          { value: "FOOD", label: "Food" },
                          { value: "ENVIRONMENT", label: "Environmental" },
                          { value: "OTHER", label: "Other" },
                        ],
                      },
                      {
                        name: "reaction",
                        label: "Reaction",
                        type: "text",
                        placeholder: "e.g. rash, swelling",
                      },
                      {
                        name: "severity",
                        label: "Severity",
                        type: "select",
                        required: true,
                        defaultValue: "UNKNOWN",
                        options: [
                          { value: "MILD", label: "Mild" },
                          { value: "MODERATE", label: "Moderate" },
                          { value: "SEVERE", label: "Severe" },
                          { value: "UNKNOWN", label: "Unknown" },
                        ],
                      },
                      {
                        name: "source",
                        label: "Source",
                        type: "select",
                        required: true,
                        defaultValue: "PATIENT_REPORTED",
                        options: [
                          { value: "PATIENT_REPORTED", label: "Reported by patient / relative" },
                          { value: "PRIOR_RECORDS", label: "From previous records" },
                          ...(can(ctx, "patient.allergy.verify")
                            ? [{ value: "CLINICIAN_VERIFIED", label: "Clinician verified" }]
                            : []),
                        ],
                      },
                    ]}
                  />
                </>
              )
            }
          />
          {d.allergies.length === 0 ? (
            <EmptyState
              title={
                p.allergyReviewStatus === "NO_KNOWN_ALLERGIES"
                  ? "No known allergies recorded"
                  : "No allergies recorded"
              }
            >
              {p.allergyReviewStatus === "NOT_ASKED"
                ? "The patient has not yet been asked about allergies."
                : undefined}
            </EmptyState>
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Substance</TH>
                    <TH>Reaction</TH>
                    <TH>Severity</TH>
                    <TH>Source</TH>
                    <TH>Status</TH>
                    <TH>Recorded</TH>
                    {can(ctx, "patient.allergy.verify") && (
                      <TH>
                        <span className="sr-only">Actions</span>
                      </TH>
                    )}
                  </tr>
                </THead>
                <tbody>
                  {d.allergies.map((a) => (
                    <TR key={a.id} className={a.status !== "ACTIVE" ? "text-muted" : undefined}>
                      <TD className="font-medium">{a.substance}</TD>
                      <TD>{a.reaction ?? "-"}</TD>
                      <TD>
                        <Badge
                          tone={
                            a.severity === "SEVERE"
                              ? "danger"
                              : a.severity === "MODERATE"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {a.severity.toLowerCase()}
                        </Badge>
                      </TD>
                      <TD className="text-[13px]">
                        {a.source === "CLINICIAN_VERIFIED"
                          ? "Clinician verified"
                          : a.source === "PRIOR_RECORDS"
                            ? "Previous records"
                            : "Patient reported"}
                      </TD>
                      <TD className="text-[13px]">
                        {a.status === "ACTIVE"
                          ? "Active"
                          : a.status === "INACTIVE"
                            ? "Inactive"
                            : "Entered in error"}
                      </TD>
                      <TD className="text-[13px]">{formatDate(a.recordedAt)}</TD>
                      {can(ctx, "patient.allergy.verify") && (
                        <TD className="whitespace-nowrap text-right">
                          {a.status === "ACTIVE" && (
                            <div className="flex justify-end gap-1">
                              {a.source !== "CLINICIAN_VERIFIED" && (
                                <ConfirmAction
                                  action={changeAllergyStatusAction}
                                  fixed={{ allergyId: a.id, action: "VERIFY" }}
                                  trigger="Verify"
                                  triggerVariant="ghost"
                                  title={`Verify allergy to ${a.substance}?`}
                                  description="Confirms you have clinically reviewed this allergy."
                                  submitLabel="Verify"
                                  successMessage="Allergy verified."
                                />
                              )}
                              <ActionDialog
                                action={changeAllergyStatusAction}
                                fixed={{ allergyId: a.id }}
                                trigger="Change"
                                triggerVariant="ghost"
                                title={`Change allergy to ${a.substance}`}
                                description="The entry is kept in history."
                                submitLabel="Save"
                                tone="danger"
                                successMessage="Allergy updated."
                                fields={[
                                  {
                                    name: "action",
                                    label: "Change to",
                                    type: "select",
                                    required: true,
                                    defaultValue: "INACTIVATE",
                                    options: [
                                      { value: "INACTIVATE", label: "No longer active" },
                                      { value: "ENTERED_IN_ERROR", label: "Entered in error" },
                                    ],
                                  },
                                  { name: "reason", label: "Reason", type: "textarea", required: true },
                                ]}
                              />
                            </div>
                          )}
                        </TD>
                      )}
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
      )}

      {tab === "appointments" && appointments && (
        <Card>
          <CardHeader title="Appointments" />
          {appointments.length === 0 ? (
            <EmptyState title="No appointments" />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>When</TH>
                    <TH>Type</TH>
                    <TH>Clinician</TH>
                    <TH>Status</TH>
                    <TH>Ref</TH>
                  </tr>
                </THead>
                <tbody>
                  {appointments.map((a) => (
                    <TR key={a.id}>
                      <TD className="whitespace-nowrap">{formatDateTime(a.startAt)}</TD>
                      <TD>{a.visitType.name}</TD>
                      <TD>{a.clinician?.displayName ?? "Any"}</TD>
                      <TD>
                        <Badge tone={APPT_TONE[a.status]}>{a.status.toLowerCase().replace("_", " ")}</Badge>
                      </TD>
                      <TD className="font-mono text-[13px]">{a.ref}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
      )}

      {tab === "visits" && encounters && (
        <Card>
          <CardHeader
            title="Visits"
            description="Clinical notes and results appear here once the consultation module is enabled (Phase 2)."
          />
          {encounters.length === 0 ? (
            <EmptyState title="No visits yet" />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Arrived</TH>
                    <TH>Type</TH>
                    <TH>Attending</TH>
                    <TH>Stage</TH>
                    <TH>Payer</TH>
                    <TH>Ref</TH>
                  </tr>
                </THead>
                <tbody>
                  {encounters.map((e) => (
                    <TR key={e.id}>
                      <TD className="whitespace-nowrap">{formatDateTime(e.arrivedAt)}</TD>
                      <TD>{e.visitType.name}</TD>
                      <TD>{e.attending?.displayName ?? "-"}</TD>
                      <TD>{STAGE_LABELS[e.queueStage]}</TD>
                      <TD className="text-[13px]">{e.payerClass.toLowerCase().replace("_", " ")}</TD>
                      <TD className="font-mono text-[13px]">{e.ref}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
      )}

      {tab === "coverage" && can(ctx, "hmo.read") && <CoverageTab ctx={ctx} patientId={id} />}

      {tab === "consents" && (
        <Card>
          <CardHeader
            title="Consents & privacy"
            description="Recording a new decision supersedes the previous one; history is kept."
            actions={
              can(ctx, "patient.consent.manage") && (
                <ActionDialog
                  action={recordConsentAction}
                  fixed={{ patientId: id }}
                  trigger="Record decision"
                  triggerVariant="primary"
                  title="Record consent decision"
                  submitLabel="Save"
                  successMessage="Consent recorded."
                  fields={[
                    {
                      name: "type",
                      label: "Consent",
                      type: "select",
                      required: true,
                      options: Object.entries(CONSENT_LABEL).map(([value, label]) => ({ value, label })),
                    },
                    {
                      name: "status",
                      label: "Decision",
                      type: "select",
                      required: true,
                      options: [
                        { value: "GRANTED", label: "Granted / acknowledged" },
                        { value: "DECLINED", label: "Declined" },
                        { value: "WITHDRAWN", label: "Withdrawn" },
                      ],
                    },
                    { name: "signatoryName", label: "Signed by (if not the patient)", type: "text" },
                    { name: "signatoryRelationship", label: "Relationship to patient", type: "text" },
                    { name: "notes", label: "Notes", type: "textarea" },
                  ]}
                />
              )
            }
          />
          {d.consents.length === 0 ? (
            <EmptyState title="No consent decisions recorded" />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Consent</TH>
                    <TH>Decision</TH>
                    <TH>Basis</TH>
                    <TH>Recorded</TH>
                  </tr>
                </THead>
                <tbody>
                  {d.consents.map((c) => (
                    <TR key={c.id}>
                      <TD>{CONSENT_LABEL[c.type]}</TD>
                      <TD>
                        <Badge tone={c.status === "GRANTED" ? "success" : "outline"}>
                          {c.status.toLowerCase()}
                        </Badge>
                      </TD>
                      <TD className="text-[13px] text-muted">
                        {c.legalBasis.toLowerCase().replace(/_/g, " ")}
                      </TD>
                      <TD className="text-[13px]">{formatDateTime(c.capturedAt)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
          <p className="border-t border-border px-5 py-3 text-xs text-muted">
            Legal bases shown are draft defaults pending review by the hospital&apos;s data protection adviser
            (NDPA 2023).
          </p>
        </Card>
      )}

      {tab === "clinical" &&
        clinical &&
        (clinical.ok ? (
          <ClinicalHistory data={clinical.data} />
        ) : (
          <Card>
            <CardHeader
              title="Clinical record restricted"
              description="You have no care relationship with this patient."
            />
            <CardBody className="space-y-3 text-[14px]">
              <p>
                Clinical history opens to clinicians caring for the patient (taking them into consultation or
                being assigned to their visit). In an emergency, clinicians may use logged emergency access,
                which is time-limited and reviewed by compliance.
              </p>
              {can(ctx, "clinical.breakglass") && (
                <ActionDialog
                  action={breakGlassAction}
                  fixed={{ patientId: id }}
                  trigger="Emergency access"
                  triggerVariant="danger"
                  title="Emergency (break-glass) access"
                  description="Use only when this patient needs care now and you cannot wait for assignment. Your access is logged, time-limited and reviewed."
                  submitLabel="Open record"
                  tone="danger"
                  successMessage="Emergency access granted. It is being logged."
                  fields={[
                    {
                      name: "reason",
                      label: "Reason",
                      type: "select",
                      required: true,
                      options: [
                        { value: "EMERGENCY_TREATMENT", label: "Emergency treatment" },
                        { value: "UNCONSCIOUS_PATIENT", label: "Patient unable to communicate" },
                        { value: "URGENT_CONSULT_COVER", label: "Urgent cover for a colleague" },
                        { value: "OTHER_URGENT", label: "Other urgent clinical need" },
                      ],
                    },
                    {
                      name: "justification",
                      label: "Clinical justification",
                      type: "textarea",
                      required: true,
                    },
                  ]}
                />
              )}
            </CardBody>
          </Card>
        ))}

      {tab === "timeline" && timeline && (
        <Card>
          <CardHeader
            title="Timeline"
            description="Administrative events. Clinical events appear once those modules are enabled and only for authorised clinicians."
          />
          <CardBody>
            <ol className="relative space-y-4 border-l border-border pl-5">
              {timeline.map((e, i) => (
                <li key={i} className="relative">
                  <span
                    className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-accent"
                    aria-hidden
                  />
                  <p className="text-[14px] font-medium">{e.title}</p>
                  <p className="text-[13px] text-muted">
                    {formatDateTime(e.at)}
                    {e.by ? ` · ${e.by}` : ""}
                    {e.detail ? ` · ${e.detail}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      )}
    </>
  );
}
