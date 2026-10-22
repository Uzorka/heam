import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus, LogIn, Siren, UserPlus } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { frontDeskSummary } from "@/server/domains/dashboard/metrics";
import { listAppointmentsForDay } from "@/server/domains/appointments/service";
import { listQueue } from "@/server/domains/queue/service";
import { STAGE_LABELS } from "@/server/domains/queue/state-machine";
import { formatTime, todayLocal } from "@/lib/time";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader, StatTile } from "@/components/ui/misc";
import { load } from "../_lib/guard";
import { AutoRefresh } from "../queue/auto-refresh";

export const metadata: Metadata = { title: "Front desk" };

export default async function FrontDeskPage() {
  const ctx = await requireAuthContext();
  if (!ctx.activeBranchId) return <Alert tone="warning">Select a branch to use the front desk.</Alert>;
  const res = await load(ctx, "/front-desk", async () => {
    const [summary, queue] = await Promise.all([frontDeskSummary(ctx), listQueue(ctx)]);
    const appts = can(ctx, "appointment.read") ? await listAppointmentsForDay(ctx, { date: todayLocal() }) : [];
    return { summary, queue, appts };
  });
  if (!res.ok) return <Forbidden message={res.message} />;
  const { summary, queue, appts } = res.data;
  const expected = appts.filter((a) => a.status === "BOOKED");
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Front desk"
        description="Arrivals, registrations and the waiting queue for today."
        actions={
          <div className="flex flex-wrap gap-2">
            {can(ctx, "patient.create") && (
              <>
                <Button asChild variant="danger">
                  <Link prefetch={false} href="/patients/new?emergency=1">
                    <Siren className="h-4 w-4" aria-hidden /> Emergency
                  </Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link prefetch={false} href="/patients/new">
                    <UserPlus className="h-4 w-4" aria-hidden /> Register
                  </Link>
                </Button>
              </>
            )}
            {can(ctx, "appointment.manage") && (
              <Button asChild variant="secondary">
                <Link prefetch={false} href="/appointments/new">
                  <CalendarPlus className="h-4 w-4" aria-hidden /> Book
                </Link>
              </Button>
            )}
            {can(ctx, "queue.manage") && (
              <Button asChild>
                <Link prefetch={false} href="/queue/check-in">
                  <LogIn className="h-4 w-4" aria-hidden /> Check in
                </Link>
              </Button>
            )}
          </div>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Expected" value={summary.expected} hint="Booked, not yet arrived" />
        <StatTile label="Checked in" value={summary.checkedIn} />
        <StatTile label="Waiting" value={summary.waiting} href="/queue" />
        <StatTile label="Overdue" value={summary.overdue} tone={summary.overdue ? "warning" : "default"} hint="30+ min past start" />
      </div>
      {((summary.provisional ?? 0) > 0 || (summary.duplicates ?? 0) > 0) && (
        <div className="mb-6 flex flex-wrap gap-3">
          {(summary.provisional ?? 0) > 0 && (
            <Alert tone="warning" className="flex-1">
              {summary.provisional} provisional registration(s) need completing.{" "}
              <Link prefetch={false} className="underline" href="/patients?provisional=1">
                Review
              </Link>
            </Alert>
          )}
          {(summary.duplicates ?? 0) > 0 && (
            <Alert tone="warning" className="flex-1">
              {summary.duplicates} suspected duplicate record(s).{" "}
              <Link prefetch={false} className="underline" href="/patients/duplicates">
                Review
              </Link>
            </Alert>
          )}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Expected arrivals" description={`${expected.length} remaining today`} actions={<Link prefetch={false} className="text-[13px] text-accent hover:underline" href="/appointments">All appointments</Link>} />
          {expected.length === 0 ? (
            <EmptyState title="No outstanding appointments" />
          ) : (
            <ul className="divide-y divide-border">
              {expected.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      <span className="tabular">{formatTime(a.startAt)}</span> · {a.patient.givenName} {a.patient.familyName}{" "}
                      {a.startAt.getTime() < now - 30 * 60_000 && <Badge tone="warning">Late</Badge>}
                    </p>
                    <p className="truncate text-[13px] text-muted">
                      {a.visitType.name} · {a.clinician?.displayName ?? "Any clinician"}
                    </p>
                  </div>
                  {can(ctx, "queue.manage") && (
                    <Button asChild size="sm">
                      <Link prefetch={false} href={`/queue/check-in?appointmentId=${a.id}`}>Check in</Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Waiting now" actions={<AutoRefresh />} />
          {queue.length === 0 ? (
            <EmptyState title="No one waiting" />
          ) : (
            <ul className="divide-y divide-border">
              {queue.slice(0, 15).map((q) => (
                <li key={q.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {q.priority !== "ROUTINE" && (
                        <Badge tone={q.priority === "EMERGENCY" ? "danger" : "warning"} className="mr-1">
                          {q.priority.toLowerCase()}
                        </Badge>
                      )}
                      {q.patient.name}
                    </p>
                    <p className="text-[13px] text-muted">
                      {STAGE_LABELS[q.stage]} · since {formatTime(q.stageSince)}
                    </p>
                  </div>
                  <span className="font-mono text-[12px] text-muted">{q.ref}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
