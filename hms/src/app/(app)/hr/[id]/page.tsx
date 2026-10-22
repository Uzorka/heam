import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { getEmployee } from "@/server/domains/hr/service";
import { employeePayItems, listPayComponents } from "@/server/domains/hr/payroll";
import { formatCalendarDate, formatDateTime, formatTime } from "@/lib/time";
import { formatNaira } from "@/lib/money";
import { label, options, LEAVE_TYPES, SHIFT_KINDS } from "@/lib/hr-labels";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DescriptionList, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog } from "@/components/forms/action-form";
import { load } from "../../_lib/guard";
import {
  addCredentialAction,
  addPayItemAction,
  addShiftAction,
  cancelShiftAction,
  clockAction,
  employeeStatusAction,
  requestLeaveAction,
  verifyCredentialAction,
} from "../actions";

export const metadata: Metadata = { title: "Employee" };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  const res = await load(ctx, `/hr/${id}`, () => getEmployee(ctx, id));
  if (!res.ok) return <Forbidden message={res.message} />;
  const e = res.data;
  const scope = { branchId: e.branchId };
  const manage = can(ctx, "hr.manage", scope);
  const rosterManage = can(ctx, "hr.roster.manage", scope);
  const payroll = can(ctx, "payroll.read", scope);
  const [payItems, components] = payroll
    ? await Promise.all([employeePayItems(ctx, e.id), listPayComponents(ctx)])
    : [[], []];
  const approved = components.filter((c) => c.status === "APPROVED");
  const now = new Date();
  return (
    <>
      <PageHeader
        back={{ href: "/hr", label: "Staff records" }}
        title={`${e.givenName} ${e.familyName}`}
        description={`${e.jobTitle} · ${e.staffNumber}`}
        actions={
          <>
            {manage && (
              <ActionDialog
                action={employeeStatusAction}
                trigger="Change status"
                title="Change employment status"
                submitLabel="Save"
                successMessage="Status updated."
                fixed={{ id: e.id }}
                fields={[
                  {
                    name: "status",
                    label: "Status",
                    type: "select",
                    required: true,
                    defaultValue: e.status,
                    options: options(["ACTIVE", "ON_LEAVE", "SUSPENDED", "EXITED"]),
                  },
                  { name: "endDate", label: "Last working day (if exited)", type: "date" },
                  { name: "reason", label: "Reason", type: "textarea", required: true },
                ]}
              />
            )}
            {rosterManage && (
              <>
                <ActionDialog
                  action={clockAction}
                  trigger="Record attendance"
                  title="Record attendance for this employee"
                  description="Use when the employee could not clock in themselves. Your name is recorded."
                  submitLabel="Record"
                  successMessage="Attendance recorded."
                  fixed={{ employeeId: e.id }}
                  fields={[
                    {
                      name: "kind",
                      label: "Event",
                      type: "select",
                      required: true,
                      defaultValue: "CLOCK_IN",
                      options: [
                        { value: "CLOCK_IN", label: "Clock in" },
                        { value: "CLOCK_OUT", label: "Clock out" },
                      ],
                    },
                    { name: "note", label: "Note", type: "text" },
                  ]}
                />
                <ActionDialog
                  action={addShiftAction}
                  trigger="Add shift"
                  triggerVariant="primary"
                  title="Roster a shift"
                  description="A shift ending at or before its start time ends the next day."
                  submitLabel="Add"
                  successMessage="Shift added."
                  fixed={{ employeeId: e.id }}
                  fields={[
                    { name: "date", label: "Date", type: "date", required: true },
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
              </>
            )}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Employment" />
          <CardBody>
            <DescriptionList
              items={[
                ["Status", label(e.status)],
                ["Type", label(e.employmentType)],
                ["Department", e.department ?? "—"],
                ["Started", formatCalendarDate(e.startDate)],
                ["Ended", e.endDate ? formatCalendarDate(e.endDate) : "—"],
                ["Phone", e.phoneE164 ?? "—"],
                ["Email", e.email ?? "—"],
                [
                  "Bank",
                  e.bankAccountLast4 ? `${e.bankName ?? "Bank"} ····${e.bankAccountLast4}` : "Not recorded",
                ],
                ["Staff login", e.userId ? "Linked" : "Not linked"],
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Professional credentials"
            description="Verified with the issuing body by someone other than the person who added them."
            actions={
              manage && (
                <ActionDialog
                  action={addCredentialAction}
                  trigger="Add"
                  title="Add a credential"
                  submitLabel="Add"
                  successMessage="Credential added."
                  fixed={{ employeeId: e.id }}
                  fields={[
                    {
                      name: "kind",
                      label: "Credential",
                      type: "text",
                      required: true,
                      placeholder: "e.g. MDCN full registration, NMCN licence",
                    },
                    { name: "number", label: "Number", type: "text", required: true },
                    { name: "issuer", label: "Issuing body", type: "text", required: true },
                    { name: "expiresAt", label: "Expires", type: "date" },
                  ]}
                />
              )
            }
          />
          {e.credentials.length === 0 ? (
            <CardBody className="text-[14px] text-muted">None recorded.</CardBody>
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Credential</TH>
                    <TH>Expires</TH>
                    <TH>Verification</TH>
                  </tr>
                </THead>
                <tbody>
                  {e.credentials.map((c) => (
                    <TR key={c.id}>
                      <TD>
                        {c.kind}
                        <span className="block text-[13px] text-muted">
                          {c.number} · {c.issuer}
                        </span>
                      </TD>
                      <TD className="text-[13px]">{c.expiresAt ? formatCalendarDate(c.expiresAt) : "—"}</TD>
                      <TD>
                        {c.verified ? (
                          <Badge tone="success">verified</Badge>
                        ) : manage ? (
                          <ActionDialog
                            action={verifyCredentialAction}
                            trigger="Verify"
                            title="Verify credential"
                            description="Record how you confirmed it with the issuing body."
                            submitLabel="Mark verified"
                            successMessage="Credential verified."
                            fixed={{ id: c.id }}
                            fields={[
                              {
                                name: "evidence",
                                label: "How it was verified",
                                type: "textarea",
                                required: true,
                              },
                            ]}
                          />
                        ) : (
                          <Badge tone="warning">unverified</Badge>
                        )}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
        <Card>
          <CardHeader title="Upcoming and recent shifts" />
          {e.shifts.length === 0 ? (
            <CardBody className="text-[14px] text-muted">No shifts rostered.</CardBody>
          ) : (
            <TableWrap>
              <Table>
                <tbody>
                  {e.shifts.map((s) => (
                    <TR key={s.id}>
                      <TD>{formatCalendarDate(s.startAt)}</TD>
                      <TD>
                        {label(s.kind)} {formatTime(s.startAt)}–{formatTime(s.endAt)}
                        {s.location && <span className="block text-[13px] text-muted">{s.location}</span>}
                      </TD>
                      <TD className="text-right">
                        {rosterManage && s.startAt > now && (
                          <ActionDialog
                            action={cancelShiftAction}
                            trigger="Cancel"
                            triggerVariant="ghost"
                            title="Cancel shift"
                            submitLabel="Cancel shift"
                            tone="danger"
                            successMessage="Shift cancelled."
                            fixed={{ id: s.id }}
                            fields={[{ name: "reason", label: "Reason", type: "text", required: true }]}
                          />
                        )}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Leave"
            actions={
              manage && (
                <ActionDialog
                  action={requestLeaveAction}
                  trigger="Record request"
                  title="Record a leave request"
                  description="It is approved by a leave approver other than you."
                  submitLabel="Submit"
                  successMessage="Leave request recorded."
                  fixed={{ employeeId: e.id }}
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
              )
            }
          />
          {e.leave.length === 0 ? (
            <CardBody className="text-[14px] text-muted">No leave requests.</CardBody>
          ) : (
            <TableWrap>
              <Table>
                <tbody>
                  {e.leave.map((l) => (
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
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
        <Card>
          <CardHeader title="Recent attendance" />
          {e.attendance.length === 0 ? (
            <CardBody className="text-[14px] text-muted">No clock-in records.</CardBody>
          ) : (
            <TableWrap>
              <Table>
                <tbody>
                  {e.attendance.map((a) => (
                    <TR key={a.id}>
                      <TD>{a.kind === "CLOCK_IN" ? "Clocked in" : "Clocked out"}</TD>
                      <TD className="text-[13px]">{formatDateTime(a.at)}</TD>
                      <TD className="text-[13px] text-muted">{a.note ?? ""}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
        {payroll && (
          <Card>
            <CardHeader
              title="Pay"
              description="Only approved pay components can be assigned. A new item for the same component ends the previous one."
              actions={
                can(ctx, "payroll.run") &&
                approved.length > 0 && (
                  <ActionDialog
                    action={addPayItemAction}
                    trigger="Set pay item"
                    title="Set a pay item"
                    submitLabel="Save"
                    successMessage="Pay item saved."
                    fixed={{ employeeId: e.id }}
                    fields={[
                      {
                        name: "componentId",
                        label: "Component",
                        type: "select",
                        required: true,
                        options: approved.map((c) => ({
                          value: c.id,
                          label:
                            c.calc === "PERCENT_OF_BASIC"
                              ? `${c.name} (${(c.rateBasisPoints ?? 0) / 100}% of basic)`
                              : c.name,
                        })),
                      },
                      {
                        name: "amountKobo",
                        label: "Monthly amount",
                        type: "money",
                        hint: "Fixed components only; leave blank for percentage components.",
                      },
                      { name: "effectiveFrom", label: "Effective from", type: "date", required: true },
                    ]}
                  />
                )
              }
            />
            {payItems.length === 0 ? (
              <CardBody className="text-[14px] text-muted">No pay items.</CardBody>
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <tr>
                      <TH>Component</TH>
                      <TH className="text-right">Amount</TH>
                      <TH>Period</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {payItems.map((p) => (
                      <TR key={p.id} className={p.effectiveTo ? "text-muted" : undefined}>
                        <TD>
                          {p.component.name}
                          <span className="block text-[13px] text-muted">{label(p.component.kind)}</span>
                        </TD>
                        <TD className="text-right tabular-nums">
                          {p.amountKobo !== null
                            ? formatNaira(p.amountKobo)
                            : `${(p.component.rateBasisPoints ?? 0) / 100}% of basic`}
                        </TD>
                        <TD className="text-[13px]">
                          from {formatCalendarDate(p.effectiveFrom)}
                          {p.effectiveTo && ` to ${formatCalendarDate(p.effectiveTo)}`}
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
