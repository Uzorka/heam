import type { Metadata } from "next";
import Link from "next/link";
import { Package } from "lucide-react";
import type { InventoryCategory } from "@prisma/client";
import { CATEGORY_LABEL } from "@/lib/inventory-labels";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { listLocations, stockOverview } from "@/server/domains/inventory/service";
import { formatCalendarDate } from "@/lib/time";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog } from "@/components/forms/action-form";
import { load } from "../_lib/guard";
import { createLocationAction, saveProductAction } from "./actions";

export const metadata: Metadata = { title: "Stock" };

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; location?: string; category?: string }>;
}) {
  const ctx = await requireAuthContext();
  const sp = await searchParams;
  const filter = sp.filter === "low" || sp.filter === "expiring" ? sp.filter : undefined;
  const category = (Object.keys(CATEGORY_LABEL) as InventoryCategory[]).find((c) => c === sp.category);
  const res = await load(ctx, "/inventory", async () => {
    const locations = await listLocations(ctx);
    const locationId = locations.find((l) => l.id === sp.location)?.id;
    return {
      locations,
      locationId,
      rows: await stockOverview(ctx, { filter, q: sp.q?.trim() || undefined, locationId, category }),
    };
  });
  if (!res.ok) return <Forbidden message={res.message} />;
  const { rows, locations, locationId } = res.data;
  const qs = (f?: string) => {
    const p = new URLSearchParams();
    if (f) p.set("filter", f);
    if (sp.q) p.set("q", sp.q);
    if (locationId) p.set("location", locationId);
    if (category) p.set("category", category);
    const s = p.toString();
    return `/inventory${s ? `?${s}` : ""}`;
  };
  return (
    <>
      <PageHeader
        title="Stock"
        description="Usable stock excludes expired, quarantined and recalled lots. Every change is recorded in the stock ledger."
        actions={
          <>
            {can(ctx, "inventory.po.manage") && (
              <ActionDialog
                action={saveProductAction}
                trigger="Add stock item"
                triggerVariant="primary"
                title="Add a non-medicine stock item"
                description="Medicines are added in the medication catalogue so they can be prescribed."
                submitLabel="Save"
                successMessage="Stock item saved."
                fields={[
                  { name: "name", label: "Name", type: "text", required: true },
                  { name: "sku", label: "Stock code (SKU)", type: "text", required: true },
                  {
                    name: "category",
                    label: "Category",
                    type: "select",
                    required: true,
                    defaultValue: "MEDICAL_SUPPLY",
                    options: (Object.keys(CATEGORY_LABEL) as InventoryCategory[])
                      .filter((c) => c !== "PHARMACY")
                      .map((c) => ({ value: c, label: CATEGORY_LABEL[c] })),
                  },
                  {
                    name: "baseUnit",
                    label: "Unit",
                    type: "text",
                    required: true,
                    placeholder: "e.g. piece, box, pack",
                  },
                  { name: "reorderLevel", label: "Reorder level", type: "number", defaultValue: "0" },
                  { name: "reorderQuantity", label: "Reorder quantity", type: "number", defaultValue: "0" },
                  {
                    name: "trackExpiry",
                    label: "Track expiry dates",
                    type: "checkbox",
                    defaultChecked: true,
                  },
                  { name: "active", label: "Active", type: "checkbox", defaultChecked: true },
                ]}
              />
            )}
            {ctx.activeBranchId && can(ctx, "settings.manage", { branchId: ctx.activeBranchId }) && (
              <ActionDialog
                action={createLocationAction}
                fixed={{ branchId: ctx.activeBranchId }}
                trigger="Add location"
                title="Add a stock location in this branch"
                submitLabel="Save"
                successMessage="Location added."
                fields={[
                  {
                    name: "code",
                    label: "Code",
                    type: "text",
                    required: true,
                    placeholder: "e.g. PHARM-OPD",
                  },
                  { name: "name", label: "Name", type: "text", required: true },
                  {
                    name: "kind",
                    label: "Kind",
                    type: "select",
                    required: true,
                    defaultValue: "MAIN_STORE",
                    options: [
                      { value: "MAIN_STORE", label: "Main store" },
                      { value: "PHARMACY", label: "Pharmacy (dispensing)" },
                      { value: "WARD", label: "Ward" },
                      { value: "LABORATORY", label: "Laboratory" },
                      { value: "THEATRE", label: "Theatre" },
                      { value: "QUARANTINE", label: "Quarantine" },
                    ],
                  },
                ]}
              />
            )}
          </>
        }
      />
      <LinkTabs
        label="Stock filter"
        current={filter ?? "all"}
        tabs={[
          { key: "all", label: "All items", href: qs() },
          { key: "low", label: "At or below reorder level", href: qs("low") },
          { key: "expiring", label: "Expiring or unusable", href: qs("expiring") },
        ]}
      />
      <form className="mb-4 flex flex-wrap items-end gap-2" action="/inventory">
        {filter && <input type="hidden" name="filter" value={filter} />}
        <label className="text-[13px]">
          <span className="mb-1 block font-medium">Search</span>
          <Input name="q" defaultValue={sp.q} placeholder="Name or SKU" className="w-56" />
        </label>
        <label className="text-[13px]">
          <span className="mb-1 block font-medium">Location</span>
          <Select name="location" defaultValue={locationId ?? ""} className="w-56">
            <option value="">All my locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.branch.name})
              </option>
            ))}
          </Select>
        </label>
        <label className="text-[13px]">
          <span className="mb-1 block font-medium">Category</span>
          <Select name="category" defaultValue={category ?? ""} className="w-48">
            <option value="">All categories</option>
            {(Object.keys(CATEGORY_LABEL) as InventoryCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>
      <Card>
        <CardHeader title={`${rows.length} item${rows.length === 1 ? "" : "s"}`} />
        {rows.length === 0 ? (
          <EmptyState icon={<Package className="h-5 w-5" />} title="No stock items match" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Item</TH>
                  <TH className="hidden sm:table-cell">Category</TH>
                  <TH className="text-right">Usable</TH>
                  <TH className="text-right">Reorder at</TH>
                  <TH>Nearest expiry</TH>
                  <TH>Alerts</TH>
                </tr>
              </THead>
              <tbody>
                {rows.map((r) => (
                  <TR key={r.productId}>
                    <TD>
                      <Link
                        prefetch={false}
                        href={`/inventory/products/${r.productId}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {r.name}
                      </Link>
                      <span className="block font-mono text-xs text-muted">{r.sku}</span>
                    </TD>
                    <TD className="hidden text-[13px] sm:table-cell">{CATEGORY_LABEL[r.category]}</TD>
                    <TD className="text-right tabular-nums">
                      {r.usable} <span className="text-xs text-muted">{r.baseUnit}</span>
                    </TD>
                    <TD className="text-right tabular-nums">{r.reorderLevel}</TD>
                    <TD className="text-[13px]">
                      {r.nearestExpiry ? formatCalendarDate(r.nearestExpiry) : "-"}
                    </TD>
                    <TD className="space-x-1">
                      {r.lowStock && <Badge tone="warning">Reorder</Badge>}
                      {r.nearExpiryQty > 0 && <Badge tone="warning">{r.nearExpiryQty} near expiry</Badge>}
                      {r.unusable > 0 && <Badge tone="danger">{r.unusable} unusable</Badge>}
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
