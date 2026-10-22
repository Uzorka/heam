import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { listServiceItems } from "@/server/domains/billing/catalogue";
import { formatNaira } from "@/lib/money";
import { formatCalendarDate, todayLocal } from "@/lib/time";
import { statusText } from "@/lib/billing-labels";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog, type FieldSpec } from "@/components/forms/action-form";
import { allowed } from "../../_lib/guard";
import { decidePriceAction, proposePriceAction, saveServiceItemAction } from "../actions";

export const metadata: Metadata = { title: "Price list" };

const CATEGORIES = [
  "CONSULTATION",
  "ADMISSION",
  "LABORATORY",
  "IMAGING",
  "PROCEDURE",
  "MATERNITY",
  "CONSUMABLE",
  "PHARMACY",
  "MISCELLANEOUS",
];

export default async function PriceListPage() {
  const ctx = await requireAuthContext();
  if (!(await allowed(ctx, "/billing/catalogue", ["billing.catalogue.manage", "billing.tariff.approve"])))
    return <Forbidden />;
  const manage = can(ctx, "billing.catalogue.manage");
  const approve = can(ctx, "billing.tariff.approve");
  const [items, labTests, studies, visitTypes, products] = await Promise.all([
    listServiceItems({ includeInactive: true }),
    manage
      ? prisma.labTestDefinition.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : [],
    manage
      ? prisma.imagingStudyDefinition.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : [],
    manage
      ? prisma.visitType.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : [],
    manage
      ? prisma.inventoryProduct.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, sku: true },
        })
      : [],
  ]);
  const today = todayLocal();
  const current = (prices: (typeof items)[number]["prices"]) =>
    prices.find(
      (p) =>
        p.status === "APPROVED" &&
        p.effectiveFrom.toISOString().slice(0, 10) <= today &&
        (!p.effectiveTo || p.effectiveTo.toISOString().slice(0, 10) > today),
    );
  const linkFields: FieldSpec[] = [
    {
      name: "labTestId",
      label: "Generate from lab test (optional)",
      type: "select",
      options: labTests.map((t) => ({ value: t.id, label: t.name })),
    },
    {
      name: "imagingStudyId",
      label: "Generate from imaging study (optional)",
      type: "select",
      options: studies.map((t) => ({ value: t.id, label: t.name })),
    },
    {
      name: "visitTypeId",
      label: "Generate at check-in for visit type (optional)",
      type: "select",
      options: visitTypes.map((t) => ({ value: t.id, label: t.name })),
    },
    {
      name: "inventoryProductId",
      label: "Generate when dispensing / issuing (optional)",
      type: "select",
      options: products.map((t) => ({ value: t.id, label: `${t.name} (${t.sku})` })),
    },
  ];
  const drafts = items.flatMap((i) =>
    i.prices.filter((p) => p.status === "DRAFT").map((p) => ({ ...p, item: i })),
  );
  return (
    <>
      <PageHeader
        title="Price list"
        description="Cash prices are effective-dated and approved by someone other than the proposer. Bills always use the price in force on the service date."
        actions={
          manage && (
            <ActionDialog
              action={saveServiceItemAction}
              trigger="Add service"
              triggerVariant="primary"
              title="Add a billable service"
              description="Link it to a clinical item so charges are generated automatically. Prices are proposed separately."
              submitLabel="Save"
              successMessage="Service saved."
              fields={[
                { name: "code", label: "Code", type: "text", required: true, placeholder: "e.g. CONS-GP" },
                { name: "name", label: "Name", type: "text", required: true },
                {
                  name: "category",
                  label: "Category",
                  type: "select",
                  required: true,
                  defaultValue: "MISCELLANEOUS",
                  options: CATEGORIES.map((c) => ({ value: c, label: statusText(c) })),
                },
                ...linkFields,
                { name: "active", label: "Active", type: "checkbox", defaultChecked: true },
              ]}
            />
          )
        }
      />
      {drafts.length > 0 && (
        <Card className="mb-5">
          <CardHeader title={`${drafts.length} proposed price(s) awaiting approval`} />
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Service</TH>
                  <TH className="text-right">Price</TH>
                  <TH>From</TH>
                  <TH>Reason</TH>
                  <TH>
                    <span className="sr-only">Decide</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {drafts.map((p) => (
                  <TR key={p.id}>
                    <TD>{p.item.name}</TD>
                    <TD className="text-right tabular-nums">{formatNaira(p.amountKobo)}</TD>
                    <TD className="text-[13px]">{formatCalendarDate(p.effectiveFrom)}</TD>
                    <TD className="text-[13px]">{p.reason}</TD>
                    <TD className="space-x-1 text-right">
                      {approve && p.createdById !== ctx.userId ? (
                        <>
                          <ActionDialog
                            action={decidePriceAction}
                            fixed={{ id: p.id, decision: "APPROVE" }}
                            trigger="Approve"
                            triggerVariant="primary"
                            title={`Approve ${formatNaira(p.amountKobo)} for ${p.item.name}?`}
                            description="It applies to services on or after the start date; the current price ends the day before."
                            submitLabel="Approve"
                            successMessage="Price approved."
                            fields={[{ name: "note", label: "Note", type: "textarea" }]}
                          />
                          <ActionDialog
                            action={decidePriceAction}
                            fixed={{ id: p.id, decision: "REJECT" }}
                            trigger="Reject"
                            triggerVariant="ghost"
                            title="Reject this price"
                            submitLabel="Reject"
                            tone="danger"
                            successMessage="Price rejected."
                            fields={[{ name: "note", label: "Reason", type: "textarea" }]}
                          />
                        </>
                      ) : (
                        <span className="text-[13px] text-muted">Awaiting another approver</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}
      <Card>
        {items.length === 0 ? (
          <EmptyState title="No services yet">
            Add the hospital&apos;s services and propose their prices. No prices are pre-filled.
          </EmptyState>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Service</TH>
                  <TH>Category</TH>
                  <TH className="text-right">Current price</TH>
                  <TH>Upcoming</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {items.map((i) => {
                  const now = current(i.prices);
                  const next = i.prices.filter(
                    (p) => p.status === "APPROVED" && p.effectiveFrom.toISOString().slice(0, 10) > today,
                  );
                  return (
                    <TR key={i.id}>
                      <TD>
                        <span className="font-medium">{i.name}</span>
                        <span className="block font-mono text-xs text-muted">{i.code}</span>
                        {!i.active && <Badge tone="outline">inactive</Badge>}
                        {(i.labTestId || i.imagingStudyId || i.visitTypeId || i.inventoryProductId) && (
                          <Badge tone="accent">auto-charged</Badge>
                        )}
                      </TD>
                      <TD className="text-[13px]">{statusText(i.category)}</TD>
                      <TD className="text-right tabular-nums">
                        {now ? formatNaira(now.amountKobo) : <span className="text-danger">no price</span>}
                      </TD>
                      <TD className="text-[13px]">
                        {next.map((p) => (
                          <span key={p.id} className="block">
                            {formatNaira(p.amountKobo)} from {formatCalendarDate(p.effectiveFrom)}
                          </span>
                        ))}
                      </TD>
                      <TD className="text-right">
                        {manage && (
                          <ActionDialog
                            action={proposePriceAction}
                            fixed={{ serviceItemId: i.id }}
                            trigger="Propose price"
                            triggerVariant="ghost"
                            title={`New price for ${i.name}`}
                            description="Record where the figure comes from (board decision, tariff review). It takes effect only after approval."
                            submitLabel="Propose"
                            successMessage="Price proposed for approval."
                            fields={[
                              { name: "amountKobo", label: "Price", type: "money", required: true },
                              {
                                name: "effectiveFrom",
                                label: "Effective from",
                                type: "date",
                                required: true,
                                defaultValue: today,
                              },
                              { name: "reason", label: "Reason / source", type: "textarea", required: true },
                            ]}
                          />
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
      {!approve && manage && (
        <Alert tone="info" className="mt-4">
          Prices you propose are approved by the owner / authorised executive.
        </Alert>
      )}
    </>
  );
}
