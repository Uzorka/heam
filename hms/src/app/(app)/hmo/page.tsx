import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { hmoDashboard } from "@/server/domains/hmo/dashboard";
import { formatNaira } from "@/lib/money";
import { formatCalendarDate, formatDateTime } from "@/lib/time";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader, StatTile } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmAction } from "@/components/forms/action-form";
import { load } from "../_lib/guard";
import { createClaimAction } from "./actions";

export const metadata: Metadata = { title: "HMO desk" };

export default async function HmoDeskPage() {
  const ctx = await requireAuthContext();
  const res = await load(ctx, "/hmo", () => hmoDashboard(ctx));
  if (!res.ok) return <Forbidden message={res.message} />;
  const d = res.data;
  return (
    <>
      <PageHeader
        title="HMO desk"
        description="Pre-authorisations, claims and payer balances. Payers pay against remittances, never against approvals."
      />
      {d.expiring.map((p) => (
        <Alert key={p.id} tone="warning" className="mb-3">
          {p.name} contract ends {p.contractEnd ? formatCalendarDate(p.contractEnd) : ""}. Renew or suspend
          before then.
        </Alert>
      ))}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Pre-authorisations in progress" value={String(d.preauthPending)} />
        <StatTile label="Claims to validate / send" value={String(d.claimsToSend)} />
        <StatTile label="Open claims" value={String(d.openClaims)} />
        <StatTile label="Payer balance outstanding" value={formatNaira(d.outstanding)} />
      </div>
      {d.failedChecks > 0 && (
        <Alert tone="warning" className="mb-5">
          {d.failedChecks} active cover(s) have a failed eligibility check and are not verified.
        </Alert>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Outstanding by payer" />
          {d.byPayer.length === 0 ? (
            <EmptyState title="No open claims" />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Payer</TH>
                    <TH className="text-right">Claims</TH>
                    <TH className="text-right">Outstanding</TH>
                  </tr>
                </THead>
                <tbody>
                  {d.byPayer.map((p) => (
                    <TR key={p.name}>
                      <TD>{p.name}</TD>
                      <TD className="text-right">{p.claims}</TD>
                      <TD className="text-right tabular-nums">{formatNaira(p.outstanding)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
        <Card>
          <CardHeader title="Ageing since submission" />
          <TableWrap>
            <Table>
              <tbody>
                {Object.entries(d.aging).map(([k, v]) => (
                  <TR key={k}>
                    <TD>{k} days</TD>
                    <TD className="text-right tabular-nums">{formatNaira(v)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      </div>
      <Card className="mt-5">
        <CardHeader title="Visits with unclaimed payer charges" />
        {d.readyVisits.length === 0 ? (
          <EmptyState title="Nothing waiting to be claimed" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Patient</TH>
                  <TH>Visit</TH>
                  <TH>Payer</TH>
                  <TH>
                    <span className="sr-only">Claim</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {d.readyVisits.map((v) => (
                  <TR key={v.id}>
                    <TD>
                      {v.patient.givenName} {v.patient.familyName}
                      <span className="block font-mono text-[13px] text-muted">{v.patient.mrn}</span>
                    </TD>
                    <TD className="text-[13px]">
                      <Link
                        prefetch={false}
                        href={`/hmo/visits/${v.id}`}
                        className="font-mono text-accent hover:underline"
                      >
                        {v.ref}
                      </Link>
                      <span className="block text-muted">
                        {formatDateTime(v.arrivedAt)} · {v.status.toLowerCase()}
                      </span>
                    </TD>
                    <TD>{v.coverage?.payer.name}</TD>
                    <TD className="text-right">
                      {can(ctx, "hmo.claim.manage") && (
                        <ConfirmAction
                          action={createClaimAction}
                          fixed={{ encounterId: v.id }}
                          trigger="Create claim"
                          triggerVariant="primary"
                          title="Create a draft claim for this visit?"
                          description="All unclaimed payer charges on the visit are added. You can remove lines before validating."
                          submitLabel="Create claim"
                          successMessage="Draft claim created."
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
    </>
  );
}
