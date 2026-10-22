import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { can, canAny } from "@/server/authz/context";
import { availableBeds, getAdmission } from "@/server/domains/inpatient/service";
import { formatAge, formatDateTime } from "@/lib/time";
import { statusText } from "@/lib/billing-labels";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Forbidden, PageHeader } from "@/components/ui/misc";
import { ActionDialog, ConfirmAction } from "@/components/forms/action-form";
import { load } from "../../_lib/guard";
import {
  authoriseDischargeAction,
  clearanceAction,
  completeDischargeAction,
  moveBedAction,
} from "../../wards/actions";

export const metadata: Metadata = { title: "Admission" };

const STATUS_TONE = {
  ADMITTED: "accent",
  DISCHARGE_AUTHORISED: "warning",
  DISCHARGED: "success",
  CANCELLED: "outline",
} as const;

export default async function AdmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await load(ctx, `/admissions/${id}`, () => getAdmission(ctx, id));
  if (!res.ok) {
    if (res.kind === "notfound") notFound();
    return <Forbidden message={res.message} />;
  }
  const { adm, who } = res.data;
  const b = adm.branchId;
  const current = adm.status === "ADMITTED" || adm.status === "DISCHARGE_AUTHORISED";
  const open = adm.assignments.find((a) => !a.endAt);
  const free = current && can(ctx, "admission.manage", { branchId: b }) ? await availableBeds(ctx) : [];
  const p = adm.patient;
  return (
    <>
      <Link prefetch={false} href="/wards" className="text-[13px] text-muted hover:text-foreground">
        ← Ward board
      </Link>
      <PageHeader
        title={`${p.givenName} ${p.familyName}${p.preferredName ? ` (${p.preferredName})` : ""}`}
        description={
          <>
            <span className="font-mono">{p.mrn}</span> ·{" "}
            {p.dateOfBirth ? formatAge(p.dateOfBirth) : "age not recorded"} · {p.sexAtBirth.toLowerCase()} ·
            stay <span className="font-mono">{adm.ref}</span> · admitted {formatDateTime(adm.admittedAt)} by{" "}
            {who(adm.admittedById)}
          </>
        }
        actions={
          <>
            <Badge tone={STATUS_TONE[adm.status]}>{statusText(adm.status)}</Badge>
            {canAny(ctx, ["clinical.read", "nursing.mar.record"], { branchId: b }) && (
              <Button asChild size="sm" variant="secondary">
                <Link prefetch={false} href={`/encounters/${adm.encounter.id}`}>
                  Clinical record of this stay
                </Link>
              </Button>
            )}
            {canAny(ctx, ["billing.read", "hmo.read"], { branchId: b }) && (
              <Button asChild size="sm" variant="secondary">
                <Link prefetch={false} href={`/hmo/visits/${adm.encounter.id}`}>
                  Payer & bill
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Bed"
            actions={
              free.length > 0 && (
                <ActionDialog
                  action={moveBedAction}
                  fixed={{ admissionId: adm.id }}
                  trigger={open ? "Move bed / ward" : "Assign bed"}
                  title={open ? "Move to another bed" : "Assign a bed"}
                  description="The current bed goes to cleaning. The move is recorded with the time."
                  submitLabel="Save"
                  successMessage="Bed updated."
                  fields={[
                    {
                      name: "bedId",
                      label: "Bed",
                      type: "select",
                      required: true,
                      options: free.map((x) => ({ value: x.id, label: `${x.ward.name} - ${x.label}` })),
                    },
                    { name: "reason", label: "Reason", type: "text" },
                  ]}
                />
              )
            }
          />
          <CardBody>
            <p className="mb-2 text-[14px]">
              {open ? `${open.bed.ward.name} · ${open.bed.label}` : "No bed assigned"}
            </p>
            <ol className="space-y-1 text-[13px] text-muted">
              {adm.assignments.map((a) => (
                <li key={a.id}>
                  {a.bed.ward.name} {a.bed.label}: {formatDateTime(a.startAt)} –{" "}
                  {a.endAt ? formatDateTime(a.endAt) : "now"}
                  {a.reason && ` (${a.reason})`}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Admission" />
          <CardBody className="space-y-1 text-[14px]">
            <p>
              <span className="text-muted">Reason:</span> {adm.reason}
            </p>
            <p>
              <span className="text-muted">Attending:</span> {who(adm.attendingClinicianId) ?? "not set"}
            </p>
            <p>
              <span className="text-muted">Visit:</span>{" "}
              <span className="font-mono">{adm.encounter.ref}</span> · {statusText(adm.encounter.payerClass)}
            </p>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader
          title="Discharge"
          description="1. A clinician authorises and signs the discharge. 2. Finance clears the bill. 3. The ward completes the discharge."
        />
        <CardBody className="space-y-3 text-[14px]">
          <p>
            1. Clinical:{" "}
            {adm.dischargeAuthorisedAt ? (
              <>
                authorised {formatDateTime(adm.dischargeAuthorisedAt)} by {who(adm.dischargeAuthorisedById)} →{" "}
                {adm.dischargeDestination}
              </>
            ) : (
              "not yet authorised"
            )}
          </p>
          {adm.dischargeSummary && (
            <p className="whitespace-pre-wrap rounded-md bg-surface-2 p-3">{adm.dischargeSummary}</p>
          )}
          <p>
            2. Financial clearance:{" "}
            {adm.financialClearanceAt ? (
              <>
                {formatDateTime(adm.financialClearanceAt)} by {who(adm.financialClearanceById)} -{" "}
                {adm.financialClearanceNote}
              </>
            ) : (
              "pending"
            )}
          </p>
          <p>
            3. Discharged:{" "}
            {adm.dischargedAt
              ? `${formatDateTime(adm.dischargedAt)} by ${who(adm.dischargedById)}`
              : "not yet"}
          </p>
          <div className="flex flex-wrap gap-2">
            {adm.status === "ADMITTED" && can(ctx, "discharge.authorize", { branchId: b }) && (
              <ActionDialog
                action={authoriseDischargeAction}
                fixed={{ admissionId: adm.id }}
                trigger="Authorise discharge"
                triggerVariant="primary"
                title="Authorise discharge"
                description="Your password is your signature. The summary is shared with the patient on discharge."
                submitLabel="Sign and authorise"
                successMessage="Discharge authorised."
                fields={[
                  {
                    name: "summary",
                    label: "Discharge summary (diagnosis, treatment, medicines, follow-up)",
                    type: "textarea",
                    required: true,
                  },
                  {
                    name: "destination",
                    label: "Discharged to",
                    type: "text",
                    required: true,
                    defaultValue: "Home",
                  },
                  { name: "password", label: "Your password", type: "password", required: true },
                ]}
              />
            )}
            {adm.status === "DISCHARGE_AUTHORISED" &&
              !adm.financialClearanceAt &&
              can(ctx, "discharge.clear_finance", { branchId: b }) && (
                <ActionDialog
                  action={clearanceAction}
                  fixed={{ admissionId: adm.id }}
                  trigger="Financial clearance"
                  triggerVariant="primary"
                  title="Clear the discharge financially"
                  description="Bed-days are charged first. Clearance needs a settled bill unless you record an override (e.g. HMO share pending, approved credit)."
                  submitLabel="Clear"
                  successMessage="Discharge cleared."
                  fields={[
                    { name: "override", label: "Clear with an outstanding balance", type: "checkbox" },
                    { name: "note", label: "Note (required for an override)", type: "textarea" },
                  ]}
                />
              )}
            {adm.status === "DISCHARGE_AUTHORISED" &&
              adm.financialClearanceAt &&
              can(ctx, "admission.manage", { branchId: b }) && (
                <ConfirmAction
                  action={completeDischargeAction}
                  fixed={{ admissionId: adm.id }}
                  trigger="Complete discharge"
                  triggerVariant="primary"
                  title="Has the patient left the ward?"
                  description="The bed goes to cleaning and the visit is closed."
                  submitLabel="Complete discharge"
                  successMessage="Patient discharged."
                />
              )}
          </div>
          {adm.status === "DISCHARGE_AUTHORISED" &&
            !adm.financialClearanceAt &&
            !can(ctx, "discharge.clear_finance", { branchId: b }) && (
              <Alert tone="info">Waiting for finance to clear the bill.</Alert>
            )}
        </CardBody>
      </Card>
      {!current && adm.status === "DISCHARGED" && (
        <p className="mt-4 text-[13px] text-muted">This stay is closed.</p>
      )}
    </>
  );
}
