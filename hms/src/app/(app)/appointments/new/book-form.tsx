"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { useServerAction } from "@/components/forms/use-action";
import { useToast } from "@/components/forms/toaster";
import { bookAppointmentAction } from "../actions";

interface Props {
  patientId: string;
  visitTypes: { id: string; name: string; defaultDurationMin: number }[];
  clinicians: { id: string; displayName: string; jobTitle: string | null }[];
  today: string;
  canOverride: boolean;
  defaultDate?: string;
}

export function BookForm({ patientId, visitTypes, clinicians, today, canOverride, defaultDate }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { run, pending, error, fieldErrors } = useServerAction(bookAppointmentAction, { refresh: false });
  const [override, setOverride] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState("");
  const [conflict, setConflict] = React.useState(false);
  const [visitTypeId, setVisitTypeId] = React.useState(visitTypes[0]?.id ?? "");
  const vt = visitTypes.find((v) => v.id === visitTypeId);

  React.useEffect(() => {
    if (error && /overlapping/.test(error)) setConflict(true);
  }, [error]);

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const get = (k: string) => (String(fd.get(k) ?? "").trim() || undefined);
        run(
          {
            patientId,
            visitTypeId,
            clinicianId: get("clinicianId"),
            date: get("date") ?? "",
            time: get("time") ?? "",
            durationMin: get("durationMin") ? Number(get("durationMin")) : undefined,
            source: (get("source") ?? "PHONE") as "PHONE",
            reason: get("reason"),
            override: override ? { reason: overrideReason } : undefined,
          },
          (d) => {
            toast(`Appointment ${d.ref} booked.`);
            router.push(`/patients/${patientId}?tab=appointments`);
          },
        );
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Visit type" htmlFor="visitTypeId" required error={fieldErrors.visitTypeId}>
          <Select value={visitTypeId} onChange={(e) => setVisitTypeId(e.target.value)}>
            {visitTypes.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Clinician" htmlFor="clinicianId" error={fieldErrors.clinicianId} hint="Leave as 'Any available' for open clinics">
          <Select name="clinicianId" defaultValue="">
            <option value="">Any available</option>
            {clinicians.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
                {c.jobTitle ? ` - ${c.jobTitle}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" htmlFor="date" required error={fieldErrors.date}>
          <Input type="date" name="date" min={today} defaultValue={defaultDate ?? today} />
        </Field>
        <Field label="Time" htmlFor="time" required error={fieldErrors.time} hint="Hospital time (WAT)">
          <Input type="time" name="time" step={300} />
        </Field>
        <Field label="Duration (minutes)" htmlFor="durationMin" error={fieldErrors.durationMin} hint={vt ? `Default ${vt.defaultDurationMin} min` : undefined}>
          <Input type="number" name="durationMin" min={5} max={240} placeholder={vt ? String(vt.defaultDurationMin) : undefined} />
        </Field>
        <Field label="Booked via" htmlFor="source" required>
          <Select name="source" defaultValue="PHONE">
            <option value="PHONE">Phone</option>
            <option value="WALK_IN">At the desk</option>
            <option value="FOLLOW_UP">Clinician follow-up</option>
            <option value="REFERRAL">Referral</option>
            <option value="ONLINE_REQUEST">Online request</option>
          </Select>
        </Field>
        <Field label="Reason for visit" htmlFor="reason" className="sm:col-span-2" error={fieldErrors.reason} hint="Brief, non-clinical description">
          <Textarea name="reason" />
        </Field>
      </div>
      {canOverride && (conflict || override) && (
        <div className="rounded-md border border-warning/40 bg-warning-soft p-3">
          <label className="flex items-start gap-2 text-[14px]">
            <Checkbox checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-0.5" />
            <span>Book anyway as an authorised overlap (recorded in the audit trail).</span>
          </label>
          {override && (
            <Field label="Override reason" htmlFor="override-reason" required className="mt-3" error={fieldErrors["override.reason"]}>
              <Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
            </Field>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          Book appointment
        </Button>
        <Button asChild variant="ghost">
          <Link prefetch={false} href={`/patients/${patientId}`}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
