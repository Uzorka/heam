import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { financeOverview } from "@/server/domains/finance/overview";
import { formatNaira } from "@/lib/money";
import { formatDateTime, todayLocal } from "@/lib/time";
import { METHOD_LABEL } from "@/lib/billing-labels";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader, StatTile } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { load } from "../_lib/guard";

export const metadata: Metadata = { title: "Finance overview" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const ctx = await requireAuthContext();
  const sp = await searchParams;
  const today = todayLocal();
  const from = sp.from && DATE.test(sp.from) ? sp.from : `${today.slice(0, 8)}01`;
  const to = sp.to && DATE.test(sp.to) && sp.to >= from ? sp.to : today;
  const res = await load(ctx, "/finance", () => financeOverview(ctx, from, to));
  if (!res.ok) return <Forbidden message={res.message} />;
  const d = res.data;
  const collected = d.collections.reduce((s, c) => s + c.amount, 0n);
  return (
    <>
      <PageHeader
        title="Finance overview"
        description="From the double-entry ledger: revenue is recognised when services are charged; payments and remittances clear receivables."
      />
      <form action="/finance" className="mb-5 flex flex-wrap items-end gap-2">
        <label className="text-[13px]">
          <span className="mb-1 block font-medium">From</span>
          <Input type="date" name="from" defaultValue={from} />
        </label>
        <label className="text-[13px]">
          <span className="mb-1 block font-medium">To</span>
          <Input type="date" name="to" defaultValue={to} />
        </label>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>
      {d.shiftsPending > 0 && (
        <Alert tone="warning" className="mb-4">
          {d.shiftsPending} closed cashier shift(s) await approval.
        </Alert>
      )}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Service revenue (net)"
          value={formatNaira(d.revenue)}
          hint={`Patient ${formatNaira(d.patientShare)} · payers ${formatNaira(d.payerShare)}`}
        />
        <StatTile label="Collected" value={formatNaira(collected)} />
        <StatTile label="Discounts & credit notes" value={formatNaira(d.discounts)} />
        <StatTile label="Payer write-offs" value={formatNaira(d.writeOffs)} />
      </div>
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Collections by method" />
          {d.collections.length === 0 ? (
            <EmptyState title="No payments in this period" />
          ) : (
            <TableWrap>
              <Table>
                <tbody>
                  {d.collections.map((c) => (
                    <TR key={c.method}>
                      <TD>{METHOD_LABEL[c.method]}</TD>
                      <TD className="text-right">{c.count}</TD>
                      <TD className="text-right tabular-nums">{formatNaira(c.amount)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
        <Card>
          <CardHeader title="Balances now" />
          <TableWrap>
            <Table>
              <tbody>
                <TR>
                  <TD>Patients owe</TD>
                  <TD className="text-right tabular-nums">{formatNaira(d.patientReceivable)}</TD>
                </TR>
                <TR>
                  <TD>Patient deposits / credit held</TD>
                  <TD className="text-right tabular-nums">{formatNaira(d.deposits)}</TD>
                </TR>
                {d.payerReceivables.map((p) => (
                  <TR key={p.payer}>
                    <TD>{p.payer} owes</TD>
                    <TD className="text-right tabular-nums">{formatNaira(p.balance)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      </div>
      <Card>
        <CardHeader
          title="Recent postings"
          description="Every posting is balanced and permanent; corrections are new reversing postings."
        />
        {d.recent.length === 0 ? (
          <EmptyState title="No postings in this period" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>When</TH>
                  <TH>Description</TH>
                  <TH className="text-right">Amount</TH>
                </tr>
              </THead>
              <tbody>
                {d.recent.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap text-[13px]">{formatDateTime(e.occurredAt)}</TD>
                    <TD className="text-[13px]">
                      {e.description}
                      <span className="block font-mono text-xs text-muted">
                        {e.sourceType} · {e.kind}
                      </span>
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatNaira(e.lines.reduce((s, l) => s + l.debitKobo, 0n))}
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
