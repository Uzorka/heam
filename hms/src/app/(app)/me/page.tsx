import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { mySelfService } from "@/server/domains/hr/service";
import { myPayslips } from "@/server/domains/hr/payroll";
import { formatNaira } from "@/lib/money";
import { formatCalendarDate, formatDateTime, formatTime } from "@/lib/time";
import { label, LEAVE_TYPES, options } from "@/lib/hr-labels";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog, ConfirmAction } from "@/components/forms/action-form";
import { clockAction, requestLeaveAction } from "../hr/actions";

export const metadata: Metadata = { title: "My work & pay" };

export default async function MePage() {
  const ctx = await requireAuthContext();
  const [me, slips] = await Promise.all([mySelfService(ctx), myPayslips(ctx)]);
  if (!me) {
    return (
      <>
        <PageHeader title="My work & pay" />
        <Alert tone="info">
          Your login is not linked to an employee record yet. Ask HR to link it to use clock-in, leave and
          payslips.
        </Alert>
      </>
    );
  }
  const clockedIn = me.lastAttendance?.kind === "CLOCK_IN";
  return (
    <>
      <PageHeader
        title="My work & pay"
        description={`${me.employee.jobTitle} · ${me.employee.staffNumber}`}
        actions={
          <>
            <ConfirmAction
              action={clockAction}
              trigger={clockedIn ? "Clock out" : "Clock in"}
              triggerVariant="primary"
              title={clockedIn ? "Clock out now?" : "Clock in now?"}
              description="The current time is recorded and cannot be edited."
              submitLabel={clockedIn ? "Clock out" : "Clock in"}
              successMessage={clockedIn ? "Clocked out." : "Clocked in."}
              fixed={{ kind: clockedIn ? "CLOCK_OUT" : "CLOCK_IN" }}
            />
            <ActionDialog
              action={requestLeaveAction}
              trigger="Request leave"
              title="Request leave"
              description="A leave approver will decide. You will see the outcome here."
              submitLabel="Submit request"
              successMessage="Leave requested."
              fields={[
                {
                  name: "type",
                  label: "Type",
                  type: "select",
                  required: true,
                  options: options(LEAVE_TYPES),
                },
                { name: "startDate", label: "From", type: "date", required: true },
                { name: "endDate", label: "To (inclusive)", type: "date", required: true },
                { name: "reason", label: "Reason", type: "textarea", required: true },
              ]}
            />
          </>
        }
      />
      <p className="mb-5 text-[14px] text-muted">
        {me.lastAttendance
          ? `Last ${me.lastAttendance.kind === "CLOCK_IN" ? "clocked in" : "clocked out"} ${formatDateTime(me.lastAttendance.at)}.`
          : "No attendance recorded yet."}
      </p>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="My upcoming shifts" />
          {me.shifts.length === 0 ? (
            <CardBody className="text-[14px] text-muted">No shifts rostered.</CardBody>
          ) : (
            <TableWrap>
              <Table>
                <tbody>
                  {me.shifts.map((s) => (
                    <TR key={s.id}>
                      <TD>{formatCalendarDate(s.startAt)}</TD>
                      <TD>
                        {label(s.kind)} {formatTime(s.startAt)}–{formatTime(s.endAt)}
                      </TD>
                      <TD className="text-[13px] text-muted">{s.location ?? ""}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
        <Card>
          <CardHeader title="My leave" />
          {me.leave.length === 0 ? (
            <CardBody className="text-[14px] text-muted">No leave requests.</CardBody>
          ) : (
            <TableWrap>
              <Table>
                <tbody>
                  {me.leave.map((l) => (
                    <TR key={l.id}>
                      <TD>
                        {label(l.type)}
                        <span className="block text-[13px] text-muted">
                          {formatCalendarDate(l.startDate)} – {formatCalendarDate(l.endDate)} ({l.days} days)
                        </span>
                      </TD>
                      <TD>
                        <Badge
                          tone={
                            l.status === "APPROVED"
                              ? "success"
                              : l.status === "PENDING"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {label(l.status)}
                        </Badge>
                        {l.decisionNote && (
                          <span className="block text-[13px] text-muted">{l.decisionNote}</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="My payslips" description="Approved payroll only." />
          {slips.length === 0 ? (
            <CardBody className="text-[14px] text-muted">No payslips yet.</CardBody>
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Month</TH>
                    <TH>Lines</TH>
                    <TH className="text-right">Gross</TH>
                    <TH className="text-right">Deductions</TH>
                    <TH className="text-right">Net pay</TH>
                  </tr>
                </THead>
                <tbody>
                  {slips.map((s) => {
                    const lines = s.lines as {
                      code: string;
                      name: string;
                      kind: string;
                      amountKobo: string;
                    }[];
                    return (
                      <TR key={s.id}>
                        <TD>
                          {s.run.period}
                          <span className="block font-mono text-[13px] text-muted">{s.run.ref}</span>
                        </TD>
                        <TD className="text-[13px]">
                          {lines.map((l) => (
                            <span key={l.code} className="block">
                              {l.name}: {l.kind === "DEDUCTION" ? "−" : ""}
                              {formatNaira(BigInt(l.amountKobo))}
                            </span>
                          ))}
                        </TD>
                        <TD className="text-right tabular-nums">{formatNaira(s.grossKobo)}</TD>
                        <TD className="text-right tabular-nums">{formatNaira(s.deductionsKobo)}</TD>
                        <TD className="text-right font-medium tabular-nums">{formatNaira(s.netKobo)}</TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
