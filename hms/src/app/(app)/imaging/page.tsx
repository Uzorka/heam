import type { Metadata } from "next";
import Link from "next/link";
import { ScanLine } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { imagingWorklist, type ImagingTab } from "@/server/domains/imaging/service";
import { formatAge, formatDateTime } from "@/lib/time";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { load } from "../_lib/guard";

export const metadata: Metadata = { title: "Imaging" };
const TABS: { key: ImagingTab; label: string }[] = [
  { key: "TO_SCHEDULE", label: "Requested" },
  { key: "SCHEDULED", label: "Scheduled" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "TO_SIGN", label: "Reports to sign" },
  { key: "SIGNED_TODAY", label: "Signed (24 h)" },
];

export default async function ImagingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAuthContext();
  if (!ctx.activeBranchId) return <Alert tone="warning">Select a branch.</Alert>;
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "TO_SCHEDULE";
  const res = await load(ctx, "/imaging", () => imagingWorklist(ctx, tab));
  if (!res.ok) return <Forbidden message={res.message} />;
  return (
    <>
      <PageHeader
        title="Imaging"
        description="PACS/DICOM integration is not connected; attach exported images or reports as files."
      />
      <LinkTabs
        label="Imaging worklist"
        current={tab}
        tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/imaging?tab=${t.key}` }))}
      />
      <Card>
        {res.data.length === 0 ? (
          <EmptyState icon={<ScanLine className="h-5 w-5" />} title="Nothing in this list" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Priority</TH>
                  <TH>Patient</TH>
                  <TH>Study</TH>
                  <TH>Requested</TH>
                  <TH>Scheduled</TH>
                  <TH>
                    <span className="sr-only">Open</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {res.data.map((o) => (
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
                      {o.imagingStudy?.name}
                      <span className="block font-mono text-xs text-muted">{o.ref}</span>
                    </TD>
                    <TD className="whitespace-nowrap text-[13px]">
                      {formatDateTime(o.orderedAt)}
                      <span className="block text-muted">{o.orderedBy.displayName}</span>
                    </TD>
                    <TD className="whitespace-nowrap text-[13px]">
                      {o.scheduledAt ? formatDateTime(o.scheduledAt) : "-"}
                    </TD>
                    <TD className="text-right">
                      <Button asChild size="sm" variant="secondary">
                        <Link prefetch={false} href={`/imaging/${o.id}`}>
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
