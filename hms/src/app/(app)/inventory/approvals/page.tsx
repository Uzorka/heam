import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { listAdjustments, listCounts, listLocations } from "@/server/domains/inventory/service";
import { formatDateTime } from "@/lib/time";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog } from "@/components/forms/action-form";
import { allowed, load } from "../../_lib/guard";
import { decideAdjustmentAction, startCountAction } from "../actions";

export const metadata: Metadata = { title: "Stock approvals" };
const TABS = ["adjustments", "history", "counts"] as const;
const COUNT_TONE = {
  OPEN: "neutral",
  SUBMITTED: "warning",
  APPROVED: "success",
  CANCELLED: "outline",
} as const;

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAuthContext();
  if (
    !(await allowed(ctx, "/inventory/approvals", [
      "inventory.adjust",
      "inventory.adjust.approve",
      "inventory.count",
    ]))
  )
    return <Forbidden />;
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as (typeof TABS)[number])
    : "adjustments";
  const res = await load(ctx, "/inventory/approvals", async () => ({
    adjustments:
      tab === "counts" ? [] : await listAdjustments(ctx, tab === "history" ? "DECIDED" : "PENDING"),
    counts: tab === "counts" ? await listCounts(ctx) : [],
    locations: tab === "counts" ? await listLocations(ctx) : [],
  }));
  if (!res.ok) return <Forbidden message={res.message} />;
  const { adjustments, counts, locations } = res.data;
  const countable = locations.filter((l) => can(ctx, "inventory.count", { branchId: l.branchId }));
  return (
    <>
      <PageHeader
        title="Stock approvals"
        description="Adjustments and count variances change stock only after someone other than the requester approves them."
      />
      <LinkTabs
        label="Approval sections"
        current={tab}
        tabs={[
          { key: "adjustments", label: "Pending adjustments", href: "/inventory/approvals" },
          { key: "history", label: "Decided adjustments", href: "/inventory/approvals?tab=history" },
          { key: "counts", label: "Stock counts", href: "/inventory/approvals?tab=counts" },
        ]}
      />
      {tab !== "counts" && (
        <Card>
          {adjustments.length === 0 ? (
            <EmptyState title="Nothing here" />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Item / lot</TH>
                    <TH>Location</TH>
                    <TH className="text-right">Change</TH>
                    <TH>Reason</TH>
                    <TH>Requested</TH>
                    <TH>{tab === "history" ? "Decision" : <span className="sr-only">Actions</span>}</TH>
                  </tr>
                </THead>
                <tbody>
                  {adjustments.map((a) => (
                    <TR key={a.id}>
                      <TD>
                        {a.lot.product.name}
                        <span className="block font-mono text-xs text-muted">{a.lot.lotNumber}</span>
                      </TD>
                      <TD className="text-[13px]">{a.location.name}</TD>
                      <TD
                        className={`text-right tabular-nums ${a.quantityDelta < 0 ? "text-danger" : "text-success"}`}
                      >
                        {a.quantityDelta > 0 ? `+${a.quantityDelta}` : a.quantityDelta}
                      </TD>
                      <TD className="text-[13px]">
                        {a.reason.toLowerCase()}
                        <span className="block text-muted">{a.notes}</span>
                      </TD>
                      <TD className="text-[13px]">
                        {a.requestedBy}
                        <span className="block text-muted">{formatDateTime(a.requestedAt)}</span>
                      </TD>
                      <TD className="space-x-1 text-right">
                        {tab === "history" ? (
                          <span className="text-[13px]">
                            <Badge tone={a.status === "APPROVED" ? "success" : "outline"}>
                              {a.status.toLowerCase()}
                            </Badge>
                            <span className="block text-muted">{a.decidedBy}</span>
                          </span>
                        ) : (
                          a.requestedById !== ctx.userId &&
                          can(ctx, "inventory.adjust.approve", { branchId: a.location.branchId }) && (
                            <>
                              <ActionDialog
                                action={decideAdjustmentAction}
                                fixed={{ id: a.id, decision: "APPROVE" }}
                                trigger="Approve"
                                triggerVariant="primary"
                                title="Approve adjustment"
                                description="Stock changes immediately and is recorded in the ledger."
                                submitLabel="Approve"
                                successMessage="Adjustment approved and posted."
                                fields={[{ name: "notes", label: "Notes", type: "textarea" }]}
                              />
                              <ActionDialog
                                action={decideAdjustmentAction}
                                fixed={{ id: a.id, decision: "REJECT" }}
                                trigger="Reject"
                                triggerVariant="ghost"
                                title="Reject adjustment"
                                submitLabel="Reject"
                                tone="danger"
                                successMessage="Adjustment rejected."
                                fields={[{ name: "notes", label: "Reason", type: "textarea" }]}
                              />
                            </>
                          )
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
      {tab === "counts" && (
        <Card>
          <CardHeader
            title="Stock counts"
            description="Starting a count snapshots system quantities. Counted figures should reflect that moment."
            actions={
              countable.length > 0 && (
                <ActionDialog
                  action={startCountAction}
                  trigger="Start a count"
                  triggerVariant="primary"
                  title="Start a stock count"
                  submitLabel="Start count"
                  successMessage="Count started."
                  fields={[
                    {
                      name: "locationId",
                      label: "Location",
                      type: "select",
                      required: true,
                      options: countable.map((l) => ({ value: l.id, label: `${l.name} (${l.branch.name})` })),
                    },
                    { name: "notes", label: "Notes", type: "textarea" },
                  ]}
                />
              )
            }
          />
          {counts.length === 0 ? (
            <EmptyState title="No counts yet" />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Ref</TH>
                    <TH>Location</TH>
                    <TH>Lines</TH>
                    <TH>Started</TH>
                    <TH>Status</TH>
                    <TH>
                      <span className="sr-only">Open</span>
                    </TH>
                  </tr>
                </THead>
                <tbody>
                  {counts.map((c) => (
                    <TR key={c.id}>
                      <TD className="font-mono text-[13px]">{c.ref}</TD>
                      <TD>{c.location.name}</TD>
                      <TD>{c._count.lines}</TD>
                      <TD className="text-[13px]">{formatDateTime(c.startedAt)}</TD>
                      <TD>
                        <Badge tone={COUNT_TONE[c.status]}>{c.status.toLowerCase()}</Badge>
                      </TD>
                      <TD className="text-right">
                        <Button asChild size="sm" variant="secondary">
                          <Link prefetch={false} href={`/inventory/counts/${c.id}`}>
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
      )}
    </>
  );
}
