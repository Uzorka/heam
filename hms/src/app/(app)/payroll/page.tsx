import type { Metadata } from "next";
import Link from "next/link";
import { Coins } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { listPayComponents, listPayrollRuns } from "@/server/domains/hr/payroll";
import { formatNaira } from "@/lib/money";
import { formatDateTime, todayLocal } from "@/lib/time";
import { label } from "@/lib/hr-labels";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog } from "@/components/forms/action-form";
import { load } from "../_lib/guard";
import { decidePayComponentAction, preparePayrollAction, proposePayComponentAction } from "../hr/actions";

export const metadata: Metadata = { title: "Payroll" };

export default async function PayrollPage() {
  const ctx = await requireAuthContext();
  if (!ctx.activeBranchId) return <Alert tone="warning">Select a branch.</Alert>;
  const res = await load(ctx, "/payroll", async () => {
    const [components, runs] = await Promise.all([listPayComponents(ctx), listPayrollRuns(ctx)]);
    return { components, runs };
  });
  if (!res.ok) return <Forbidden message={res.message} />;
  const { components, runs } = res.data;
  const run = can(ctx, "payroll.run");
  const approve = can(ctx, "payroll.approve");
  const hasBasic = components.some((c) => c.isBasic && c.status === "APPROVED");
  return (
    <>
      <PageHeader
        title="Payroll"
        description="Pay rules (including statutory deductions) are entered from an authoritative source, approved by a second person, and applied only once approved. Approved runs are locked."
        actions={
          run && (
            <ActionDialog
              action={preparePayrollAction}
              trigger="Prepare payroll"
              triggerVariant="primary"
              title="Prepare a payroll run"
              description="Re-preparing a draft recalculates it from current pay items. Someone else approves it."
              submitLabel="Prepare"
              successMessage="Payroll prepared."
              fields={[
                {
                  name: "period",
                  label: "Month (YYYY-MM)",
                  type: "text",
                  required: true,
                  defaultValue: todayLocal().slice(0, 7),
                },
                { name: "note", label: "Note", type: "text" },
              ]}
            />
          )
        }
      />
      {!hasBasic && (
        <Alert tone="info" className="mb-5">
          No approved basic pay component yet. Percentage components are calculated from basic pay.
        </Alert>
      )}
      <Card className="mb-5">
        <CardHeader title="Payroll runs" />
        {runs.length === 0 ? (
          <EmptyState icon={<Coins className="h-5 w-5" />} title="No payroll runs yet" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Month</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Staff</TH>
                  <TH className="text-right">Gross</TH>
                  <TH className="text-right">Net</TH>
                  <TH>Prepared</TH>
                  <TH>
                    <span className="sr-only">Open</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {runs.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      {r.period}
                      <span className="block font-mono text-[13px] text-muted">{r.ref}</span>
                    </TD>
                    <TD>
                      <Badge tone={r.status === "APPROVED" ? "success" : "warning"}>
                        {r.status === "APPROVED" ? "approved · locked" : label(r.status)}
                      </Badge>
                    </TD>
                    <TD className="text-right tabular-nums">{r._count.payslips}</TD>
                    <TD className="text-right tabular-nums">{formatNaira(r.grossKobo)}</TD>
                    <TD className="text-right tabular-nums">{formatNaira(r.netKobo)}</TD>
                    <TD className="text-[13px]">{formatDateTime(r.preparedAt)}</TD>
                    <TD className="text-right">
                      <Button asChild size="sm" variant="secondary">
                        <Link prefetch={false} href={`/payroll/${r.id}`}>
                          Open
                        </Link>
                      </Button>
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
          title="Pay components"
          actions={
            run && (
              <ActionDialog
                action={proposePayComponentAction}
                trigger="Propose component"
                title="Propose a pay component"
                description="Record where the rule comes from (contract, policy, statute and its date). A payroll approver other than you approves it."
                submitLabel="Propose"
                successMessage="Component proposed for approval."
                fields={[
                  {
                    name: "code",
                    label: "Code",
                    type: "text",
                    required: true,
                    placeholder: "e.g. BASIC, HOUSING",
                  },
                  { name: "name", label: "Name", type: "text", required: true },
                  {
                    name: "kind",
                    label: "Kind",
                    type: "select",
                    required: true,
                    defaultValue: "EARNING",
                    options: [
                      { value: "EARNING", label: "Earning" },
                      { value: "DEDUCTION", label: "Deduction" },
                    ],
                  },
                  {
                    name: "calc",
                    label: "Calculation",
                    type: "select",
                    required: true,
                    defaultValue: "FIXED",
                    options: [
                      { value: "FIXED", label: "Fixed monthly amount (per employee)" },
                      { value: "PERCENT_OF_BASIC", label: "Percentage of basic pay" },
                    ],
                  },
                  {
                    name: "rateBasisPoints",
                    label: "Rate (basis points)",
                    type: "number",
                    hint: "For percentages: 100 basis points = 1%. E.g. 750 = 7.5%.",
                  },
                  { name: "isBasic", label: "This is basic pay", type: "checkbox" },
                  { name: "note", label: "Source / policy reference", type: "textarea", required: true },
                ]}
              />
            )
          }
        />
        {components.length === 0 ? (
          <EmptyState title="No pay components">
            Propose basic pay first, then allowances and deductions.
          </EmptyState>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Component</TH>
                  <TH>Kind</TH>
                  <TH>Calculation</TH>
                  <TH>Source</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <tbody>
                {components.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      {c.name}
                      <span className="block font-mono text-[13px] text-muted">{c.code}</span>
                    </TD>
                    <TD>{label(c.kind)}</TD>
                    <TD className="text-[13px]">
                      {c.calc === "FIXED" ? "Fixed amount" : `${(c.rateBasisPoints ?? 0) / 100}% of basic`}
                      {c.isBasic && (
                        <Badge tone="accent" className="ml-1">
                          basic
                        </Badge>
                      )}
                    </TD>
                    <TD className="max-w-xs text-[13px]">{c.note}</TD>
                    <TD>
                      {c.status === "APPROVED" ? (
                        <Badge tone="success">approved</Badge>
                      ) : approve && c.createdById !== ctx.userId ? (
                        <ActionDialog
                          action={decidePayComponentAction}
                          trigger="Review"
                          title={`Review ${c.name}`}
                          description="Check the rule against its source before approving."
                          submitLabel="Save decision"
                          successMessage="Decision recorded."
                          fixed={{ id: c.id }}
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
                          ]}
                        />
                      ) : (
                        <Badge tone="warning">awaiting approval</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
