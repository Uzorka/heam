import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { loadScopedPatient, searchPatients } from "@/server/domains/patients/service";
import { listVisitTypes } from "@/server/domains/settings/service";
import { listClinicians } from "@/server/domains/staff/clinicians";
import { todayLocal, formatAge } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { allowed, load } from "../../_lib/guard";
import { BookForm } from "./book-form";

export const metadata: Metadata = { title: "Book appointment" };

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string; q?: string; date?: string }>;
}) {
  const ctx = await requireAuthContext();
  if (!(await allowed(ctx, "/appointments/new", ["appointment.manage"]))) return <Forbidden />;
  if (!ctx.activeBranchId) return <Alert tone="warning">Select a branch first.</Alert>;
  const sp = await searchParams;

  if (!sp.patientId) {
    const results = sp.q
      ? await searchPatients(ctx, {
          q: sp.q,
          page: 1,
          pageSize: 10,
          includeInactive: false,
          provisionalOnly: false,
        })
      : null;
    return (
      <>
        <PageHeader
          title="Book appointment"
          description="Find the patient first."
          back={{ href: "/appointments", label: "Appointments" }}
        />
        <Card className="max-w-2xl">
          <CardBody>
            <form method="get" className="flex gap-2" role="search">
              <label htmlFor="q" className="sr-only">
                Find patient
              </label>
              <Input id="q" name="q" defaultValue={sp.q} placeholder="MRN, name or phone" autoFocus />
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>
          </CardBody>
          {results &&
            (results.rows.length === 0 ? (
              <EmptyState title="No matching patients">
                <Link prefetch={false} className="text-accent underline" href="/patients/new">
                  Register a new patient
                </Link>
              </EmptyState>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {results.rows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="font-medium">{r.name}</p>
                      <p className="text-[13px] text-muted">
                        <span className="font-mono">{r.mrn}</span> · {r.age ?? "age unknown"} ·{" "}
                        {r.maskedPhone || "no phone"}
                      </p>
                    </div>
                    <Button asChild size="sm">
                      <Link prefetch={false} href={`/appointments/new?patientId=${r.id}`}>
                        Select
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            ))}
        </Card>
      </>
    );
  }

  const res = await load(ctx, "/appointments/new", () =>
    loadScopedPatient(ctx, sp.patientId!, "patient.search"),
  );
  if (!res.ok) return <Forbidden message={res.message} />;
  const p = res.data;
  const [visitTypes, clinicians] = await Promise.all([
    listVisitTypes({ activeOnly: true }),
    listClinicians(ctx.activeBranchId),
  ]);
  return (
    <>
      <PageHeader
        title="Book appointment"
        description={`${p.givenName} ${p.familyName} · ${p.mrn}${p.dateOfBirth ? ` · ${formatAge(p.dateOfBirth)}` : ""}`}
        back={{ href: `/patients/${p.id}`, label: "Back to patient" }}
      />
      {p.status !== "ACTIVE" ? (
        <Alert tone="warning">This record is {p.status.toLowerCase()} and cannot be booked.</Alert>
      ) : (
        <Card className="max-w-3xl">
          <CardHeader
            title="Appointment details"
            description="A clinician cannot be double-booked. Overlaps need an authorised override."
          />
          <CardBody>
            <BookForm
              patientId={p.id}
              visitTypes={visitTypes}
              clinicians={clinicians}
              today={todayLocal()}
              defaultDate={sp.date}
              canOverride={can(ctx, "appointment.override", { branchId: ctx.activeBranchId })}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}
