import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { getPurchaseOrder } from "@/server/domains/procurement/service";
import { PO_TONE } from "@/lib/inventory-labels";
import { formatDateTime } from "@/lib/time";
import { formatNaira, multiplyKobo, sumKobo } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmAction } from "@/components/forms/action-form";
import { load } from "../../../../_lib/guard";
import { setPurchaseOrderStatusAction } from "../../../actions";
import { ReceiveForm } from "./receive-form";

export const metadata: Metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await load(ctx, `/inventory/procurement/orders/${id}`, () => getPurchaseOrder(ctx, id));
  if (!res.ok) {
    if (res.kind === "notfound") notFound();
    return <Forbidden message={res.message} />;
  }
  const po = res.data;
  const total = sumKobo(po.items.map((i) => multiplyKobo(i.unitCostKobo, i.quantityOrdered)));
  const canManage = can(ctx, "inventory.po.manage", { branchId: po.branchId });
  const canReceive =
    can(ctx, "inventory.receive", { branchId: po.branchId }) &&
    ["ISSUED", "PARTIALLY_RECEIVED"].includes(po.status);
  const locations = canReceive
    ? await prisma.stockLocation.findMany({
        where: { branchId: po.branchId, active: true },
        orderBy: { code: "asc" },
      })
    : [];
  return (
    <>
      <Link
        prefetch={false}
        href="/inventory/procurement?tab=orders"
        className="text-[13px] text-muted hover:text-foreground"
      >
        ← Purchase orders
      </Link>
      <PageHeader
        title={`Purchase order ${po.ref}`}
        description={`${po.supplier.name} · created ${formatDateTime(po.createdAt)}${po.issuedAt ? ` · issued ${formatDateTime(po.issuedAt)}` : ""}`}
        actions={
          <>
            <Badge tone={PO_TONE[po.status]}>{po.status.toLowerCase().replace("_", " ")}</Badge>
            {canManage && po.status === "DRAFT" && (
              <ConfirmAction
                action={setPurchaseOrderStatusAction}
                fixed={{ id: po.id, version: po.version, status: "ISSUED" }}
                trigger="Issue to supplier"
                triggerVariant="primary"
                title="Issue this purchase order?"
                description="Goods can be received against it once issued. Lines can no longer change."
                submitLabel="Issue"
                successMessage="Purchase order issued."
              />
            )}
            {canManage && ["DRAFT", "ISSUED"].includes(po.status) && po.receipts.length === 0 && (
              <ConfirmAction
                action={setPurchaseOrderStatusAction}
                fixed={{ id: po.id, version: po.version, status: "CANCELLED" }}
                trigger="Cancel order"
                triggerVariant="ghost"
                title="Cancel this purchase order?"
                description="This cannot be undone."
                submitLabel="Cancel order"
                tone="danger"
                successMessage="Purchase order cancelled."
              />
            )}
          </>
        }
      />
      <Card className="mb-5">
        <CardHeader
          title="Lines"
          description={`Order value ${formatNaira(total)} (from supplier quotation).`}
        />
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Item</TH>
                <TH className="text-right">Ordered</TH>
                <TH className="text-right">Received</TH>
                <TH className="text-right">Unit cost</TH>
                <TH className="text-right">Line total</TH>
              </tr>
            </THead>
            <tbody>
              {po.items.map((i) => (
                <TR key={i.id}>
                  <TD>
                    {i.product.name}
                    <span className="block font-mono text-xs text-muted">{i.product.sku}</span>
                  </TD>
                  <TD className="text-right tabular-nums">
                    {i.quantityOrdered} <span className="text-xs text-muted">{i.product.baseUnit}</span>
                  </TD>
                  <TD className="text-right tabular-nums">{i.quantityReceived}</TD>
                  <TD className="text-right tabular-nums">{formatNaira(i.unitCostKobo)}</TD>
                  <TD className="text-right tabular-nums">
                    {formatNaira(multiplyKobo(i.unitCostKobo, i.quantityOrdered))}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
      {canReceive && (
        <Card className="mb-5">
          <CardHeader
            title="Receive goods"
            description="Check each item against the delivery. Expired goods are refused."
          />
          <CardBody>
            <ReceiveForm
              purchaseOrderId={po.id}
              locations={locations.map((l) => ({ id: l.id, name: l.name }))}
              items={po.items.map((i) => ({
                id: i.id,
                name: i.product.name,
                unit: i.product.baseUnit,
                outstanding: i.quantityOrdered - i.quantityReceived,
                trackExpiry: i.product.trackExpiry,
              }))}
            />
          </CardBody>
        </Card>
      )}
      {po.receipts.length > 0 && (
        <Card>
          <CardHeader title="Goods received notes" />
          <CardBody>
            <ul className="space-y-1 text-[14px]">
              {po.receipts.map((r) => (
                <li key={r.id}>
                  <span className="font-mono">{r.ref}</span> · {formatDateTime(r.receivedAt)} ·{" "}
                  {r.lines.length} line(s)
                  {r.deliveryNote && ` · ${r.deliveryNote}`}
                  {r.lines.some((l) => l.quarantined) && (
                    <Badge tone="warning" className="ml-1">
                      quarantined lines
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}
