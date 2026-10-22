import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { loadScopedPatient, searchPatients } from "@/server/domains/patients/service";
import { listAppointmentsForDay } from "@/server/domains/appointments/service";
import { listVisitTypes } from "@/server/domains/settings/service";
import { listClinicians } from "@/server/domains/staff/clinicians";
import { formatAge, formatTime, todayLocal } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import type { FieldSpec } from "@/components/forms/action-form";
import { PatientBanner } from "@/components/patient/banner";
import { allowed, load } from "../../_lib/guard";
import { CheckInForm } from "./check-in-form";

export const metadata: Metadata = { title: "Check in" };

const COMMON: FieldSpec[] = [
  {
    name: "priority",
    label: "Priority (staff judgement)",
    type: "select",
    required: true,
    defaultValue: "ROUTINE",
    hint: "Set by staff. Clinical triage is done by a nurse or doctor.",
    options: [
      { value: "ROUTINE", label: "Routine" },
      { value: "URGENT", label: "Urgent" },
      { value: "EMERGENCY", label: "Emergency" },
    ],
  },
  {
    name: "payerClass",
    label: "How will the visit be paid?",
    type: "select",
    required: true,
    defaultValue: "UNDETERMINED",
    hint: "HMO coverage checks arrive in Phase 4; record the patient's stated payer for now.",
    options: [
      { value: "UNDETERMINED", label: "Not yet determined" },
      { value: "CASH", label: "Self-pay (cash / transfer / POS)" },
      { value: "HMO", label: "HMO / insurance (to be verified)" },
      { value: "CORPORATE", label: "Corporate account" },
      { value: "PART_INSURED", label: "Part insured" },
    ],
  },
  { name: "reason", label: "Reason for visit", type: "textarea", hint: "Brief, non-clinical" },
  { name: "financialTermsAcknowledged", label: "Patient informed of fees / deposit policy", type: "checkbox" },
];

