import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { listLocations, productDetail } from "@/server/domains/inventory/service";
import { CATEGORY_LABEL, LOCATION_KIND_LABEL, MOVEMENT_LABEL } from "@/lib/inventory-labels";
import { formatCalendarDate, formatDateTime } from "@/lib/time";
import { formatNaira } from "@/lib/money";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog } from "@/components/forms/action-form";
import { load } from "../../../_lib/guard";
import { lotStatusAction, requestAdjustmentAction, transferAction } from "../../actions";

export const metadata: Metadata = { title: "Stock item" };

const LOT_TONE = { AVAILABLE: "success", QUARANTINED: "warning", RECALLED: "danger" } as const;

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await load(ctx, `/inventory/products/${id}`, async () => ({
    ...(await productDetail(ctx, id)),
    locations: await listLocations(ctx),
  }));
  if (!res.ok) {
    if (res.kind === "notfound") notFound();
    return <Forbidden message={res.message} />;
  }
  const { product, lots, movements, locations, nearLimit } = res.data;
  return (
    <>
      <Link prefetch={false} href="/inventory" className="text-[13px] text-muted hover:text-foreground">
        ← Stock
      </Link>
      <PageHeader
        title={product.name}
        description={
          <>
            <span className="font-mono">{product.sku}</span> · {CATEGORY_LABEL[product.category]} · counted in{" "}
            {product.baseUnit}s · reorder at {product.reorderLevel}
          </>
        }
      />
      <Card className="mb-5">
        <CardHeader
          title="Lots and locations"
          description="Lots are unusable from their expiry date onward."
        />
        {lots.length === 0 ? (
          <EmptyState title="No lots received yet" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Lot</TH>
                  <TH>Expiry</TH>
                  <TH>Status</TH>
                  <TH>Unit cost</TH>
                  <TH>Location balances</TH>
                </tr>
              </THead>
              <tbody>
                {lots.map((l) => {
                  const branchOk = (branchId: string, p: Parameters<typeof can>[1]) =>
                    can(ctx, p, { branchId });
                  return (
                    <TR key={l.id}>
                      <TD>
                        <span className="font-mono">{l.lotNumber}</span>
                        {l.supplier && <span className="block text-xs text-muted">{l.supplier.name}</span>}
                      </TD>
                      <TD className="text-[13px]">
                        {l.expiryDate ? formatCalendarDate(l.expiryDate) : "-"}
                        {l.problem === "expired" && (
                          <Badge tone="danger" className="ml-1">
                            expired
                          </Badge>
                        )}
                        {!l.problem && l.expiryDate && l.expiryDate <= nearLimit && (
                          <Badge tone="warning" className="ml-1">
                            near expiry
                          </Badge>
                        )}
                      </TD>
                      <TD>
                        <Badge tone={LOT_TONE[l.status]}>{l.status.toLowerCase()}</Badge>
                        {l.statusReason && <span className="block text-xs text-muted">{l.statusReason}</span>}
                        <span className="mt-1 block">
                          {l.status !== "RECALLED" && (
                            <ActionDialog
                              action={lotStatusAction}
                              fixed={{ lotId: l.id }}
                              trigger="Change status"
                              triggerVariant="ghost"
                              title={`Lot ${l.lotNumber} status`}
                              description="Quarantine and recall block dispensing everywhere. Releasing from quarantine needs approval rights."
                              submitLabel="Save"
                              successMessage="Lot status updated."
                              fields={[
                                {
                                  name: "status",
                                  label: "New status",
                                  type: "select",
                                  required: true,
                                  options: [
                                    ...(l.status !== "QUARANTINED"
                                      ? [{ value: "QUARANTINED", label: "Quarantined" }]
                                      : []),
                                    { value: "RECALLED", label: "Recalled (permanent)" },
                                    ...(l.status === "QUARANTINED"
                                      ? [{ value: "AVAILABLE", label: "Release (available)" }]
                                      : []),
                                  ],
                                },
                                { name: "reason", label: "Reason", type: "textarea", required: true },
                              ]}
                            />
                          )}
                        </span>
                      </TD>
                      <TD className="text-[13px]">
                        {l.unitCostKobo !== null ? formatNaira(l.unitCostKobo) : "-"}
                      </TD>
                      <TD>
                        {l.balances.filter((b) => b.quantity > 0).length === 0 && (
                          <span className="text-[13px] text-muted">none</span>
                        )}
                        <ul className="space-y-1">
                          {l.balances
                            .filter((b) => b.quantity > 0)
                            .map((b) => (
                              <li
                                key={b.locationId}
                                className="flex flex-wrap items-center gap-2 text-[13px]"
                              >
                                <span>
                                  {b.location.name}:{" "}
                                  <span className="font-medium tabular-nums">{b.quantity}</span>
                                </span>
                                {branchOk(
                                  locations.find((x) => x.id === b.locationId)?.branchId ?? "",
                                  "inventory.transfer",
                                ) && (
                                  <ActionDialog
                                    action={transferAction}
                                    fixed={{
                                      lotId: l.id,
                                      fromLocationId: b.locationId,
                                      idempotencyKey: randomUUID(),
                                    }}
                                    trigger="Transfer"
                                    triggerVariant="ghost"
                                    title={`Transfer lot ${l.lotNumber}`}
                                    description={`From ${b.location.name} (${b.quantity} available).`}
                                    submitLabel="Transfer"
                                    successMessage="Stock transferred."
                                    fields={[
                                      {
                                        name: "toLocationId",
                                        label: "To",
                                        type: "select",
                                        required: true,
                                        options: locations
                                          .filter((x) => x.id !== b.locationId)
                                          .map((x) => ({
                                            value: x.id,
                                            label: `${x.name} (${LOCATION_KIND_LABEL[x.kind]})`,
                                          })),
                                      },
                                      { name: "quantity", label: "Quantity", type: "number", required: true },
                                      { name: "reason", label: "Reason", type: "text" },
                                    ]}
                                  />
                                )}
                                {branchOk(
                                  locations.find((x) => x.id === b.locationId)?.branchId ?? "",
                                  "inventory.adjust",
                                ) && (
                                  <ActionDialog
                                    action={requestAdjustmentAction}
                                    fixed={{ lotId: l.id, locationId: b.locationId }}
                                    trigger="Adjust"
                                    triggerVariant="ghost"
                                    title={`Request an adjustment: lot ${l.lotNumber}`}
                                    description="A second person must approve before stock changes."
                                    submitLabel="Submit for approval"
                                    successMessage="Adjustment submitted for approval."
                                    fields={[
                                      {
                                        name: "quantityDelta",
                                        label: "Change (negative removes stock)",
                                        type: "number",
                                        required: true,
                                      },
                                      {
                                        name: "reason",
                                        label: "Reason",
                                        type: "select",
                                        required: true,
                                        options: [
                                          "DAMAGED",
                                          "EXPIRED",
                                          "LOST",
                                          "RECALLED",
                                          "FOUND",
                                          "OTHER",
                                        ].map((r) => ({
                                          value: r,
                                          label: r.charAt(0) + r.slice(1).toLowerCase(),
                                        })),
                                      },
                                      { name: "notes", label: "Details", type: "textarea", required: true },
                                    ]}
                                  />
                                )}
                              </li>
                            ))}
                        </ul>
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
      <Card>
        <CardHeader
          title="Stock ledger"
          description="Most recent 100 movements. Ledger entries are permanent."
        />
        {movements.length === 0 ? (
          <EmptyState title="No movements yet" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>When</TH>
                  <TH>Movement</TH>
                  <TH>Lot</TH>
                  <TH>Location</TH>
                  <TH className="text-right">Change</TH>
                  <TH className="text-right">Balance after</TH>
                  <TH>By</TH>
                </tr>
              </THead>
              <tbody>
                {movements.map((m) => (
                  <TR key={m.id}>
                    <TD className="whitespace-nowrap text-[13px]">{formatDateTime(m.occurredAt)}</TD>
                    <TD className="text-[13px]">
                      {MOVEMENT_LABEL[m.type] ?? m.type}
                      {m.reason && <span className="block text-xs text-muted">{m.reason}</span>}
                    </TD>
                    <TD className="whitespace-nowrap font-mono text-[13px]">{m.lot.lotNumber}</TD>
                    <TD className="whitespace-nowrap font-mono text-[13px]">{m.location.code}</TD>
                    <TD
                      className={`text-right tabular-nums ${m.quantity < 0 ? "text-danger" : "text-success"}`}
                    >
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </TD>
                    <TD className="text-right tabular-nums">{m.balanceAfter}</TD>
                    <TD className="text-[13px]">{m.performedBy.displayName}</TD>
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
