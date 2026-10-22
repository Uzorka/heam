import type { Metadata } from "next";
import Link from "next/link";
import { Pill } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { pharmacyQueue, pharmacyTabCounts, type PharmacyTab } from "@/server/domains/pharmacy/service";
import { formatDateTime } from "@/lib/time";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { load } from "../_lib/guard";
import { AutoRefresh } from "../queue/auto-refresh";

export const metadata: Metadata = { title: "Pharmacy" };

const TABS: { key: PharmacyTab; label: string }[] = [
  { key: "TO_VERIFY", label: "To verify" },
  { key: "QUERIED", label: "Queried" },
  { key: "TO_DISPENSE", label: "To dispense" },
  { key: "COMPLETED_TODAY", label: "Completed (24 h)" },
];

export default async function PharmacyPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAuthContext();
  if (!ctx.activeBranchId) return <Alert tone="warning">Select a branch.</Alert>;
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "TO_VERIFY";
  const res = await load(ctx, "/pharmacy", async () => ({
    rows: await pharmacyQueue(ctx, tab),
    counts: await pharmacyTabCounts(ctx),
  }));
  if (!res.ok) return <Forbidden message={res.message} />;
  const { rows, counts } = res.data;
  return (
    <>
      <PageHeader
        title="Pharmacy"
        description="Signed prescriptions for this branch, oldest first. Open one to verify, dispense and counsel."
        actions={<AutoRefresh />}
      />
      <LinkTabs
        label="Pharmacy worklist"
        current={tab}
        tabs={TABS.map((t) => ({
          key: t.key,
          label: t.label,
          href: `/pharmacy?tab=${t.key}`,
          count: t.key === "COMPLETED_TODAY" ? undefined : counts[t.key],
        }))}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Pill className="h-5 w-5" />} title="Nothing in this list" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Patient</TH>
                  <TH>Medicines</TH>
                  <TH>Prescriber</TH>
                  <TH>Signed</TH>
                  <TH>
                    <span className="sr-only">Open</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {rows.map((rx) => (
                  <TR key={rx.id}>
                    <TD>
                      <span className="font-medium">
                        {rx.patient.givenName} {rx.patient.familyName}
                      </span>
                      <span className="block font-mono text-[13px] text-muted">{rx.patient.mrn}</span>
                    </TD>
                    <TD className="text-[13px]">
                      {rx.items.map((i, n) => (
                        <span key={n} className="block">
                          {i.medication.genericName} {i.medication.strength}
                          {i.medication.controlled && (
                            <Badge tone="warning" className="ml-1">
                              controlled
                            </Badge>
                          )}
                          {i.status === "CANCELLED" && <span className="text-muted"> (cancelled)</span>}
                        </span>
                      ))}
                    </TD>
                    <TD className="text-[13px]">{rx.prescriber.displayName}</TD>
                    <TD className="whitespace-nowrap text-[13px]">
                      {rx.signedAt ? formatDateTime(rx.signedAt) : ""}
                      <span className="block font-mono text-xs text-muted">{rx.ref}</span>
                    </TD>
                    <TD className="text-right">
                      <Button asChild size="sm" variant="secondary">
                        <Link prefetch={false} href={`/pharmacy/${rx.id}`}>
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
    </>
  );
}
