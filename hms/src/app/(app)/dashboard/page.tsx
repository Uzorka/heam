import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import {
  METRIC_DEFINITIONS,
  clinicianSummary,
  executiveSummary,
  frontDeskSummary,
  labSummary,
  pendingApprovals,
  visitsByDay,
} from "@/server/domains/dashboard/metrics";
import { STAGE_LABELS } from "@/server/domains/queue/state-machine";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader, StatTile } from "@/components/ui/misc";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { VisitsChart } from "@/components/charts/visits-chart";
import { formatDateTime, parseLocalDate, todayLocal } from "@/lib/time";
import { addDays } from "@/lib/date-math";

export const metadata: Metadata = { title: "Dashboard" };

function greeting() {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Africa/Lagos" }).format(
      new Date(),
    ),
  );
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function validDate(v: string | undefined, fallback: string) {
  if (!v) return fallback;
  try {
    parseLocalDate(v);
    return v;
  } catch {
    return fallback;
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const ctx = await requireAuthContext();
  const sp = await searchParams;
  const today = todayLocal();
  let from = validDate(sp.from, addDays(today, -13));
  let to = validDate(sp.to, today);
  if (from > to) [from, to] = [to, from];
  if (addDays(from, 366) < to) from = addDays(to, -366);

  const showExec = can(ctx, "report.executive");
  const showDesk = can(ctx, "queue.read") && !!ctx.activeBranchId;
  const showClinician =
    (can(ctx, "clinical.note.write") || can(ctx, "nursing.notes.write")) && !!ctx.activeBranchId;
  const showLab = can(ctx, "lab.worklist") && !!ctx.activeBranchId;
  const [exec, trend, desk, clin, approvals, lab] = await Promise.all([
    showExec ? executiveSummary(ctx, from, to) : null,
    showExec ? visitsByDay(ctx, from, to) : null,
    showDesk ? frontDeskSummary(ctx) : null,
    showClinician ? clinicianSummary(ctx) : null,
    pendingApprovals(ctx),
    showLab ? labSummary(ctx) : null,
  ]);
  const hasApprovals =
    (approvals.roleChanges ?? 0) + (approvals.breakGlass ?? 0) + (approvals.merges ?? 0) > 0;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${ctx.displayName.split(" ")[0]}`}
        description="Your work for today, based on your roles."
      />

      {hasApprovals && (
        <Card className="mb-6">
          <CardHeader title="Waiting for your decision" />
          <CardBody className="flex flex-wrap gap-3">
            {!!approvals.roleChanges && (
              <Button asChild variant="secondary" size="sm">
                <Link prefetch={false} href="/admin/roles">
                  {approvals.roleChanges} role change request(s)
                </Link>
              </Button>
            )}
            {!!approvals.merges && (
              <Button asChild variant="secondary" size="sm">
                <Link prefetch={false} href="/patients/duplicates?status=MERGE_REQUESTED">
                  {approvals.merges} patient merge(s) to approve
                </Link>
              </Button>
            )}
            {!!approvals.clinicalRules && (
              <Button asChild variant="secondary" size="sm">
                <Link prefetch={false} href="/admin/clinical-catalogue">
                  {approvals.clinicalRules} clinical rule(s) to approve
                </Link>
              </Button>
            )}
            {!!approvals.breakGlass && (
              <Button asChild variant="secondary" size="sm">
                <Link prefetch={false} href="/audit/break-glass">
                  {approvals.breakGlass} emergency access review(s)
                </Link>
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      {clin && (
        <section aria-labelledby="clin-h" className="mb-8">
          <h2 id="clin-h" className="mb-3 text-[15px] font-semibold">
            My clinical work
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="My open patients"
              value={clin.myOpen}
              href="/queue?mine=1"
              hint="Visits where you are on the care team"
            />
            <StatTile
              label="Ready for doctor"
              value={clin.readyForDoctor}
              href="/queue?stage=READY_FOR_DOCTOR"
            />
            <StatTile label="My appointments today" value={clin.myAppointments} href="/appointments?mine=1" />
            <StatTile
              label="Awaiting vitals"
              value={clin.awaitingVitals}
              href="/queue?stage=AWAITING_VITALS"
            />
            {can(ctx, "clinical.results.review") && (
              <StatTile
                label="Results to review"
                value={clin.resultsToReview}
                href="/results"
                hint="Verified, not yet marked reviewed"
              />
            )}
            {clin.criticalOpen > 0 && (
              <StatTile
                label="Critical results - acknowledge"
                value={clin.criticalOpen}
                href="/results"
                tone="danger"
              />
            )}
          </div>
        </section>
      )}

      {lab && (
        <section aria-labelledby="lab-h" className="mb-8">
          <h2 id="lab-h" className="mb-3 text-[15px] font-semibold">
            Laboratory
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile label="To collect" value={lab.toCollect} href="/lab?tab=TO_COLLECT" />
            <StatTile label="To receive" value={lab.toReceive} href="/lab?tab=TO_RECEIVE" />
            <StatTile label="In progress" value={lab.inProgress} href="/lab?tab=IN_PROGRESS" />
            <StatTile label="To verify" value={lab.toVerify} href="/lab?tab=TO_VERIFY" />
            <StatTile
              label="Median turnaround (7 days)"
              value={lab.medianTatMinutes === null ? "-" : `${Math.round(lab.medianTatMinutes / 6) / 10} h`}
              hint={`Order to verification, n=${lab.tatSample}`}
            />
          </div>
          {lab.statOpen > 0 && (
            <p className="mt-2 text-[13px] font-medium text-danger">{lab.statOpen} STAT request(s) open</p>
          )}
        </section>
      )}

      {desk && (
        <section aria-labelledby="desk-h" className="mb-8">
          <h2 id="desk-h" className="mb-3 text-[15px] font-semibold">
            Front desk today
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Expected (not yet arrived)" value={desk.expected} href="/appointments" />
            <StatTile label="Checked in today" value={desk.checkedIn} href="/queue" />
            <StatTile label="Waiting now" value={desk.waiting} href="/queue" />
            <StatTile
              label="Overdue arrivals"
              value={desk.overdue}
              tone={desk.overdue ? "warning" : "default"}
              hint="Booked, 30+ min past start"
              href="/appointments"
            />
            <StatTile label="New registrations" value={desk.newToday} href="/patients" />
            <StatTile label="No-shows" value={desk.noShows} />
            {desk.provisional !== null && (
              <StatTile
                label="Provisional registrations"
                value={desk.provisional}
                tone={desk.provisional ? "warning" : "default"}
                hint="Emergency arrivals to complete"
                href="/patients?provisional=1"
              />
            )}
            {desk.duplicates !== null && (
              <StatTile
                label="Duplicate reviews"
                value={desk.duplicates}
                tone={desk.duplicates ? "warning" : "default"}
                href="/patients/duplicates"
              />
            )}
          </div>
        </section>
      )}

      {exec && trend && (
        <section aria-labelledby="exec-h" className="mb-8 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="exec-h" className="text-[15px] font-semibold">
                Hospital overview
              </h2>
              <p className="text-[13px] text-muted">
                Aggregated, no patient-identifiable data. Updated {formatDateTime(exec.generatedAt)}.
              </p>
            </div>
            <form className="flex flex-wrap items-end gap-2" method="get">
              <label className="text-[13px]">
                <span className="mb-1 block text-muted">From</span>
                <Input type="date" name="from" defaultValue={from} max={today} className="w-40" />
              </label>
              <label className="text-[13px]">
                <span className="mb-1 block text-muted">To</span>
                <Input type="date" name="to" defaultValue={to} max={today} className="w-40" />
              </label>
              <Button type="submit" variant="secondary">
                Apply
              </Button>
            </form>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Checked-in visits" value={exec.checkedIn} hint={METRIC_DEFINITIONS.checkedIn} />
            <StatTile label="New patients" value={exec.newPatients} hint={METRIC_DEFINITIONS.newPatients} />
            <StatTile
              label="Repeat-patient visits"
              value={exec.repeatVisits}
              hint={METRIC_DEFINITIONS.repeatVisits}
            />
            <StatTile
              label="Median wait to consultation"
              value={exec.medianWaitMinutes === null ? "-" : `${exec.medianWaitMinutes} min`}
              hint={`${METRIC_DEFINITIONS.medianWait} n=${exec.consultationsMeasured}`}
            />
            <StatTile label="Completed visits" value={exec.completed} />
            <StatTile label="Missed appointments" value={exec.missed} hint={METRIC_DEFINITIONS.missed} />
            <StatTile label="Waiting now" value={exec.waitingNow} hint={METRIC_DEFINITIONS.waitingNow} />
            <StatTile
              label="Beds free / configured"
              value={`${exec.beds.FREE} / ${exec.beds.FREE + exec.beds.OCCUPIED + exec.beds.RESERVED + exec.beds.CLEANING + exec.beds.UNAVAILABLE}`}
              hint={
                exec.beds.demo
                  ? `${exec.beds.demo} DEMO beds - not real capacity. Admissions arrive in Phase 5.`
                  : METRIC_DEFINITIONS.beds
              }
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Visits per day" description="Check-ins by hospital-local date" />
              <CardBody>
                <VisitsChart data={trend} />
                <details className="mt-3 text-[13px]">
                  <summary className="cursor-pointer text-accent">Show as table</summary>
                  <TableWrap className="mt-2 max-h-64">
                    <Table>
                      <THead>
                        <tr>
                          <TH>Date</TH>
                          <TH className="text-right">Visits</TH>
                        </tr>
                      </THead>
                      <tbody>
                        {trend.map((d) => (
                          <TR key={d.day}>
                            <TD>{d.day}</TD>
                            <TD className="tabular text-right">{d.visits}</TD>
                          </TR>
                        ))}
                      </tbody>
                    </Table>
                  </TableWrap>
                </details>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Queue right now" />
              <CardBody>
                {exec.stageCounts.length === 0 ? (
                  <p className="text-[13px] text-muted">No patients waiting.</p>
                ) : (
                  <ul className="space-y-2">
                    {exec.stageCounts.map((s) => (
                      <li key={s.stage} className="flex justify-between text-[14px]">
                        <span>{STAGE_LABELS[s.stage]}</span>
                        <span className="tabular font-medium">{s.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
          <Alert tone="info" title="Not yet measured">
            Dispensing, revenue, receivables, HMO claims, deliveries, stock and staff on duty appear here once
            those modules are implemented (Phases 2-6). They are deliberately not shown as placeholder
            numbers.
          </Alert>
        </section>
      )}

      {!exec && !desk && !clin && !hasApprovals && (
        <Card>
          <CardBody>
            <p className="font-medium">Nothing needs your attention right now.</p>
            <p className="mt-1 text-[13px] text-muted">
              Work queues for laboratory, imaging, pharmacy, inventory, HMO, billing and HR are being built in
              later phases. When they are available, your worklist will appear here automatically based on
              your roles.
            </p>
          </CardBody>
        </Card>
      )}
    </>
  );
}
