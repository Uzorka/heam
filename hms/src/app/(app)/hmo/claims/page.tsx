import type { Metadata } from "next";
import Link from "next/link";
import type { ClaimStatus } from "@prisma/client";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { listBatches, listClaims } from "@/server/domains/hmo/claims";
import { formatNaira } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { CLAIM_TONE, statusText } from "@/lib/billing-labels";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmAction } from "@/components/forms/action-form";
import { load } from "../../_lib/guard";
import { createBatchAction } from "../actions";

export const metadata: Metadata = { title: "Claims" };
const FILTERS: { key: string; label: string; statuses?: ClaimStatus[] }[] = [
  { key: "all", label: "All" },
  { key: "DRAFT", label: "Draft", statuses: ["DRAFT"] },
  { key: "VALIDATED", label: "Ready to send", statuses: ["VALIDATED"] },
  {
    key: "open",
    label: "With payer",
    statuses: [
      "SUBMITTED",
      "ACKNOWLEDGED",
      "QUERIED",
      "RESUBMITTED",
      "APPROVED",
      "PARTLY_APPROVED",
      "PARTLY_PAID",
    ],
  },
  { key: "PAID", label: "Paid", statuses: ["PAID"] },
  { key: "DENIED", label: "Denied", statuses: ["DENIED"] },
];

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireAuthContext();
  const sp = await searchParams;
  const f = FILTERS.find((x) => x.key === sp.status) ?? FILTERS[0]!;
  const res = await load(ctx, "/hmo/claims", async () => ({
    claims: await listClaims(ctx),
    batches: await listBatches(ctx),
  }));
  if (!res.ok) return <Forbidden message={res.message} />;
  const claims = f.statuses ? res.data.claims.filter((c) => f.statuses!.includes(c.status)) : res.data.claims;
  const validated = res.data.claims.filter((c) => c.status === "VALIDATED" && !c.batchId);
  const byPayer = new Map<string, { name: string; ids: string[] }>();
  for (const c of validated) {
    const e = byPayer.get(c.payerId) ?? { name: c.payer.name, ids: [] };
    e.ids.push(c.id);
    byPayer.set(c.payerId, e);
  }
  return (
    <>
      <PageHeader
        title="Claims"
        description="Created from visits on the HMO desk. A claim is paid only when a remittance is reconciled against it."
      />
      {byPayer.size > 0 && can(ctx, "hmo.claim.submit") && (
        <Card className="mb-5">
          <CardHeader title="Ready to send" />
          <CardBody className="flex flex-wrap gap-2">
            {[...byPayer.entries()].map(([payerId, e]) => (
              <ConfirmAction
                key={payerId}
                action={createBatchAction}
                fixed={{ payerId, claimIds: e.ids }}
                trigger={`Batch & submit ${e.ids.length} to ${e.name}`}
                triggerVariant="primary"
                title={`Batch ${e.ids.length} claim(s) for ${e.name}?`}
                description="The claims are marked submitted. Download the batch file and send it through the payer's channel."
                submitLabel="Create batch"
                successMessage="Batch created; claims marked submitted."
              />
            ))}
          </CardBody>
        </Card>
      )}
      <LinkTabs
        label="Claim status"
        current={f.key}
        tabs={FILTERS.map((x) => ({
          key: x.key,
          label: x.label,
          href: x.key === "all" ? "/hmo/claims" : `/hmo/claims?status=${x.key}`,
        }))}
      />
      <Card className="mb-5">
        {claims.length === 0 ? (
          <EmptyState title="No claims" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Claim</TH>
                  <TH>Patient</TH>
                  <TH>Payer</TH>
                  <TH className="text-right">Claimed</TH>
                  <TH className="text-right">Paid</TH>
                  <TH>Status</TH>
                  <TH>
                    <span className="sr-only">Open</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {claims.map((c) => (
                  <TR key={c.id}>
                    <TD className="text-[13px]">
                      <span className="font-mono">{c.ref}</span>
                      <span className="block text-muted">{formatDateTime(c.createdAt)}</span>
                    </TD>
                    <TD>
                      {c.encounter.patient.givenName} {c.encounter.patient.familyName}
                      <span className="block font-mono text-[13px] text-muted">
                        {c.encounter.patient.mrn}
                      </span>
                    </TD>
                    <TD>{c.payer.name}</TD>
                    <TD className="text-right tabular-nums">{formatNaira(c.claimedKobo)}</TD>
                    <TD className="text-right tabular-nums">{formatNaira(c.paidKobo)}</TD>
                    <TD>
                      <Badge tone={CLAIM_TONE[c.status]}>{statusText(c.status)}</Badge>
                    </TD>
                    <TD className="text-right">
                      <Button asChild size="sm" variant="secondary">
                        <Link prefetch={false} href={`/hmo/claims/${c.id}`}>
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
      <Card>
        <CardHeader title="Batches" />
        {res.data.batches.length === 0 ? (
          <EmptyState title="No batches yet" />
        ) : (
          <CardBody>
            <ul className="space-y-1 text-[14px]">
              {res.data.batches.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-mono">{b.ref}</span> · {b._count.claims} claim(s) ·{" "}
                    {formatDateTime(b.createdAt)}
                  </span>
                  {can(ctx, "hmo.claim.manage") && (
                    <a href={`/api/hmo/batches/${b.id}`} className="text-accent hover:underline">
                      Download CSV
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        )}
      </Card>
    </>
  );
}