export default async function CheckInPage({ searchParams }: { searchParams: Promise<{ patientId?: string; appointmentId?: string; q?: string }> }) {
  const ctx = await requireAuthContext();
  if (!(await allowed(ctx, "/queue/check-in", ["queue.manage"]))) return <Forbidden />;
  if (!ctx.activeBranchId) return <Alert tone="warning">Select a branch first.</Alert>;
  if (!can(ctx, "queue.manage", { branchId: ctx.activeBranchId })) return <Forbidden message="You cannot check patients in at this branch." />;
  const sp = await searchParams;
  const uuidRe = /^[0-9a-f-]{36}$/i;

  if (sp.appointmentId && uuidRe.test(sp.appointmentId)) {
    const appt = await prisma.appointment.findUnique({
      where: { id: sp.appointmentId },
      include: { patient: true, visitType: true, clinician: { select: { displayName: true } } },
    });
    if (!appt || appt.branchId !== ctx.activeBranchId) return <Alert tone="warning">Appointment not found in this branch.</Alert>;
    const allergies = await prisma.patientAllergy.findMany({ where: { patientId: appt.patientId, status: "ACTIVE" }, select: { substance: true } });
    return (
      <>
        <PageHeader title="Check in appointment" back={{ href: "/appointments", label: "Appointments" }} />
        <div className="max-w-3xl">
          <PatientBanner p={appt.patient} age={appt.patient.dateOfBirth ? formatAge(appt.patient.dateOfBirth) : null} activeAllergies={allergies.length} allergyNames={allergies.map((a) => a.substance)} />
          <Card>
            <CardHeader title={`${appt.visitType.name} at ${formatTime(appt.startAt)}`} description={`${appt.ref} · ${appt.clinician?.displayName ?? "Any clinician"}`} />
            <CardBody>
              {appt.status !== "BOOKED" ? (
                <Alert tone="info">This appointment is already {appt.status.toLowerCase().replace("_", " ")}.</Alert>
              ) : (
                <CheckInForm fixed={{ appointmentId: appt.id }} fields={COMMON} />
              )}
            </CardBody>
          </Card>
        </div>
      </>
    );
  }

  if (sp.patientId && uuidRe.test(sp.patientId)) {
    const res = await load(ctx, "/queue/check-in", () => loadScopedPatient(ctx, sp.patientId!, "patient.search"));
    if (!res.ok) return <Forbidden message={res.message} />;
    const p = res.data;
    const [visitTypes, clinicians, open, allergies] = await Promise.all([
      listVisitTypes({ activeOnly: true }),
      listClinicians(ctx.activeBranchId),
      prisma.encounter.findFirst({ where: { patientId: p.id, branchId: ctx.activeBranchId, status: "OPEN" }, select: { id: true, ref: true } }),
      prisma.patientAllergy.findMany({ where: { patientId: p.id, status: "ACTIVE" }, select: { substance: true } }),
    ]);
    return (
      <>
        <PageHeader title="Walk-in check in" back={{ href: `/patients/${p.id}`, label: "Back to patient" }} />
        <div className="max-w-3xl">
          <PatientBanner p={p} age={p.dateOfBirth ? formatAge(p.dateOfBirth) : null} activeAllergies={allergies.length} allergyNames={allergies.map((a) => a.substance)} />
          {open ? (
            <Alert tone="info" title="Already checked in">
              This patient has an open visit ({open.ref}). <Link prefetch={false} className="underline" href="/queue">Go to the queue</Link>.
            </Alert>
          ) : p.status !== "ACTIVE" ? (
            <Alert tone="warning">This record is {p.status.toLowerCase()} and cannot be checked in.</Alert>
          ) : (
            <Card>
              <CardBody>
                <CheckInForm
                  fixed={{ patientId: p.id }}
                  fields={[
                    { name: "visitTypeId", label: "Visit type", type: "select", required: true, defaultValue: visitTypes[0]?.id, options: visitTypes.map((v) => ({ value: v.id, label: v.name })) },
                    { name: "clinicianId", label: "Clinician (optional)", type: "select", placeholder: "Not assigned yet", options: clinicians.map((c) => ({ value: c.id, label: c.displayName })) },
                    ...COMMON,
                    { name: "referralSource", label: "Referred by", type: "text" },
                  ]}
                />
              </CardBody>
            </Card>
          )}
        </div>
      </>
    );
  }

  const [appointments, results] = await Promise.all([
    listAppointmentsForDay(ctx, { date: todayLocal() }),
    sp.q ? searchPatients(ctx, { q: sp.q, page: 1, pageSize: 10, includeInactive: false, provisionalOnly: false }) : null,
  ]);
  const booked = appointments.filter((a) => a.status === "BOOKED");
  return (
    <>
      <PageHeader
        title="Check in"
        description="Check in a booked appointment, or find a walk-in patient. For an unidentified emergency patient, register with minimum details first."
        back={{ href: "/queue", label: "Queue" }}
        actions={
          <Button asChild variant="danger">
            <Link prefetch={false} href="/patients/new?emergency=1">Emergency registration</Link>
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Today's booked appointments" description={`${booked.length} not yet arrived`} />
          {booked.length === 0 ? (
            <EmptyState title="No outstanding appointments today" />
          ) : (
            <ul className="divide-y divide-border">
              {booked.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="font-medium">
                      {formatTime(a.startAt)} · {a.patient.givenName} {a.patient.familyName}
                    </p>
                    <p className="text-[13px] text-muted">
                      <span className="font-mono">{a.patient.mrn}</span> · {a.visitType.name} · {a.clinician?.displayName ?? "Any"}
                    </p>
                  </div>
                  <Button asChild size="sm">
                    <Link prefetch={false} href={`/queue/check-in?appointmentId=${a.id}`}>Check in</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Walk-in patient" />
          <CardBody>
            <form method="get" className="flex gap-2" role="search">
              <label htmlFor="q" className="sr-only">
                Find patient
              </label>
              <Input id="q" name="q" defaultValue={sp.q} placeholder="MRN, name or phone" />
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>
          </CardBody>
          {results &&
            (results.rows.length === 0 ? (
              <EmptyState title="No matching patients">
                <Link prefetch={false} className="text-accent underline" href="/patients/new">
                  Register new patient
                </Link>
              </EmptyState>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {results.rows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="font-medium">{r.name}</p>
                      <p className="text-[13px] text-muted">
                        <span className="font-mono">{r.mrn}</span> · {r.age ?? "age unknown"} · {r.maskedPhone || "no phone"}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="secondary">
                      <Link prefetch={false} href={`/queue/check-in?patientId=${r.id}`}>Select</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            ))}
        </Card>
      </div>
    </>
  );
}
