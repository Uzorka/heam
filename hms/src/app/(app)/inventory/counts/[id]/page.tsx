import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { getCount } from "@/server/domains/inventory/service";
import { formatDateTime } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmAction } from "@/components/forms/action-form";
import { load } from "../../../_lib/guard";
import { approveCountAction } from "../../actions";
import { CountForm } from "./count-form";

export const metadata: Metadata = { title: "Stock count" };

export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await load(ctx, `/inventory/counts/${id}`, () => getCount(ctx, id));
  if (!res.ok) {
    if (res.kind === "notfound") notFound();
    return <Forbidden message={res.message} />;
  }
  const c = res.data;
  const b = c.location.branchId;
  const canApprove =
    c.status === "SUBMITTED" &&
    can(ctx, "inventory.adjust.approve", { branchId: b }) &&
    c.startedById !== ctx.userId &&
    c.submittedById !== ctx.userId;
  const variances = c.lines.filter((l) => l.countedQty !== null && l.countedQty !== l.systemQty);
  return (
    <>
      <Link
        prefetch={false}
        href="/inventory/approvals?tab=counts"
        className="text-[13px] text-muted hover:text-foreground"
      >
        ← Stock counts
      </Link>
      <PageHeader
        title={`Count ${c.ref}`}
        description={`${c.location.name} · started ${formatDateTime(c.startedAt)}${c.notes ? ` · ${c.notes}` : ""}`}
        actions={
          <>
            <Badge
              tone={c.status === "APPROVED" ? "success" : c.status === "SUBMITTED" ? "warning" : "neutral"}
            >
              {c.status.toLowerCase()}
            </Badge>
            {canApprove && (
              <ConfirmAction
                action={approveCountAction}
                fixed={{ countId: c.id }}
                trigger="Approve count"
                triggerVariant="primary"
                title="Approve this count?"
                description={`${variances.length} variance(s) will be posted to the stock ledger.`}
                submitLabel="Approve and post"
                successMessage="Count approved and variances posted."
              />
            )}
          </>
        }
      />
      <Card>
        <CardHeader title={`${c.lines.length} lot(s) at this location`} />
        {c.lines.length === 0 ? (
          <EmptyState title="No stock was on hand when this count started" />
        ) : c.status === "OPEN" && can(ctx, "inventory.count", { branchId: b }) ? (
          <CardBody>
            <CountForm
              countId={c.id}
              lines={c.lines.map((l) => ({
                id: l.id,
                label: l.lot.product.name,
                lotNumber: l.lot.lotNumber,
                unit: l.lot.product.baseUnit,
                systemQty: l.systemQty,
                countedQty: l.countedQty,
                varianceNote: l.varianceNote,
              }))}
            />
          </CardBody>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Item / lot</TH>
                  <TH className="text-right">System</TH>
                  <TH className="text-right">Counted</TH>
                  <TH className="text-right">Variance</TH>
                  <TH>Note</TH>
                </tr>
              </THead>
              <tbody>
                {c.lines.map((l) => {
                  const v = l.countedQty === null ? null : l.countedQty - l.systemQty;
                  return (
                    <TR key={l.id}>
                      <TD>
                        {l.lot.product.name}
                        <span className="block font-mono text-xs text-muted">{l.lot.lotNumber}</span>
                      </TD>
                      <TD className="text-right tabular-nums">{l.systemQty}</TD>
                      <TD className="text-right tabular-nums">{l.countedQty ?? "-"}</TD>
                      <TD className={`text-right tabular-nums ${v ? "font-medium text-danger" : ""}`}>
                        {v === null ? "-" : v > 0 ? `+${v}` : v}
                      </TD>
                      <TD className="text-[13px]">{l.varianceNote}</TD>
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
