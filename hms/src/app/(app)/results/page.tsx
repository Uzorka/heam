import type { Metadata } from "next";
import Link from "next/link";
import { FileCheck2 } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { resultsInbox } from "@/server/domains/clinical/workspace";
import { unacknowledgedCriticalAlerts } from "@/server/domains/lab/service";
import { formatDateTime } from "@/lib/time";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { load } from "../_lib/guard";

export const metadata: Metadata = { title: "Results to review" };

export default async function ResultsPage() {
  const ctx = await requireAuthContext();
  if (!ctx.activeBranchId) return <Alert tone="warning">Select a branch.</Alert>;
  const res = await load(ctx, "/results", async () => ({
    inbox: await resultsInbox(ctx),
    critical: await unacknowledgedCriticalAlerts(ctx),
  }));
  if (!res.ok) return <Forbidden message={res.message} />;
  const { inbox, critical } = res.data;
  return (
    <>
      <PageHeader
        title="Results to review"
        description="Verified results for patients you ordered for or are caring for. Open the visit to review and act."
      />
      {critical.length > 0 && (
        <div className="mb-5 space-y-2">
          {critical.map((a) => (
            <Alert
              key={a.id}
              tone="danger"
              title={`Critical result: ${a.patient.givenName} ${a.patient.familyName} (${a.patient.mrn})`}
            >
              {a.summary} · raised {formatDateTime(a.raisedAt)}{" "}
              <Link
                prefetch={false}
                className="font-medium underline"
                href={`/encounters/${a.order.encounterId}?tab=orders`}
              >
                Open and acknowledge
              </Link>
            </Alert>
          ))}
        </div>
      )}
      <Card>
        {inbox.length === 0 ? (
          <EmptyState icon={<FileCheck2 className="h-5 w-5" />} title="No results waiting for you" />
        ) : (
          <ul className="divide-y divide-border">
            {inbox.map((o) => {
              const abnormal = o.results.some((r) => r.flag !== "NORMAL" && r.flag !== "NONE");
              return (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="font-medium">
                      {o.description}{" "}
                      {o.criticalAlerts.some((c) => !c.acknowledgedAt) ? (
                        <Badge tone="danger">Critical</Badge>
                      ) : abnormal ? (
                        <Badge tone="warning">Outside range</Badge>
                      ) : null}
                    </p>
                    <p className="text-[13px] text-muted">
                      {o.patient.givenName} {o.patient.familyName} ·{" "}
                      <span className="font-mono">{o.patient.mrn}</span> · verified{" "}
                      {o.verifiedAt ? formatDateTime(o.verifiedAt) : ""}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="secondary">
                    <Link prefetch={false} href={`/encounters/${o.encounterId}?tab=orders`}>
                      Review
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
