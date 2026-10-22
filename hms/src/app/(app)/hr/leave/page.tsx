import type { Metadata } from "next";
import { CalendarCheck2 } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { pendingLeave } from "@/server/domains/hr/service";
import { formatCalendarDate, formatDateTime } from "@/lib/time";
import { label } from "@/lib/hr-labels";
import { Card } from "@/components/ui/card";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog } from "@/components/forms/action-form";
import { allowed, load } from "../../_lib/guard";
import { decideLeaveAction } from "../actions";

export const metadata: Metadata = { title: "Leave approvals" };

export default async function LeaveApprovalsPage() {
  const ctx = await requireAuthContext();
  if (!(await allowed(ctx, "/hr/leave", ["hr.leave.approve"]))) return <Forbidden />;
  const res = await load(ctx, "/hr/leave", () => pendingLeave(ctx));
  if (!res.ok) return <Forbidden message={res.message} />;
  return (
    <>
      <PageHeader
        title="Leave approvals"
        description="You cannot decide your own leave or a request you recorded."
      />
      <Card>
        {res.data.length === 0 ? (
          <EmptyState icon={<CalendarCheck2 className="h-5 w-5" />} title="No pending leave requests" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Employee</TH>
                  <TH>Leave</TH>
                  <TH>Reason</TH>
                  <TH>Requested</TH>
                  <TH>
                    <span className="sr-only">Decide</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {res.data.map((l) => {
                  const own = l.employee.userId === ctx.userId || l.requestedById === ctx.userId;
                  return (
                    <TR key={l.id}>
                      <TD>
                        {l.employee.givenName} {l.employee.familyName}
                        <span className="block font-mono text-[13px] text-muted">
                          {l.employee.staffNumber}
                        </span>
                      </TD>
                      <TD>
                        {label(l.type)}
                        <span className="block text-[13px] text-muted">
                          {formatCalendarDate(l.startDate)} – {formatCalendarDate(l.endDate)} ({l.days} days)
                        </span>
                      </TD>
                      <TD className="max-w-xs text-[13px]">{l.reason}</TD>
                      <TD className="text-[13px]">{formatDateTime(l.requestedAt)}</TD>
                      <TD className="text-right">
                        {own ? (
                          <span className="text-[13px] text-muted">Another approver decides</span>
                        ) : (
                          <ActionDialog
                            action={decideLeaveAction}
                            trigger="Decide"
                            title="Decide leave request"
                            submitLabel="Save decision"
                            successMessage="Decision recorded."
                            fixed={{ id: l.id }}
                            fields={[
                              {
                                name: "decision",
                                label: "Decision",
                                type: "select",
                                required: true,
                                options: [
                                  { value: "APPROVE", label: "Approve" },
                                  { value: "REJECT", label: "Reject" },
                                ],
                              },
                              { name: "note", label: "Note", type: "textarea" },
                            ]}
                          />
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
