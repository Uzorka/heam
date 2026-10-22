import type { Metadata } from "next";
import Link from "next/link";
import type { PreauthStatus } from "@prisma/client";
import { requireAuthContext } from "@/server/auth/session";
import { listPreauths } from "@/server/domains/hmo/preauth";
import { formatNaira } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { PREAUTH_TONE, statusText } from "@/lib/billing-labels";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { load } from "../../_lib/guard";

export const metadata: Metadata = { title: "Pre-authorisations" };
const FILTERS: { key: string; label: string; status?: PreauthStatus }[] = [
  { key: "all", label: "All" },
  { key: "DRAFT", label: "Draft", status: "DRAFT" },
  { key: "SUBMITTED", label: "Awaiting payer", status: "SUBMITTED" },
  { key: "QUERIED", label: "Queried", status: "QUERIED" },
  { key: "APPROVED", label: "Approved", status: "APPROVED" },
];

export default async function PreauthListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requireAuthContext();
  const sp = await searchParams;
  const f = FILTERS.find((x) => x.key === sp.status) ?? FILTERS[0]!;
  const res = await load(ctx, "/hmo/preauth", () => listPreauths(ctx, { status: f.status }));
  if (!res.ok) return <Forbidden message={res.message} />;
  return (
    <>
      <PageHeader
        title="Pre-authorisations"
        description="Requested from a visit (Summary → Payer & billing). Approval is permission to provide care, not a guarantee of payment."
      />
      <LinkTabs
        label="Status"
        current={f.key}
        tabs={FILTERS.map((x) => ({
          key: x.key,
          label: x.label,
          href: x.key === "all" ? "/hmo/preauth" : `/hmo/preauth?status=${x.key}`,
        }))}
      />
      <Card>
        {res.data.length === 0 ? (
          <EmptyState title="None" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Ref</TH>
                  <TH>Patient</TH>
                  <TH>Payer</TH>
                  <TH className="text-right">Requested</TH>
                  <TH>Status</TH>
                  <TH>
                    <span className="sr-only">Open</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {res.data.map((p) => (
                  <TR key={p.id}>
                    <TD className="text-[13px]">
                      <span className="font-mono">{p.ref}</span>
                      <span className="block text-muted">{formatDateTime(p.createdAt)}</span>
                    </TD>
                    <TD>
                      {p.encounter.patient.givenName} {p.encounter.patient.familyName}
                      <span className="block font-mono text-[13px] text-muted">
                        {p.encounter.patient.mrn}
                      </span>
                    </TD>
                    <TD>{p.payer.name}</TD>
                    <TD className="text-right tabular-nums">{formatNaira(p.requestedKobo)}</TD>
                    <TD>
                      <Badge tone={PREAUTH_TONE[p.status]}>{statusText(p.status)}</Badge>
                      {p.authCode && <span className="block font-mono text-xs">{p.authCode}</span>}
                    </TD>
                    <TD className="text-right">
                      <Button asChild size="sm" variant="secondary">
                        <Link prefetch={false} href={`/hmo/preauth/${p.id}`}>
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
