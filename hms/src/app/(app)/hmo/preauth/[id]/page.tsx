import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { PREAUTH_TRANSITIONS, getPreauth } from "@/server/domains/hmo/preauth";
import { formatNaira } from "@/lib/money";
import { formatCalendarDate, formatDateTime } from "@/lib/time";
import { PREAUTH_TONE, statusText } from "@/lib/billing-labels";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Forbidden, PageHeader } from "@/components/ui/misc";
import { ActionDialog, type FieldSpec } from "@/components/forms/action-form";
import { load } from "../../../_lib/guard";
import { transitionPreauthAction } from "../../actions";

export const metadata: Metadata = { title: "Pre-authorisation" };

const LABEL: Record<string, string> = {
  SUBMITTED: "Mark submitted to payer",
  QUERIED: "Payer queried",
  APPROVED: "Payer approved",
  PARTIALLY_APPROVED: "Payer partly approved",
  REJECTED: "Payer rejected",
  EXPIRED: "Mark expired",
  CANCELLED: "Cancel request",
};

export default async function PreauthPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await load(ctx, `/hmo/preauth/${id}`, () => getPreauth(ctx, id));
  if (!res.ok) {
    if (res.kind === "notfound") notFound();
    return <Forbidden message={res.message} />;
  }
  const pa = res.data;
  const manage = can(ctx, "hmo.preauth.manage", { branchId: pa.encounter.branchId });
  const fieldsFor = (to: string): FieldSpec[] => {
    if (to === "APPROVED" || to === "PARTIALLY_APPROVED")
      return [
        { name: "authCode", label: "Payer authorisation code", type: "text", required: true },
        { name: "approvedKobo", label: "Approved amount", type: "money", required: true },
        { name: "validUntil", label: "Valid until", type: "date" },
        { name: "note", label: "Scope / conditions", type: "textarea" },
      ];
    return [
      {
        name: "note",
        label: ["QUERIED", "REJECTED", "CANCELLED"].includes(to) ? "Reason (required)" : "Note",
        type: "textarea",
      },
    ];
  };
  return (
    <>
      <Link prefetch={false} href="/hmo/preauth" className="text-[13px] text-muted hover:text-foreground">
        ← Pre-authorisations
      </Link>
      <PageHeader
        title={`Pre-authorisation ${pa.ref}`}
        description={
          <>
            {pa.encounter.patient.givenName} {pa.encounter.patient.familyName} ·{" "}
            <span className="font-mono">{pa.encounter.patient.mrn}</span> · {pa.payer.name}{" "}
            {pa.coverage.plan.name} · member {pa.coverage.memberNumber} · visit{" "}
            <Link
              prefetch={false}
              href={`/hmo/visits/${pa.encounter.id}`}
              className="font-mono text-accent hover:underline"
            >
              {pa.encounter.ref}
            </Link>
          </>
        }
        actions={<Badge tone={PREAUTH_TONE[pa.status]}>{statusText(pa.status)}</Badge>}
      />
      {manage && PREAUTH_TRANSITIONS[pa.status].length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {PREAUTH_TRANSITIONS[pa.status].map((to) => (
            <ActionDialog
              key={to}
              action={transitionPreauthAction}
              fixed={{ id: pa.id, version: pa.version, to }}
              trigger={LABEL[to]!}
              triggerVariant={to === "APPROVED" || to === "SUBMITTED" ? "primary" : "secondary"}
              title={LABEL[to]!}
              description="Record exactly what the payer communicated; your name and the time are logged."
              submitLabel="Save"
              tone={to === "CANCELLED" || to === "REJECTED" ? "danger" : "primary"}
              successMessage="Pre-authorisation updated."
              fields={fieldsFor(to)}
            />
          ))}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Request" />
          <CardBody className="space-y-2 text-[14px]">
            <p className="whitespace-pre-wrap">{pa.medicalNecessity}</p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {pa.items.map((i) => (
                <li key={i.id} className="flex justify-between p-2">
                  <span>
                    {i.quantity} × {i.service.name}
                  </span>
                  <span className="tabular-nums">{formatNaira(i.requestedKobo)}</span>
                </li>
              ))}
            </ul>
            <p>
              Requested <span className="font-semibold">{formatNaira(pa.requestedKobo)}</span>
              {pa.approvedKobo !== null && (
                <>
                  {" "}
                  · approved <span className="font-semibold">{formatNaira(pa.approvedKobo)}</span>
                </>
              )}
              {pa.authCode && (
                <>
                  {" "}
                  · code <span className="font-mono">{pa.authCode}</span>
                </>
              )}
              {pa.validUntil && <> · valid until {formatCalendarDate(pa.validUntil)}</>}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="History" />
          <CardBody>
            <ol className="space-y-1 text-[14px]">
              {pa.events.map((e) => (
                <li key={e.id}>
                  {formatDateTime(e.at)} · {statusText(e.toStatus)}
                  {e.note && <span className="text-muted"> - {e.note}</span>}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
