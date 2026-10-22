import type { Metadata } from "next";
import Link from "next/link";
import { Copy } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { listDuplicateReviews } from "@/server/domains/patients/merge";
import { formatCalendarDate, formatDate } from "@/lib/time";
import { maskPhone } from "@/lib/phone";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionDialog, ConfirmAction } from "@/components/forms/action-form";
import { load } from "../../_lib/guard";
import { approveMergeAction, dismissDuplicateAction, requestMergeAction } from "../actions";

export const metadata: Metadata = { title: "Duplicate review" };
const STATUSES = ["OPEN", "MERGE_REQUESTED", "NOT_DUPLICATE", "MERGED"] as const;
type Status = (typeof STATUSES)[number];

export default async function DuplicatesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireAuthContext();
  const sp = await searchParams;
  const status: Status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as Status) : "OPEN";
  const res = await load(ctx, "/patients/duplicates", () => listDuplicateReviews(ctx, status));
  if (!res.ok) return <Forbidden message={res.message} />;
  const reviews = res.data;

  return (
    <>
      <PageHeader
        title="Duplicate review"
        description="Suspected duplicate records. Nothing is merged automatically: one person requests a merge and a different authorised person approves it. The merged-away record is kept for history."
      />
      <LinkTabs
        label="Review status"
        current={status}
        tabs={[
          { key: "OPEN", label: "To review", href: "/patients/duplicates" },
          { key: "MERGE_REQUESTED", label: "Awaiting approval", href: "/patients/duplicates?status=MERGE_REQUESTED" },
          { key: "NOT_DUPLICATE", label: "Not duplicates", href: "/patients/duplicates?status=NOT_DUPLICATE" },
          { key: "MERGED", label: "Merged", href: "/patients/duplicates?status=MERGED" },
        ]}
      />
      {reviews.length === 0 ? (
        <Card>
          <EmptyState icon={<Copy className="h-5 w-5" />} title="Nothing here">
            Suspected duplicates are raised automatically at registration or when an identity number matches another record.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          {reviews.map((r) => (
            <Card key={r.id}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    Match score {r.score} <Badge tone="warning">{r.reasons.join(" · ")}</Badge>
                  </span>
                }
                description={`Raised ${formatDate(r.raisedAt)}`}
              />
              <CardBody className="grid gap-4 md:grid-cols-2">
                {[r.patientA, r.patientB].map((p) => (
                  <div key={p.id} className={`rounded-md border p-3 ${r.survivorId === p.id ? "border-accent" : "border-border"}`}>
                    <p className="font-medium">
                      <Link prefetch={false} className="hover:underline" href={`/patients/${p.id}`} target="_blank">
                        {p.givenName} {p.middleName ?? ""} {p.familyName}
                      </Link>{" "}
                      {r.survivorId === p.id && <Badge tone="accent">Proposed survivor</Badge>}
                      {p.status !== "ACTIVE" && <Badge tone="neutral">{p.status.toLowerCase()}</Badge>}
                    </p>
                    <dl className="mt-2 grid grid-cols-2 gap-1 text-[13px]">
                      <dt className="text-muted">MRN</dt>
                      <dd className="font-mono">{p.mrn}</dd>
                      <dt className="text-muted">Date of birth</dt>
                      <dd>{p.dateOfBirth ? formatCalendarDate(p.dateOfBirth) : "-"}</dd>
                      <dt className="text-muted">Sex</dt>
                      <dd>{p.sexAtBirth.toLowerCase()}</dd>
                      <dt className="text-muted">Phone</dt>
                      <dd>{maskPhone(p.phoneE164) || "-"}</dd>
                      <dt className="text-muted">Registered</dt>
                      <dd>{formatDate(p.createdAt)}</dd>
                      <dt className="text-muted">Visits / appointments</dt>
                      <dd>
                        {p._count.encounters} / {p._count.appointments}
                      </dd>
                    </dl>
                  </div>
                ))}
                {(r.status === "OPEN" || r.status === "MERGE_REQUESTED") && (
                  <div className="flex flex-wrap gap-2 md:col-span-2">
                    {r.status === "OPEN" && can(ctx, "patient.merge.request") && (
                      <ActionDialog
                        action={requestMergeAction}
                        fixed={{ reviewId: r.id }}
                        trigger="Request merge"
                        title="Request merge"
                        description="A different authorised person must approve. Appointments, visits, contacts, allergies, consents and identifiers move to the surviving record."
                        submitLabel="Submit for approval"
                        successMessage="Merge requested for approval."
                        fields={[
                          {
                            name: "survivorId",
                            label: "Keep which record?",
                            type: "select",
                            required: true,
                            options: [r.patientA, r.patientB].map((p) => ({ value: p.id, label: `${p.mrn} - ${p.givenName} ${p.familyName}` })),
                          },
                          { name: "notes", label: "How was this confirmed?", type: "textarea", required: true },
                        ]}
                      />
                    )}
                    {r.status === "MERGE_REQUESTED" && can(ctx, "patient.merge.approve") && r.mergeRequestedById !== ctx.userId && (
                      <ConfirmAction
                        action={approveMergeAction}
                        fixed={{ reviewId: r.id }}
                        trigger="Approve merge"
                        triggerVariant="primary"
                        title="Approve this merge?"
                        description={`Requester's note: ${r.decisionNotes ?? "-"}. This moves records to the surviving MRN and cannot be silently undone.`}
                        submitLabel="Approve merge"
                        tone="danger"
                        successMessage="Records merged."
                      />
                    )}
                    {r.status === "MERGE_REQUESTED" && r.mergeRequestedById === ctx.userId && (
                      <p className="text-[13px] text-muted">You requested this merge; another person must approve it.</p>
                    )}
                    <ActionDialog
                      action={dismissDuplicateAction}
                      fixed={{ reviewId: r.id }}
                      trigger="Not the same person"
                      triggerVariant="ghost"
                      title="Mark as not duplicates"
                      submitLabel="Confirm"
                      successMessage="Marked as different people."
                      fields={[{ name: "notes", label: "How was this confirmed?", type: "textarea", required: true }]}
                    />
                  </div>
                )}
                {r.status !== "OPEN" && r.status !== "MERGE_REQUESTED" && r.decisionNotes && (
                  <p className="text-[13px] text-muted md:col-span-2">Decision notes: {r.decisionNotes}</p>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
