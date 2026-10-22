import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { listEmployees, roster } from "@/server/domains/hr/service";
import { addDays } from "@/lib/date-math";
import { formatCalendarDate, formatTime, localDayRange, todayLocal, toLocalDateString } from "@/lib/time";
import { label, options, SHIFT_KINDS } from "@/lib/hr-labels";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog } from "@/components/forms/action-form";
import { load } from "../../_lib/guard";
import { addShiftAction } from "../actions";

export const metadata: Metadata = { title: "Duty roster" };

export default async function RosterPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const ctx = await requireAuthContext();
  if (!ctx.activeBranchId) return <Alert tone="warning">Select a branch.</Alert>;
  const sp = await searchParams;
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : todayLocal();
  const res = await load(ctx, "/hr/roster", async () => {
    const [shifts, staff] = await Promise.all([
      roster(ctx, localDayRange(from).start, 7),
      can(ctx, "hr.roster.manage") ? listEmployees(ctx, { status: "ACTIVE" }) : Promise.resolve([]),
    ]);
    return { shifts, staff };
  });
  if (!res.ok) return <Forbidden message={res.message} />;
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return (
    <>
      <PageHeader
        title="Duty roster"
        description="Seven days from the selected date. Nobody can be rostered on overlapping shifts."
        actions={
          <>
            <Button asChild size="sm" variant="ghost">
              <Link prefetch={false} href={`/hr/roster?from=${addDays(from, -7)}`}>
                Previous week
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link prefetch={false} href={`/hr/roster?from=${addDays(from, 7)}`}>
                Next week
              </Link>
            </Button>
            {res.data.staff.length > 0 && (
              <ActionDialog
                action={addShiftAction}
                trigger="Add shift"
                triggerVariant="primary"
                title="Roster a shift"
                description="A shift ending at or before its start time ends the next day."
                submitLabel="Add"
                successMessage="Shift added."
                fields={[
                  {
                    name: "employeeId",
                    label: "Employee",
                    type: "select",
                    required: true,
                    span: 2,
                    options: res.data.staff.map((s) => ({
                      value: s.id,
                      label: `${s.familyName}, ${s.givenName} (${s.jobTitle})`,
                    })),
                  },
                  { name: "date", label: "Date", type: "date", required: true, defaultValue: from },
                  {
                    name: "kind",
                    label: "Shift",
                    type: "select",
                    required: true,
                    defaultValue: "MORNING",
                    options: options(SHIFT_KINDS),
                  },
                  { name: "startTime", label: "Start", type: "time", required: true },
                  { name: "endTime", label: "End", type: "time", required: true },
                  { name: "location", label: "Ward / unit", type: "text" },
                  { name: "note", label: "Note", type: "text" },
                ]}
              />
            )}
          </>
        }
      />
      <div className="space-y-4">
        {days.map((d) => {
          const shifts = res.data.shifts.filter((s) => toLocalDateString(s.startAt) === d);
          return (
            <Card key={d}>
              <CardHeader title={formatCalendarDate(d)} description={`${shifts.length} shift(s) starting`} />
              {shifts.length === 0 ? (
                <EmptyState
                  icon={<CalendarClock className="h-5 w-5" />}
                  title="Nobody rostered"
                  className="py-6"
                />
              ) : (
                <TableWrap>
                  <Table>
                    <THead>
                      <tr>
                        <TH>Time</TH>
                        <TH>Shift</TH>
                        <TH>Staff</TH>
                        <TH>Ward / unit</TH>
                      </tr>
                    </THead>
                    <tbody>
                      {shifts.map((s) => (
                        <TR key={s.id}>
                          <TD className="tabular-nums">
                            {formatTime(s.startAt)}–{formatTime(s.endAt)}
                          </TD>
                          <TD>{label(s.kind)}</TD>
                          <TD>
                            <Link
                              prefetch={false}
                              className="underline-offset-2 hover:underline"
                              href={`/hr/${s.employee.id}`}
                            >
                              {s.employee.givenName} {s.employee.familyName}
                            </Link>
                            <span className="block text-[13px] text-muted">{s.employee.jobTitle}</span>
                          </TD>
                          <TD className="text-[13px]">{s.location ?? "—"}</TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
