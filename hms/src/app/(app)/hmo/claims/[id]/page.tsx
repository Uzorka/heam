import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { CLAIM_TRANSITIONS, getClaim } from "@/server/domains/hmo/claims";
import { formatNaira } from "@/lib/money";
import { formatCalendarDate, formatDateTime } from "@/lib/time";
import { CLAIM_TONE, statusText } from "@/lib/billing-labels";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog, ConfirmAction, type FieldSpec } from "@/components/forms/action-form";
import { load } from "../../../_lib/guard";
import { removeClaimLineAction, transitionClaimAction, validateClaimAction } from "../../actions";

export const metadata: Metadata = { title: "Claim" };

const LABEL: Record<string, string> = {
  SUBMITTED: "Mark submitted",
  ACKNOWLEDGED: "Payer acknowledged",
  QUERIED: "Payer queried",
  RESUBMITTED: "Resubmitted",
  APPROVED: "Payer approved in full",
  PARTLY_APPROVED: "Payer approved in part",
  DENIED: "Payer denied",
  CLOSED: "Close claim",
  DRAFT: "Back to draft",
};

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await load(ctx, `/hmo/claims/${id}`, () => getClaim(ctx, id));
  if (!res.ok) {
    if (res.kind === "notfound") notFound();
    return <Forbidden message={res.message} />;
  }
  const { claim, issues } = res.data;
  const b = claim.branchId;
  const submit = can(ctx, "hmo.claim.submit", { branchId: b });
  const manage = can(ctx, "hmo.claim.manage", { branchId: b });
  const outstanding = claim.claimedKobo - claim.paidKobo - claim.writtenOffKobo;
  const fields = (to: string): FieldSpec[] =>
    to === "PARTLY_APPROVED"
      ? [
          { name: "approvedKobo", label: "Amount approved", type: "money", required: true },
          { name: "note", label: "Payer's note", type: "textarea" },
        ]
      : to === "CLOSED" && outstanding > 0n && claim.status !== "DRAFT"
        ? [
            {
              name: "note",
              label: `Reason for writing off ${formatNaira(outstanding)} (finance approval needed)`,
              type: "textarea",
              required: true,
            },
          ]
        : [
            {
              name: "note",
              label: ["QUERIED", "DENIED"].includes(to) ? "Payer's reason (required)" : "Note",
              type: "textarea",
            },
          ];
  return (
    <>
      <Link prefetch={false} href="/hmo/claims" className="text-[13px] text-muted hover:text-foreground">
        ← Claims
      </Link>
      <PageHeader
        title={`Claim ${claim.ref}`}
        description={
          <>
            {claim.encounter.patient.givenName} {claim.encounter.patient.familyName} ·{" "}
            <span className="font-mono">{claim.encounter.patient.mrn}</span> · {claim.payer.name}{" "}
            {claim.coverage.plan.name} · member {claim.coverage.memberNumber} · visit{" "}
            <Link
              prefetch={false}
              href={`/hmo/visits/${claim.encounter.id}`}
              className="font-mono text-accent hover:underline"
            >
              {claim.encounter.ref}
            </Link>
          </>
        }
        actions={<Badge tone={CLAIM_TONE[claim.status]}>{statusText(claim.status)}</Badge>}
      />
      {claim.status === "DRAFT" && issues.length > 0 && (
        <Alert tone="warning" title="Fix before validating" className="mb-4">
          <ul className="list-disc pl-5">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </Alert>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        {claim.status === "DRAFT" && manage && issues.length === 0 && (
          <ConfirmAction
            action={validateClaimAction}
            fixed={{ id: claim.id, version: claim.version }}
            trigger="Validate"
            triggerVariant="primary"
            title="Validate this claim?"
            description="Checks are complete; it becomes ready to batch and send."
            submitLabel="Validate"
            successMessage="Claim validated."
          />
        )}
        {submit &&
          (CLAIM_TRANSITIONS[claim.status] ?? []).map((to) => (
            <ActionDialog
              key={to}
              action={transitionClaimAction}
              fixed={{ id: claim.id, version: claim.version, to }}
              trigger={LABEL[to] ?? to}
              triggerVariant={to === "CLOSED" || to === "DENIED" ? "ghost" : "secondary"}
              title={LABEL[to] ?? to}
              description="Record what the payer communicated. Payment is recorded only by importing the remittance."
              submitLabel="Save"
              successMessage="Claim updated."
              fields={fields(to)}
            />
          ))}
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Claimed", claim.claimedKobo],
          ["Approved", claim.approvedKobo],
          ["Paid", claim.paidKobo],
          ["Written off", claim.writtenOffKobo],
        ].map(([l, v]) => (
          <Card key={l as string}>
            <CardBody>
              <p className="text-[13px] text-muted">{l as string}</p>
              <p className="text-xl font-semibold tabular-nums">
                {v === null ? "—" : formatNaira(v as bigint)}
              </p>
            </CardBody>
          </Card>
        ))}
      </div>
      <Card className="mb-5">
        <CardHeader
          title="Lines"
          description={
            claim.encounter.diagnoses
              .map((d) => (d.code ? `${d.code} ${d.description}` : d.description))
              .join("; ") || "No diagnosis recorded"
          }
        />
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Service</TH>
                <TH>Date</TH>
                <TH className="text-right">Claimed</TH>
                <TH className="text-right">Paid</TH>
                <TH>Auth code</TH>
                <TH>
                  <span className="sr-only">Remove</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {claim.lines.map((l) => (
                <TR key={l.id} className={l.removedAt ? "opacity-50" : undefined}>
                  <TD>
                    <span className={l.removedAt ? "line-through" : undefined}>
                      {l.quantity} × {l.description}
                    </span>
                    {l.charge.preauthRequired && <Badge tone="warning">pre-auth</Badge>}
                  </TD>
                  <TD className="text-[13px]">{formatCalendarDate(l.serviceDate)}</TD>
                  <TD className="text-right tabular-nums">{formatNaira(l.claimedKobo)}</TD>
                  <TD className="text-right tabular-nums">{formatNaira(l.paidKobo)}</TD>
                  <TD className="font-mono text-[13px]">{l.authCode ?? "—"}</TD>
                  <TD className="text-right">
                    {claim.status === "DRAFT" && manage && !l.removedAt && (
                      <ActionDialog
                        action={removeClaimLineAction}
                        fixed={{ lineId: l.id }}
                        trigger="Remove"
                        triggerVariant="ghost"
                        title="Remove line"
                        description="The charge becomes available to claim again."
                        submitLabel="Remove"
                        successMessage="Line removed."
                        fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
                      />
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="History" />
          <CardBody>
            <ol className="space-y-1 text-[14px]">
              {claim.events.map((e) => (
                <li key={e.id}>
                  {formatDateTime(e.at)} · {statusText(e.toStatus)}
                  {e.note && <span className="text-muted"> - {e.note}</span>}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Remittances" />
          <CardBody>
            {claim.remitted.length === 0 ? (
              <p className="text-[14px] text-muted">No payments received yet.</p>
            ) : (
              <ul className="space-y-1 text-[14px]">
                {claim.remitted.map((r) => (
                  <li key={r.id}>
                    {formatCalendarDate(r.remittance.receivedDate)} · {r.remittance.payerReference} · paid{" "}
                    {formatNaira(r.paidKobo)}
                    {r.deniedKobo > 0n && ` · denied ${formatNaira(r.deniedKobo)}`}
                    {r.reason && <span className="text-muted"> ({r.reason})</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
