import type { Metadata } from "next";
import Link from "next/link";
import { Baby } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { maternityBoard } from "@/server/domains/maternity/service";
import { formatCalendarDate } from "@/lib/time";
import { formatGestation } from "@/lib/obstetrics";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { load } from "../_lib/guard";

export const metadata: Metadata = { title: "Maternity" };

export default async function MaternityPage() {
  const ctx = await requireAuthContext();
  if (!ctx.activeBranchId) return <Alert tone="warning">Select a branch.</Alert>;
  const res = await load(ctx, "/maternity", () => maternityBoard(ctx));
  if (!res.ok) return <Forbidden message={res.message} />;
  return (
    <>
      <PageHeader
        title="Maternity"
        description="Active pregnancies in this branch, nearest due date first. Open a pregnancy from the patient's Maternity tab."
      />
      <Card>
        {res.data.length === 0 ? (
          <EmptyState icon={<Baby className="h-5 w-5" />} title="No active pregnancies" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Mother</TH>
                  <TH>G/P</TH>
                  <TH>EDD</TH>
                  <TH>Gestation today</TH>
                  <TH>Last ANC</TH>
                  <TH>
                    <span className="sr-only">Open</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {res.data.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      {r.patient.givenName} {r.patient.familyName}
                      <span className="block font-mono text-[13px] text-muted">{r.patient.mrn}</span>
                    </TD>
                    <TD>
                      G{r.gravida} P{r.para}
                    </TD>
                    <TD>{r.edd ? formatCalendarDate(r.edd) : <Badge tone="warning">not dated</Badge>}</TD>
                    <TD>
                      {formatGestation(r.gaToday)}
                      {r.gaToday !== null && r.gaToday >= 287 && (
                        <Badge tone="warning" className="ml-1">
                          past 41 weeks
                        </Badge>
                      )}
                    </TD>
                    <TD className="text-[13px]">{r.lastAnc ? formatCalendarDate(r.lastAnc) : "—"}</TD>
                    <TD className="text-right">
                      <Button asChild size="sm" variant="secondary">
                        <Link prefetch={false} href={`/maternity/${r.id}`}>
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
