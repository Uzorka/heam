import type { Metadata } from "next";
import Link from "next/link";
import { UsersRound } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { listEmployees } from "@/server/domains/hr/service";
import { formatCalendarDate, todayLocal } from "@/lib/time";
import { EMPLOYMENT_TYPES, label, options } from "@/lib/hr-labels";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog } from "@/components/forms/action-form";
import { load } from "../_lib/guard";
import { saveEmployeeAction } from "./actions";

export const metadata: Metadata = { title: "Staff records" };

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireAuthContext();
  const { q } = await searchParams;
  const res = await load(ctx, "/hr", () => listEmployees(ctx, { q: q?.trim() || undefined }));
  if (!res.ok) return <Forbidden message={res.message} />;
  const today = todayLocal();
  const soon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader
        title="Staff records"
        description="Employment details, professional credentials and rosters. HR records contain no patient information, and bank account numbers are stored encrypted."
        actions={
          can(ctx, "hr.manage") &&
          ctx.activeBranchId && (
            <ActionDialog
              action={saveEmployeeAction}
              trigger="Add employee"
              triggerVariant="primary"
              title="Add an employee"
              description="Link a staff login by email to enable self-service clock-in, leave and payslips."
              submitLabel="Save"
              successMessage="Employee saved."
              fields={[
                { name: "staffNumber", label: "Staff number", type: "text", required: true },
                { name: "jobTitle", label: "Job title", type: "text", required: true },
                { name: "givenName", label: "First name", type: "text", required: true },
                { name: "familyName", label: "Surname", type: "text", required: true },
                { name: "department", label: "Department", type: "text" },
                {
                  name: "employmentType",
                  label: "Employment type",
                  type: "select",
                  required: true,
                  defaultValue: "PERMANENT",
                  options: options(EMPLOYMENT_TYPES),
                },
                { name: "startDate", label: "Start date", type: "date", required: true },
                { name: "phone", label: "Phone", type: "tel" },
                { name: "email", label: "Personal email", type: "email" },
                { name: "userEmail", label: "Staff login email (optional)", type: "email" },
                { name: "bankName", label: "Bank", type: "text" },
                {
                  name: "bankAccount",
                  label: "Account number (NUBAN)",
                  type: "text",
                  hint: "Stored encrypted; only the last 4 digits are shown afterwards.",
                },
              ]}
            />
          )
        }
      />
      {!ctx.activeBranchId && <Alert tone="info">Select a branch to add employees.</Alert>}
      <form className="mb-4 flex max-w-md gap-2" role="search">
        <label htmlFor="staff-q" className="sr-only">
          Search staff
        </label>
        <Input id="staff-q" name="q" defaultValue={q} placeholder="Name, staff number or job title" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <Card>
        {res.data.length === 0 ? (
          <EmptyState icon={<UsersRound className="h-5 w-5" />} title="No employees found" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Name</TH>
                  <TH>Job title</TH>
                  <TH>Type</TH>
                  <TH>Status</TH>
                  <TH>Credentials</TH>
                  <TH>
                    <span className="sr-only">Open</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {res.data.map((e) => {
                  const unverified = e.credentials.filter((c) => !c.verified).length;
                  const expiring = e.credentials.filter((c) => {
                    const d = c.expiresAt?.toISOString().slice(0, 10);
                    return d && d <= soon;
                  });
                  const expired = expiring.some((c) => c.expiresAt!.toISOString().slice(0, 10) < today);
                  return (
                    <TR key={e.id}>
                      <TD>
                        {e.givenName} {e.familyName}
                        <span className="block font-mono text-[13px] text-muted">{e.staffNumber}</span>
                      </TD>
                      <TD>
                        {e.jobTitle}
                        {e.department && <span className="block text-[13px] text-muted">{e.department}</span>}
                      </TD>
                      <TD className="text-[13px]">
                        {label(e.employmentType)}
                        <span className="block text-muted">since {formatCalendarDate(e.startDate)}</span>
                      </TD>
                      <TD>
                        <Badge tone={e.status === "ACTIVE" ? "success" : "neutral"}>{label(e.status)}</Badge>
                      </TD>
                      <TD className="space-x-1">
                        <span className="text-[13px]">{e.credentials.length}</span>
                        {unverified > 0 && <Badge tone="warning">{unverified} unverified</Badge>}
                        {expiring.length > 0 && (
                          <Badge tone={expired ? "danger" : "warning"}>
                            {expired ? "expired" : "expiring"}
                          </Badge>
                        )}
                      </TD>
                      <TD className="text-right">
                        <Button asChild size="sm" variant="secondary">
                          <Link prefetch={false} href={`/hr/${e.id}`}>
                            Open
                          </Link>
                        </Button>
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
