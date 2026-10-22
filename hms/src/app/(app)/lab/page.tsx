import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { labTabCounts, labWorklist, type LabTab } from "@/server/domains/lab/service";
import { formatAge, formatDateTime } from "@/lib/time";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { load } from "../_lib/guard";
import { AutoRefresh } from "../queue/auto-refresh";

export const metadata: Metadata = { title: "Laboratory" };

const TABS: { key: LabTab; label: string; status: string }[] = [
  { key: "TO_COLLECT", label: "To collect", status: "ORDERED" },
  { key: "TO_RECEIVE", label: "To receive", status: "SPECIMEN_COLLECTED" },
  { key: "IN_PROGRESS", label: "In progress", status: "IN_PROGRESS" },
  { key: "TO_VERIFY", label: "To verify", status: "RESULTED" },
  { key: "VERIFIED_TODAY", label: "Verified (24 h)", status: "VERIFIED" },
];

function overdue(orderedAt: Date, tat: number | null) {
  return tat !== null && Date.now() - orderedAt.getTime() > tat * 3_600_000;
}

export default async function LabPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAuthContext();
  if (!ctx.activeBranchId) return <Alert tone="warning">Select a branch.</Alert>;
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "TO_COLLECT";
  const res = await load(ctx, "/lab", async () => ({
    rows: await labWorklist(ctx, tab),
    counts: await labTabCounts(ctx),
  }));
  if (!res.ok) return <Forbidden message={res.message} />;
  const { rows, counts } = res.data;
  return (
    <>
      <PageHeader
        title="Laboratory"
        description="STAT and urgent requests are listed first. Patient charts are not shown here - only what the lab needs."
        actions={<AutoRefresh />}
      />
      <LinkTabs
        label="Lab worklist"
        current={tab}
        tabs={TABS.map((t) => ({
          key: t.key,
          label: t.label,
          href: `/lab?tab=${t.key}`,
          count: t.key === "VERIFIED_TODAY" ? undefined : (counts[t.status] ?? 0),
        }))}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<FlaskConical className="h-5 w-5" />} title="Nothing in this list" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Priority</TH>
                  <TH>Patient</TH>
                  <TH>Test</TH>
                  <TH>Ordered</TH>
                  <TH>Specimen</TH>
                  <TH>
                    <span className="sr-only">Open</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {rows.map((o) => (
                  <TR key={o.id}>
                    <TD>
                      <Badge
                        tone={
                          o.priority === "STAT" ? "danger" : o.priority === "URGENT" ? "warning" : "neutral"
                        }
                      >
                        {o.priority.toLowerCase()}
                      </Badge>
                    </TD>
                    <TD>
                      <span className="font-medium">
                        {o.patient.givenName} {o.patient.familyName}
                      </span>
                      <span className="block text-[13px] text-muted">
                        <span className="font-mono">{o.patient.mrn}</span> ·{" "}
                        {o.patient.dateOfBirth ? formatAge(o.patient.dateOfBirth) : "age ?"} ·{" "}
                        {o.patient.sexAtBirth.toLowerCase()}
                      </span>
                    </TD>
                    <TD>
                      {o.labTest?.name}
                      <span className="block font-mono text-xs text-muted">{o.ref}</span>
                    </TD>
                    <TD className="whitespace-nowrap text-[13px]">
                      {formatDateTime(o.orderedAt)}
                      <span className="block text-muted">{o.orderedBy.displayName}</span>
                      {o.status !== "VERIFIED" &&
                        overdue(o.orderedAt, o.labTest?.turnaroundHours ?? null) && (
                          <Badge tone="warning">Past turnaround</Badge>
                        )}
                    </TD>
                    <TD className="text-[13px]">
                      {o.specimens[0] ? (
                        <>
                          <span className="font-mono">{o.specimens[0].accession}</span>
                          <span className="block text-muted">{o.specimens[0].status.toLowerCase()}</span>
                        </>
                      ) : (
                        <span className="text-muted">{o.labTest?.specimenType}</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      <Button asChild size="sm" variant="secondary">
                        <Link prefetch={false} href={`/lab/${o.id}`}>
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
