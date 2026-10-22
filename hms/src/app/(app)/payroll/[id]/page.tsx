import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { getPayrollRun } from "@/server/domains/hr/payroll";
import { formatNaira } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Forbidden, PageHeader, StatTile } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmAction } from "@/components/forms/action-form";
import { PrintButton } from "@/components/print-button";
import { load } from "../../_lib/guard";
import { approvePayrollAction } from "../../hr/actions";

export const metadata: Metadata = { title: "Payroll run" };

export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  const res = await load(ctx, `/payroll/${id}`, () => getPayrollRun(ctx, id));
  if (!res.ok) return <Forbidden message={res.message} />;
  const r = res.data;
  const canApprove =
    r.status === "DRAFT" &&
    can(ctx, "payroll.approve", { branchId: r.branchId }) &&
    r.preparedById !== ctx.userId;
  const slips = [...r.payslips].sort((a, b) => a.employee.familyName.localeCompare(b.employee.familyName));
  return (
    <>
      <PageHeader
        back={{ href: "/payroll", label: "Payroll" }}
        title={`Payroll ${r.period}`}
        description={`${r.ref} · prepared ${formatDateTime(r.preparedAt)}${r.approvedAt ? ` · approved ${formatDateTime(r.approvedAt)}` : ""}`}
        actions={
          <>
            <PrintButton />
            {canApprove && (
              <ConfirmAction
                action={approvePayrollAction}
                trigger="Approve and lock"
                triggerVariant="primary"
                title="Approve this payroll run?"
                description="Approval locks the run and every payslip. It cannot be edited afterwards."
                submitLabel="Approve and lock"
                successMessage="Payroll approved and locked."
                fixed={{ id: r.id, version: r.version }}
              />
            )}
          </>
        }
      />
      {r.status === "DRAFT" && r.preparedById === ctx.userId && (
        <Alert tone="info" className="mb-5">
          You prepared this run, so another payroll approver must approve it.
        </Alert>
      )}
      <div className="mb-5 grid gap-4 sm:grid-cols-4">
        <StatTile label="Status" value={r.status === "APPROVED" ? "Approved · locked" : "Draft"} />
        <StatTile label="Gross" value={formatNaira(r.grossKobo)} />
        <StatTile label="Deductions" value={formatNaira(r.deductionsKobo)} />
        <StatTile label="Net pay" value={formatNaira(r.netKobo)} />
      </div>
      <Card>
        <CardHeader title={`${slips.length} payslip(s)`} />
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Employee</TH>
                <TH>Lines</TH>
                <TH className="text-right">Gross</TH>
                <TH className="text-right">Deductions</TH>
                <TH className="text-right">Net</TH>
                <TH>Bank</TH>
              </tr>
            </THead>
            <tbody>
              {slips.map((s) => {
                const lines = s.lines as { code: string; name: string; kind: string; amountKobo: string }[];
                return (
                  <TR key={s.id}>
                    <TD>
                      {s.employee.givenName} {s.employee.familyName}
                      <span className="block font-mono text-[13px] text-muted">{s.employee.staffNumber}</span>
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
                    <TD className="text-[13px]">
                      {s.employee.bankAccountLast4 ? (
                        `${s.employee.bankName ?? ""} ····${s.employee.bankAccountLast4}`
                      ) : (
                        <Badge tone="warning">no bank details</Badge>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
    </>
  );
}
