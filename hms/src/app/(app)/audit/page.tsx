import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { queryAudit } from "@/server/domains/audit/query";
import { formatDateTime } from "@/lib/time";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, Forbidden, PageHeader, Pagination } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { load } from "../_lib/guard";
import { VerifyChainButton } from "./verify-button";

export const metadata: Metadata = { title: "Audit trail" };

type SP = { from?: string; to?: string; action?: string; outcome?: string; patientId?: string; actor?: string; page?: string };
const uuidRe = /^[0-9a-f-]{36}$/i;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireAuthContext();
  const sp = await searchParams;
  const q = {
    from: sp.from && dateRe.test(sp.from) ? sp.from : undefined,
    to: sp.to && dateRe.test(sp.to) ? sp.to : undefined,
    action: sp.action?.trim().slice(0, 60) || undefined,
    outcome: (["SUCCESS", "DENIED", "FAILURE"] as const).find((o) => o === sp.outcome),
    patientId: sp.patientId && uuidRe.test(sp.patientId) ? sp.patientId : undefined,
    actorUserId: sp.actor && uuidRe.test(sp.actor) ? sp.actor : undefined,
    page: Math.max(1, Number(sp.page) || 1),
  };
  const res = await load(ctx, "/audit", () => queryAudit(ctx, q));
  if (!res.ok) return <Forbidden message={res.message} />;
  const { rows, total, page, pageSize } = res.data;
  const href = (p: number) => {
    const u = new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => !!v) as [string, string][]);
    return `/audit?${u.toString()}`;
  };
  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Append-only, hash-chained record of sign-ins, record views, changes, approvals and denied access. Shows identifiers only - never clinical content."
        actions={<VerifyChainButton />}
      />
      <Card>
        <form method="get" className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-6">
          <label className="text-[13px]">
            <span className="mb-1 block text-muted">From</span>
            <Input type="date" name="from" defaultValue={q.from} />
          </label>
          <label className="text-[13px]">
            <span className="mb-1 block text-muted">To</span>
            <Input type="date" name="to" defaultValue={q.to} />
          </label>
          <label className="text-[13px]">
            <span className="mb-1 block text-muted">Action starts with</span>
            <Input name="action" defaultValue={q.action} placeholder="e.g. patient." />
          </label>
          <label className="text-[13px]">
            <span className="mb-1 block text-muted">Outcome</span>
            <Select name="outcome" defaultValue={q.outcome ?? ""}>
              <option value="">Any</option>
              <option value="SUCCESS">Success</option>
              <option value="DENIED">Denied</option>
              <option value="FAILURE">Failure</option>
            </Select>
          </label>
          <label className="text-[13px]">
            <span className="mb-1 block text-muted">Patient ID</span>
            <Input name="patientId" defaultValue={q.patientId} placeholder="UUID" />
          </label>
          <div className="flex items-end">
            <Button type="submit" variant="secondary" className="w-full">
              Filter
            </Button>
          </div>
        </form>
        {rows.length === 0 ? (
          <EmptyState title="No matching events" />
        ) : (
          <>
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>#</TH>
                    <TH>When</TH>
                    <TH>Who</TH>
                    <TH>Action</TH>
                    <TH>Resource</TH>
                    <TH>Outcome</TH>
                    <TH>Details</TH>
                  </tr>
                </THead>
                <tbody>
                  {rows.map((r) => (
                    <TR key={r.id}>
                      <TD className="font-mono text-[12px] text-muted">{r.seq}</TD>
                      <TD className="whitespace-nowrap text-[13px]">{formatDateTime(r.occurredAt)}</TD>
                      <TD className="text-[13px]">{r.actorName ?? r.actorType.toLowerCase()}</TD>
                      <TD className="font-mono text-[12px]">{r.action}</TD>
                      <TD className="text-[12px]">
                        {r.resourceType}
                        {r.resourceId && <span className="block max-w-[180px] truncate font-mono text-muted">{r.resourceId}</span>}
                        {r.patientId && <span className="block font-mono text-muted">patient {r.patientId.slice(0, 8)}…</span>}
                      </TD>
                      <TD>
                        <Badge tone={r.outcome === "SUCCESS" ? "neutral" : "danger"}>{r.outcome.toLowerCase()}</Badge>
                      </TD>
                      <TD className="max-w-[260px] truncate font-mono text-[11px] text-muted" title={r.details ? JSON.stringify(r.details) : undefined}>
                        {r.details ? JSON.stringify(r.details) : ""}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            <Pagination page={page} pageSize={pageSize} total={total} hrefFor={href} />
          </>
        )}
      </Card>
    </>
  );
}
