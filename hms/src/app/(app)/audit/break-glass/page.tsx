import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { listBreakGlassForReview } from "@/server/domains/security/breakglass";
import { formatDateTime } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionDialog } from "@/components/forms/action-form";
import { load } from "../../_lib/guard";
import { reviewBreakGlassAction } from "../actions";

export const metadata: Metadata = { title: "Emergency access review" };
const STATUSES = ["PENDING", "APPROPRIATE", "CONCERN"] as const;

export default async function BreakGlassPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireAuthContext();
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status) ?? "PENDING";
  const res = await load(ctx, "/audit/break-glass", () => listBreakGlassForReview(ctx, status));
  if (!res.ok) return <Forbidden message={res.message} />;
  return (
    <>
      <PageHeader title="Emergency access review" description="Every break-glass access to a patient's clinical record must be reviewed. Reviewers cannot review their own access." />
      <LinkTabs
        label="Review status"
        current={status}
        tabs={[
          { key: "PENDING", label: "To review", href: "/audit/break-glass" },
          { key: "APPROPRIATE", label: "Appropriate", href: "/audit/break-glass?status=APPROPRIATE" },
          { key: "CONCERN", label: "Concerns raised", href: "/audit/break-glass?status=CONCERN" },
        ]}
      />
      {res.data.length === 0 ? (
        <Card>
          <EmptyState title="Nothing to review" />
        </Card>
      ) : (
        <div className="space-y-3">
          {res.data.map((g) => (
            <Card key={g.id}>
              <CardHeader
                title={`${g.user.displayName} · patient ${g.patient.mrn}`}
                description={`${formatDateTime(g.startedAt)} → expires ${formatDateTime(g.expiresAt)}${g.endedAt ? ` (ended ${formatDateTime(g.endedAt)})` : ""}`}
                actions={
                  g.reviewStatus === "PENDING" && g.userId !== ctx.userId ? (
                    <ActionDialog
                      action={reviewBreakGlassAction}
                      fixed={{ grantId: g.id }}
                      trigger="Record review"
                      triggerVariant="primary"
                      title="Review emergency access"
                      submitLabel="Save review"
                      successMessage="Review recorded."
                      fields={[
                        {
                          name: "status",
                          label: "Outcome",
                          type: "select",
                          required: true,
                          options: [
                            { value: "APPROPRIATE", label: "Appropriate" },
                            { value: "CONCERN", label: "Concern - escalate" },
                          ],
                        },
                        { name: "notes", label: "Review notes", type: "textarea", required: true },
                      ]}
                    />
                  ) : (
                    <Badge tone={g.reviewStatus === "CONCERN" ? "danger" : g.reviewStatus === "APPROPRIATE" ? "success" : "outline"}>{g.reviewStatus.toLowerCase()}</Badge>
                  )
                }
              />
              <CardBody className="text-[14px]">
                <p>
                  <span className="text-muted">Reason:</span> {g.reason.toLowerCase().replace(/_/g, " ")}
                </p>
                <p className="mt-1">
                  <span className="text-muted">Justification:</span> {g.justification}
                </p>
                {g.reviewedBy && (
                  <p className="mt-2 text-[13px] text-muted">
                    Reviewed by {g.reviewedBy.displayName}: {g.reviewNotes}
                  </p>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
