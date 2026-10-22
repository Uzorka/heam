import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthContext } from "@/server/auth/session";
import { can, canAny } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { listPurchaseOrders, listRequisitions, listSuppliers } from "@/server/domains/procurement/service";
import { formatDateTime } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { PO_TONE } from "@/lib/inventory-labels";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog, type FieldSpec } from "@/components/forms/action-form";
import { allowed, load } from "../../_lib/guard";
import { decideRequisitionAction, saveSupplierAction } from "../actions";
import { LineItemsForm } from "./line-items-form";

export const metadata: Metadata = { title: "Procurement" };
const TABS = ["requisitions", "orders", "suppliers"] as const;
const REQ_TONE = {
  SUBMITTED: "warning",
  APPROVED: "accent",
  REJECTED: "outline",
  ORDERED: "success",
  CANCELLED: "outline",
} as const;

function supplierFields(s?: {
  name: string;
  contactName: string | null;
  phoneE164: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
}): FieldSpec[] {
  return [
    { name: "name", label: "Supplier name", type: "text", required: true, defaultValue: s?.name },
    { name: "contactName", label: "Contact person", type: "text", defaultValue: s?.contactName ?? undefined },
    { name: "phone", label: "Phone", type: "tel", defaultValue: s?.phoneE164 ?? undefined },
    { name: "email", label: "Email", type: "email", defaultValue: s?.email ?? undefined },
    { name: "address", label: "Address", type: "textarea", defaultValue: s?.address ?? undefined },
    { name: "active", label: "Active", type: "checkbox", defaultChecked: s?.active ?? true },
  ];
}

