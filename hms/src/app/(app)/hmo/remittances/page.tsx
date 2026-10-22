import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { listRemittances } from "@/server/domains/hmo/claims";
import { formatNaira } from "@/lib/money";
import { formatCalendarDate, formatDateTime, todayLocal } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { allowed, load } from "../../_lib/guard";
import { RemittanceForm } from "./remittance-form";

export const metadata: Metadata = { title: "Remittances" };

export default async function RemittancesPage() {
  const ctx = await requireAuthContext();
  if (!(await allowed(ctx, "/hmo/remittances", ["hmo.remittance.reconcile"]))) return <Forbidden />;
  const res = await load(ctx, "/hmo/remittances", () => listRemittances(ctx));
  if (!res.ok) return <Forbidden message={res.message} />;
  const payers = await prisma.payer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <>
      <PageHeader
        title="Remittances"
        description="Record each payment advice once. Amounts are matched to claims line by line; over-payments and repeated advices are refused."
      />
      {can(ctx, "hmo.remittance.reconcile") && (
        <Card className="mb-5">
          <CardHeader title="Record a payment advice" />
          <CardBody>
            <RemittanceForm payers={payers} today={todayLocal()} />
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Recorded" />
        {res.data.length === 0 ? (
          <EmptyState title="None yet" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Ref</TH>
                  <TH>Payer</TH>
                  <TH>Payer reference</TH>
                  <TH>Received</TH>
                  <TH className="text-right">Total</TH>
                  <TH className="text-right">Claims</TH>
                </tr>
              </THead>
              <tbody>
                {res.data.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-mono text-[13px]">{r.ref}</TD>
                    <TD>{r.payer.name}</TD>
                    <TD className="text-[13px]">{r.payerReference}</TD>
                    <TD className="text-[13px]">
                      {formatCalendarDate(r.receivedDate)}
                      <span className="block text-muted">recorded {formatDateTime(r.importedAt)}</span>
                    </TD>
                    <TD className="text-right tabular-nums">{formatNaira(r.totalKobo)}</TD>
                    <TD className="text-right">{r._count.lines}</TD>
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
