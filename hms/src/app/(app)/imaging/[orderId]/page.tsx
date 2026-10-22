import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { getImagingOrder } from "@/server/domains/imaging/service";
import { formatAge, formatDateTime, todayLocal } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DescriptionList, Forbidden, PageHeader } from "@/components/ui/misc";
import { ActionDialog, ActionForm, ConfirmAction } from "@/components/forms/action-form";
import { ORDER_STATUS_LABEL } from "@/components/clinical/flag-badge";
import { SignDialog } from "@/components/clinical/sign-dialog";
import { UploadForm } from "@/components/clinical/upload-form";
import { load } from "../../_lib/guard";
import {
  amendImagingReportAction,
  saveImagingReportAction,
  scheduleImagingAction,
  signImagingReportAction,
  startImagingAction,
} from "../actions";

export const metadata: Metadata = { title: "Imaging study" };

export default async function ImagingOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const ctx = await requireAuthContext();
  const { orderId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) notFound();
  const res = await load(ctx, `/imaging/${orderId}`, () => getImagingOrder(ctx, orderId));
  if (!res.ok) return res.kind === "notfound" ? notFound() : <Forbidden message={res.message} />;
  const o = res.data;
  const b = o.branchId;
  const write = can(ctx, "imaging.report.write", { branchId: b });
  const draft = o.imagingReports.find((r) => r.status === "DRAFT" && !r.amendsReportId);
  const signed = o.imagingReports.filter((r) => r.status === "SIGNED");
  const latest = signed[signed.length - 1];
  const name = `${o.patient.givenName} ${o.patient.familyName}`;
  return (
    <>
      <PageHeader
        title={o.imagingStudy?.name ?? o.description}
        description={`${o.ref} · ${name} · ${o.patient.mrn}`}
        back={{ href: "/imaging", label: "Imaging" }}
        actions={
          <Badge tone={o.status === "VERIFIED" ? "success" : "accent"}>{ORDER_STATUS_LABEL[o.status]}</Badge>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {write && (o.status === "ORDERED" || o.status === "SCHEDULED") && (
            <Card>
              <CardHeader title="Schedule & start" />
              <CardBody className="flex flex-wrap gap-2">
                <ActionDialog
                  action={scheduleImagingAction}
                  fixed={{ orderId: o.id }}
                  trigger={o.status === "SCHEDULED" ? "Reschedule" : "Schedule"}
                  title="Schedule examination"
                  submitLabel="Save"
                  successMessage="Scheduled."
                  fields={[
                    {
                      name: "date",
                      label: "Date",
                      type: "date",
                      required: true,
                      defaultValue: todayLocal(),
                      min: todayLocal(),
                    },
                    { name: "time", label: "Time", type: "time", required: true },
                  ]}
                />
                <ConfirmAction
                  action={startImagingAction}
                  fixed={{ orderId: o.id }}
                  trigger="Start examination"
                  triggerVariant="primary"
                  title="Start examination"
                  description={`Confirm patient identity (${name}, ${o.patient.mrn}) and, where relevant, pregnancy status before imaging.`}
                  submitLabel="Start"
                  successMessage="Examination started."
                />
              </CardBody>
            </Card>
          )}
          {write &&
            (o.status === "IN_PROGRESS" || o.status === "RESULTED") &&
            (!draft || draft.authorId === ctx.userId) && (
              <Card>
                <CardHeader title={draft ? "Report draft" : "Write report"} />
                <CardBody className="space-y-3">
                  <ActionForm
                    action={saveImagingReportAction}
                    fixed={{ orderId: o.id }}
                    submitLabel="Save draft"
                    successMessage="Report draft saved."
                    fields={[
                      {
                        name: "findings",
                        label: "Findings",
                        type: "textarea",
                        required: true,
                        defaultValue: draft?.findings,
                      },
                      {
                        name: "impression",
                        label: "Impression",
                        type: "textarea",
                        required: true,
                        defaultValue: draft?.impression,
                      },
                    ]}
                  />
                  {draft && can(ctx, "imaging.report.sign", { branchId: b }) && (
                    <SignDialog
                      action={signImagingReportAction}
                      input={{ reportId: draft.id }}
                      trigger="Sign report"
                      title="Sign imaging report"
                      statement="Signed reports are released to the requesting clinician and cannot be edited. Corrections are issued as amended reports."
                      successMessage="Report signed and released."
                    />
                  )}
                </CardBody>
              </Card>
            )}
          {signed.map((r) => (
            <Card key={r.id}>
              <CardHeader
                title={r.amendsReportId ? "Amended report" : "Report"}
                description={`Signed by ${r.signedBy?.displayName} · ${r.signedAt ? formatDateTime(r.signedAt) : ""}${r.amendmentReason ? ` · reason: ${r.amendmentReason}` : ""}`}
                actions={
                  r.id === latest?.id &&
                  can(ctx, "imaging.report.sign", { branchId: b }) && (
                    <ActionDialog
                      action={amendImagingReportAction}
                      fixed={{ reportId: r.id }}
                      trigger="Issue amended report"
                      triggerVariant="ghost"
                      title="Issue amended report"
                      description="The original stays on record. The requesting clinician is notified."
                      submitLabel="Sign amended report"
                      tone="danger"
                      successMessage="Amended report issued."
                      fields={[
                        {
                          name: "findings",
                          label: "Findings",
                          type: "textarea",
                          required: true,
                          defaultValue: r.findings,
                        },
                        {
                          name: "impression",
                          label: "Impression",
                          type: "textarea",
                          required: true,
                          defaultValue: r.impression,
                        },
                        { name: "reason", label: "Reason for amendment", type: "textarea", required: true },
                        {
                          name: "password",
                          label: "Your password (signature)",
                          type: "password",
                          required: true,
                        },
                      ]}
                    />
                  )
                }
              />
              <CardBody className="space-y-2 text-[14px]">
                <p className="whitespace-pre-wrap">{r.findings}</p>
                <p className="whitespace-pre-wrap font-medium">{r.impression}</p>
              </CardBody>
            </Card>
          ))}
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Request" />
            <CardBody>
              <DescriptionList
                className="sm:grid-cols-1"
                items={[
                  [
                    "Patient",
                    `${name} · ${o.patient.dateOfBirth ? formatAge(o.patient.dateOfBirth) : "age unknown"} · ${o.patient.sexAtBirth.toLowerCase()}`,
                  ],
                  [
                    "Modality / region",
                    `${o.imagingStudy?.modality.toLowerCase()} · ${o.imagingStudy?.bodyPart ?? "-"}`,
                  ],
                  ["Priority", o.priority.toLowerCase()],
                  ["Clinical indication", o.clinicalIndication],
                  ["Requested by", `${o.orderedBy.displayName} · ${formatDateTime(o.orderedAt)}`],
                  ["Scheduled", o.scheduledAt ? formatDateTime(o.scheduledAt) : null],
                ]}
              />
            </CardBody>
          </Card>
          {write && o.status !== "CANCELLED" && (
            <Card>
              <CardHeader title="Images & attachments" />
              <CardBody className="space-y-3">
                {o.documents.length > 0 && (
                  <ul className="space-y-1 text-[13px]">
                    {o.documents.map((d) => (
                      <li key={d.id}>
                        <a className="text-accent hover:underline" href={`/api/documents/${d.id}`}>
                          {d.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                <UploadForm orderId={o.id} defaultKind="IMAGING" />
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
