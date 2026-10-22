import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, LogIn } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { listAppointmentsForDay } from "@/server/domains/appointments/service";
import { listClinicians } from "@/server/domains/staff/clinicians";
import { STAGE_LABELS } from "@/server/domains/queue/state-machine";
import { formatAge, formatTime, parseLocalDate, todayLocal } from "@/lib/time";
import { addDays } from "@/lib/date-math";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog, ConfirmAction } from "@/components/forms/action-form";
import { load } from "../_lib/guard";
import { cancelAppointmentAction, noShowAction, rescheduleAppointmentAction } from "./actions";

export const metadata: Metadata = { title: "Appointments" };

const TONE: Record<string, "accent" | "success" | "neutral" | "warning" | "outline"> = {
  BOOKED: "accent",
  CHECKED_IN: "success",
  COMPLETED: "neutral",
  CANCELLED: "outline",
  NO_SHOW: "warning",
  RESCHEDULED: "outline",
};

function safeDate(v: string | undefined, fallback: string) {
  try {
    if (v) parseLocalDate(v);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ date?: string; clinicianId?: string; mine?: string }> }) {
  const ctx = await requireAuthContext();
  const sp = await searchParams;
  if (!ctx.activeBranchId) return <Alert tone="warning">Select a branch to view appointments.</Alert>;
  const today = todayLocal();
  const date = safeDate(sp.date, today);
  const clinicianId = sp.mine === "1" ? ctx.userId : sp.clinicianId && /^[0-9a-f-]{36}$/i.test(sp.clinicianId) ? sp.clinicianId : undefined;
  const res = await load(ctx, "/appointments", () => listAppointmentsForDay(ctx, { date, clinicianId }));
  if (!res.ok) return <Forbidden message={res.message} />;
  const rows = res.data;
  const clinicians = await listClinicians(ctx.activeBranchId);
  const manage = can(ctx, "appointment.manage", { branchId: ctx.activeBranchId });
  const checkin = can(ctx, "queue.manage", { branchId: ctx.activeBranchId });
  const now = Date.now();
  const link = (d: string) => `/appointments?date=${d}${clinicianId && sp.mine !== "1" ? `&clinicianId=${clinicianId}` : ""}${sp.mine === "1" ? "&mine=1" : ""}`;
  const active = rows.filter((r) => r.status === "BOOKED" || r.status === "CHECKED_IN").length;

  return (
    <>
      <PageHeader
        title="Appointments"
        description={`${active} active of ${rows.length} for ${new Intl.DateTimeFormat("en-NG", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))}`}
        actions={
          manage && (
            <Button asChild>
              <Link prefetch={false} href="/appointments/new">
                <CalendarPlus className="h-4 w-4" aria-hidden /> Book appointment
              </Link>
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
          <div className="flex items-center gap-1">
            <Button asChild variant="secondary" size="icon" aria-label="Previous day">
              <Link prefetch={false} href={link(addDays(date, -1))}>
                <ChevronLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link prefetch={false} href={link(today)}>Today</Link>
            </Button>
            <Button asChild variant="secondary" size="icon" aria-label="Next day">
              <Link prefetch={false} href={link(addDays(date, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="text-[13px]">
              <span className="mb-1 block text-muted">Date</span>
              <Input type="date" name="date" defaultValue={date} className="w-40" />
            </label>
            <label className="text-[13px]">
              <span className="mb-1 block text-muted">Clinician</span>
              <Select name="clinicianId" defaultValue={sp.mine === "1" ? ctx.userId : clinicianId ?? ""} className="w-56">
                <option value="">All clinicians</option>
                {clinicians.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </form>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="No appointments on this day" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Time</TH>
                  <TH>Patient</TH>
                  <TH>Visit</TH>
                  <TH>Clinician</TH>
                  <TH>Status</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {rows.map((a) => {
                  const late = a.status === "BOOKED" && a.startAt.getTime() < now - 30 * 60_000;
                  return (
                    <TR key={a.id}>
                      <TD className="whitespace-nowrap tabular">
                        {formatTime(a.startAt)}–{formatTime(a.endAt)}
                      </TD>
                      <TD>
                        <Link prefetch={false} href={`/patients/${a.patient.id}`} className="font-medium hover:text-accent hover:underline">
                          {a.patient.givenName} {a.patient.familyName}
                        </Link>
                        <div className="text-[13px] text-muted">
                          <span className="font-mono">{a.patient.mrn}</span>
                          {a.patient.dateOfBirth ? ` · ${formatAge(a.patient.dateOfBirth)}` : ""}
                        </div>
                      </TD>
                      <TD>
                        {a.visitType.name}
                        {a.allowOverlap && (
                          <Badge tone="warning" className="ml-1">
                            Override
                          </Badge>
                        )}
                      </TD>
                      <TD>{a.clinician?.displayName ?? <span className="text-muted">Any</span>}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={TONE[a.status]}>{a.status.toLowerCase().replace("_", " ")}</Badge>
                          {late && <Badge tone="warning">Late</Badge>}
                          {a.encounter && <Badge tone="outline">{STAGE_LABELS[a.encounter.queueStage]}</Badge>}
                        </div>
                      </TD>
                      <TD className="whitespace-nowrap text-right">
                        {a.status === "BOOKED" && (
                          <div className="flex justify-end gap-1">
                            {checkin && date === today && (
                              <Button asChild size="sm">
                                <Link prefetch={false} href={`/queue/check-in?appointmentId=${a.id}`}>
                                  <LogIn className="h-4 w-4" aria-hidden /> Check in
                                </Link>
                              </Button>
                            )}
                            {manage && (
                              <>
                                <ActionDialog
                                  action={rescheduleAppointmentAction}
                                  fixed={{ appointmentId: a.id, version: a.version }}
                                  trigger="Reschedule"
                                  triggerVariant="ghost"
                                  title="Reschedule appointment"
                                  description={`${a.patient.givenName} ${a.patient.familyName} · ${a.ref}`}
                                  submitLabel="Reschedule"
                                  successMessage="Appointment rescheduled."
                                  fields={[
                                    { name: "date", label: "New date", type: "date", required: true, defaultValue: date, min: today },
                                    { name: "time", label: "New time", type: "time", required: true },
                                    {
                                      name: "clinicianId",
                                      label: "Clinician",
                                      type: "select",
                                      defaultValue: a.clinician?.id ?? "",
                                      placeholder: "Keep current / any",
                                      options: clinicians.map((c) => ({ value: c.id, label: c.displayName })),
                                    },
                                  ]}
                                />
                                {a.startAt.getTime() < now && (
                                  <ConfirmAction
                                    action={noShowAction}
                                    fixed={{ appointmentId: a.id }}
                                    trigger="No-show"
                                    triggerVariant="ghost"
                                    title="Mark as no-show?"
                                    description="Use when the patient did not attend."
                                    submitLabel="Mark no-show"
                                    successMessage="Marked as no-show."
                                  />
                                )}
                                <ActionDialog
                                  action={cancelAppointmentAction}
                                  fixed={{ appointmentId: a.id }}
                                  trigger="Cancel"
                                  triggerVariant="ghost"
                                  title="Cancel appointment"
                                  submitLabel="Cancel appointment"
                                  tone="danger"
                                  successMessage="Appointment cancelled."
                                  fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
                                />
                              </>
                            )}
                          </div>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