export default async function ProcurementPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string }>;
}) {
  const ctx = await requireAuthContext();
  const any = [
    "inventory.requisition.create",
    "inventory.requisition.approve",
    "inventory.po.manage",
    "inventory.receive",
  ] as const;
  if (!(await allowed(ctx, "/inventory/procurement", [...any]))) return <Forbidden />;
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as (typeof TABS)[number])
    : "requisitions";
  const branchId = ctx.activeBranchId;
  if (!branchId) return <Alert tone="warning">Select a branch.</Alert>;
  const res = await load(ctx, "/inventory/procurement", async () => ({
    requisitions: tab === "requisitions" || sp.from ? await listRequisitions(ctx) : [],
    orders: tab === "orders" ? await listPurchaseOrders(ctx) : [],
    suppliers: await listSuppliers(ctx),
    products: await prisma.inventoryProduct.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  }));
  if (!res.ok) return <Forbidden message={res.message} />;
  const { requisitions, orders, suppliers, products } = res.data;
  const productOptions = products.map((p) => ({ id: p.id, label: `${p.name} (${p.sku})`, unit: p.baseUnit }));
  const fromReq = sp.from ? requisitions.find((r) => r.id === sp.from && r.status === "APPROVED") : undefined;
  const managePo = can(ctx, "inventory.po.manage", { branchId });

  return (
    <>
      <PageHeader
        title="Procurement"
        description="Requisition → approval by a second person → purchase order → goods received into stock. Prices come from supplier quotations entered by staff."
      />
      <LinkTabs
        label="Procurement sections"
        current={tab}
        tabs={[
          { key: "requisitions", label: "Requisitions", href: "/inventory/procurement" },
          { key: "orders", label: "Purchase orders", href: "/inventory/procurement?tab=orders" },
          { key: "suppliers", label: "Suppliers", href: "/inventory/procurement?tab=suppliers" },
        ]}
      />

      {tab === "requisitions" && (
        <div className="space-y-5">
          {can(ctx, "inventory.requisition.create", { branchId }) && (
            <Card>
              <CardHeader title="New requisition" />
              <CardBody>
                <LineItemsForm mode="requisition" branchId={branchId} products={productOptions} />
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Requisitions" />
            {requisitions.length === 0 ? (
              <EmptyState title="No requisitions" />
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <tr>
                      <TH>Ref</TH>
                      <TH>Items</TH>
                      <TH>Requested</TH>
                      <TH>Status</TH>
                      <TH>
                        <span className="sr-only">Actions</span>
                      </TH>
                    </tr>
                  </THead>
                  <tbody>
                    {requisitions.map((r) => (
                      <TR key={r.id}>
                        <TD className="font-mono text-[13px]">{r.ref}</TD>
                        <TD className="text-[13px]">
                          {r.items.map((i) => (
                            <span key={i.id} className="block">
                              {i.quantity} {i.product.baseUnit} · {i.product.name}
                            </span>
                          ))}
                          <span className="block text-muted">{r.justification}</span>
                        </TD>
                        <TD className="text-[13px]">
                          {r.requestedBy}
                          <span className="block text-muted">{formatDateTime(r.requestedAt)}</span>
                        </TD>
                        <TD>
                          <Badge tone={REQ_TONE[r.status]}>{r.status.toLowerCase()}</Badge>
                          {r.decidedBy && <span className="block text-xs text-muted">by {r.decidedBy}</span>}
                          {r.decisionNotes && (
                            <span className="block text-xs text-muted">{r.decisionNotes}</span>
                          )}
                        </TD>
                        <TD className="space-x-1 text-right">
                          {r.status === "SUBMITTED" &&
                            r.requestedById !== ctx.userId &&
                            can(ctx, "inventory.requisition.approve", { branchId: r.branchId }) && (
                              <>
                                <ActionDialog
                                  action={decideRequisitionAction}
                                  fixed={{ id: r.id, decision: "APPROVE" }}
                                  trigger="Approve"
                                  triggerVariant="primary"
                                  title={`Approve ${r.ref}?`}
                                  submitLabel="Approve"
                                  successMessage="Requisition approved."
                                  fields={[{ name: "notes", label: "Notes", type: "textarea" }]}
                                />
                                <ActionDialog
                                  action={decideRequisitionAction}
                                  fixed={{ id: r.id, decision: "REJECT" }}
                                  trigger="Reject"
                                  triggerVariant="ghost"
                                  title={`Reject ${r.ref}?`}
                                  submitLabel="Reject"
                                  tone="danger"
                                  successMessage="Requisition rejected."
                                  fields={[{ name: "notes", label: "Reason", type: "textarea" }]}
                                />
                              </>
                            )}
                          {r.status === "APPROVED" &&
                            can(ctx, "inventory.po.manage", { branchId: r.branchId }) && (
                              <Button asChild size="sm" variant="secondary">
                                <Link
                                  prefetch={false}
                                  href={`/inventory/procurement?tab=orders&from=${r.id}`}
                                >
                                  Create order
                                </Link>
                              </Button>
                            )}
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </Card>
        </div>
      )}

      {tab === "orders" && (
        <div className="space-y-5">
          {managePo && (
            <Card>
              <CardHeader
                title={fromReq ? `New purchase order from ${fromReq.ref}` : "New purchase order"}
                description="Orders start as drafts; issue them once checked."
              />
              <CardBody>
                {suppliers.filter((s) => s.active).length === 0 ? (
                  <Alert tone="info">Add a supplier first.</Alert>
                ) : (
                  <LineItemsForm
                    key={fromReq?.id ?? "direct"}
                    mode="order"
                    branchId={branchId}
                    products={productOptions}
                    suppliers={suppliers.filter((s) => s.active)}
                    requisitionId={fromReq?.id}
                    initial={
                      fromReq?.items.map((i) => ({ productId: i.productId, quantity: i.quantity })) ?? []
                    }
                  />
                )}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Purchase orders" />
            {orders.length === 0 ? (
              <EmptyState title="No purchase orders" />
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <tr>
                      <TH>Ref</TH>
                      <TH>Supplier</TH>
                      <TH>Lines</TH>
                      <TH>Created</TH>
                      <TH>Status</TH>
                      <TH>
                        <span className="sr-only">Open</span>
                      </TH>
                    </tr>
                  </THead>
                  <tbody>
                    {orders.map((o) => (
                      <TR key={o.id}>
                        <TD className="font-mono text-[13px]">{o.ref}</TD>
                        <TD>{o.supplier.name}</TD>
                        <TD>{o._count.items}</TD>
                        <TD className="text-[13px]">{formatDateTime(o.createdAt)}</TD>
                        <TD>
                          <Badge tone={PO_TONE[o.status]}>{o.status.toLowerCase().replace("_", " ")}</Badge>
                        </TD>
                        <TD className="text-right">
                          <Button asChild size="sm" variant="secondary">
                            <Link prefetch={false} href={`/inventory/procurement/orders/${o.id}`}>
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
        </div>
      )}

      {tab === "suppliers" && (
        <Card>
          <CardHeader
            title="Suppliers"
            description="Record only suppliers the hospital actually uses; details are entered by staff, not imported."
            actions={
              managePo && (
                <ActionDialog
                  action={saveSupplierAction}
                  trigger="Add supplier"
                  triggerVariant="primary"
                  title="Add supplier"
                  submitLabel="Save"
                  successMessage="Supplier saved."
                  fields={supplierFields()}
                />
              )
            }
          />
          {suppliers.length === 0 ? (
            <EmptyState title="No suppliers" />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Name</TH>
                    <TH>Contact</TH>
                    <TH>Status</TH>
                    <TH>
                      <span className="sr-only">Edit</span>
                    </TH>
                  </tr>
                </THead>
                <tbody>
                  {suppliers.map((s) => (
                    <TR key={s.id}>
                      <TD className="font-medium">{s.name}</TD>
                      <TD className="text-[13px]">
                        {s.contactName}
                        {s.phoneE164 && <span className="block">{formatPhone(s.phoneE164)}</span>}
                        {s.email && <span className="block">{s.email}</span>}
                      </TD>
                      <TD>
                        <Badge tone={s.active ? "success" : "outline"}>
                          {s.active ? "active" : "inactive"}
                        </Badge>
                      </TD>
                      <TD className="text-right">
                        {managePo && (
                          <ActionDialog
                            action={saveSupplierAction}
                            fixed={{ id: s.id }}
                            trigger="Edit"
                            triggerVariant="ghost"
                            title={`Edit ${s.name}`}
                            submitLabel="Save"
                            successMessage="Supplier updated."
                            fields={supplierFields(s)}
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
      )}
      {!canAny(ctx, ["inventory.po.manage", "inventory.requisition.create"]) && (
        <p className="mt-4 text-[13px] text-muted">You can view procurement records but not create them.</p>
      )}
    </>
  );
}
