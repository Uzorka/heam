import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { isReportKey, REPORTS, runReport, type ReportKey } from "@/server/domains/reports/service";
import { addDays } from "@/lib/date-math";
import { todayLocal } from "@/lib/time";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { allowed, load } from "../_lib/guard";

export const metadata: Metadata = { title: "Reports" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; from?: string; to?: string }>;
}) {
  const ctx = await requireAuthContext();
  if (
    !(await allowed(ctx, "/reports", [
      "report.operational",
      "report.clinical",
      "report.financial",
      "report.hmo",
    ]))
  )
    return <Forbidden />;
  const sp = await searchParams;
  const available = (Object.keys(REPORTS) as ReportKey[]).filter((k) => can(ctx, REPORTS[k].permission));
  const key = sp.report && isReportKey(sp.report) && available.includes(sp.report) ? sp.report : undefined;
  const to = sp.to && DATE.test(sp.to) ? sp.to : todayLocal();
  const from = sp.from && DATE.test(sp.from) ? sp.from : addDays(to, -29);
  const res = key ? await load(ctx, "/reports", () => runReport(ctx, key, from, to)) : undefined;
  const canExport = can(ctx, "export.data");
  return (
    <>
      <PageHeader
        title="Reports"
        description="Aggregated figures for the branches you can access. Reports contain no patient identifiers; exports are watermarked and recorded in the audit trail."
      />
      <Card className="mb-5 p-4">
        <form className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          <Field label="Report" htmlFor="r-report">
            <Select id="r-report" name="report" defaultValue={key ?? ""}>
              <option value="">Select a report</option>
              {available.map((k) => (
                <option key={k} value={k}>
                  {REPORTS[k].title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" htmlFor="r-from">
            <Input id="r-from" name="from" type="date" defaultValue={from} />
          </Field>
          <Field label="To" htmlFor="r-to">
            <Input id="r-to" name="to" type="date" defaultValue={to} />
          </Field>
          <Button type="submit">Run report</Button>
        </form>
      </Card>
      {!res ? (
        <Card>
          <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="Choose a report and date range" />
        </Card>
      ) : !res.ok ? (
        <Alert tone="danger">{res.message ?? "This report could not be run."}</Alert>
      ) : (
        <Card>
          <CardHeader
            title={res.data.title}
            description={`${from} to ${to}${res.data.note ? ` · ${res.data.note}` : ""}`}
            actions={
              canExport ? (
                <Button asChild size="sm" variant="secondary">
                  <a href={`/api/reports/${key}?from=${from}&to=${to}`} download>
                    Export CSV
                  </a>
                </Button>
              ) : (
                <span className="text-[13px] text-muted">Export needs the data export permission.</span>
              )
            }
          />
          {res.data.rows.length === 0 ? (
            <EmptyState title="No data in this period" />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    {res.data.columns.map((c, i) => (
                      <TH
                        key={c}
                        className={typeof res.data.rows[0]?.[i] === "number" ? "text-right" : undefined}
                      >
                        {c}
                      </TH>
                    ))}
                  </tr>
                </THead>
                <tbody>
                  {res.data.rows.map((row, ri) => (
                    <TR key={ri}>
                      {row.map((v, ci) => (
                        <TD
                          key={ci}
                          className={typeof v === "number" ? "text-right tabular-nums" : undefined}
                        >
                          {typeof v === "number" ? v.toLocaleString("en-NG") : v}
                        </TD>
                      ))}
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
      )}
    </>
  );
}
