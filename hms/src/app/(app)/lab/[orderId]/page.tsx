import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { getLabOrder, toRangeLike } from "@/server/domains/lab/service";
import { referenceText, selectRange } from "@/server/domains/lab/flags";
import { formatAge, formatDateTime } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { DescriptionList, Forbidden, PageHeader } from "@/components/ui/misc";
import { ActionDialog, ConfirmAction } from "@/components/forms/action-form";
import { FlagBadge, ORDER_STATUS_LABEL } from "@/components/clinical/flag-badge";
import { SignDialog } from "@/components/clinical/sign-dialog";
import { UploadForm } from "@/components/clinical/upload-form";
import { load } from "../../_lib/guard";
import {
  amendResultAction,
  collectSpecimenAction,
  receiveSpecimenAction,
  rejectSpecimenAction,
  returnResultsAction,
  verifyResultsAction,
} from "../actions";
import { ResultsForm } from "./results-form";
import { SpecimenLabel } from "./label";

export const metadata: Metadata = { title: "Lab order" };

export default async function LabOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const ctx = await requireAuthContext();
  const { orderId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) notFound();
  const res = await load(ctx, `/lab/${orderId}`, () => getLabOrder(ctx, orderId));
  if (!res.ok) return res.kind === "notfound" ? notFound() : <Forbidden message={res.message} />;
  const o = res.data;
  const b = o.branchId;
  const test = o.labTest!;
  const current = o.specimens[0];
  const drafts = o.results.filter((r) => r.status === "DRAFT");
  const finals = o.results.filter((r) => r.status === "FINAL");
  const documents = await prisma.document.findMany({
    where: { orderId: o.id, voidedAt: null },
    orderBy: { uploadedAt: "asc" },
  });
  const ageDays = o.patient.dateOfBirth
    ? Math.floor((Date.now() - o.patient.dateOfBirth.getTime()) / 86_400_000)
    : null;
  const patientName = `${o.patient.givenName} ${o.patient.familyName}`;

  return (
    <>
      <PageHeader
        title={test.name}
        description={`${o.ref} · ${patientName} · ${o.patient.mrn}`}
        back={{ href: "/lab", label: "Laboratory" }}
        actions={
          <Badge tone={o.status === "VERIFIED" ? "success" : o.status === "CANCELLED" ? "outline" : "accent"}>
            {ORDER_STATUS_LABEL[o.status]}
          </Badge>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {o.status === "CANCELLED" && (
            <Alert tone="warning">This order was cancelled: {o.cancelReason}. It cannot be processed.</Alert>
          )}

          {o.status === "ORDERED" && can(ctx, "lab.specimen.collect", { branchId: b }) && (
            <Card>
              <CardHeader
                title="Collect specimen"
                description={`${test.specimenType}. Check two identifiers (name and MRN) before collecting.`}
              />
              <CardBody>
                {o.specimens.some((s) => s.status === "REJECTED") && (
                  <Alert tone="warning" className="mb-3">
                    Previous specimen rejected:{" "}
                    {o.specimens.find((s) => s.status === "REJECTED")?.rejectionReason}. Recollect.
                  </Alert>
                )}
                <ConfirmAction
                  action={collectSpecimenAction}
                  fixed={{ orderId: o.id, version: o.version }}
                  trigger="Record collection"
                  triggerVariant="primary"
                  title="Record specimen collection"
                  description={`Collected now from ${patientName} (${o.patient.mrn}). An accession number and label will be generated.`}
                  submitLabel="Record collection"
                  successMessage="Specimen collected."
                />
              </CardBody>
            </Card>
          )}

          {current && current.status !== "REJECTED" && (
            <Card>
              <CardHeader
                title="Specimen"
                description={`Collected ${formatDateTime(current.collectedAt)}${current.receivedAt ? ` · received ${formatDateTime(current.receivedAt)}` : ""}`}
              />
              <CardBody className="space-y-3">
                <SpecimenLabel
                  accession={current.accession}
                  patient={patientName}
                  mrn={o.patient.mrn}
                  test={test.name}
                  collectedAt={formatDateTime(current.collectedAt)}
                />
                <div className="flex flex-wrap gap-2">
                  {current.status === "COLLECTED" && can(ctx, "lab.specimen.collect", { branchId: b }) && (
                    <ConfirmAction
                      action={receiveSpecimenAction}
                      fixed={{ specimenId: current.id }}
                      trigger="Receive in lab"
                      triggerVariant="primary"
                      title="Receive specimen"
                      description="Confirm the label matches the request and the specimen is acceptable."
                      submitLabel="Receive"
                      successMessage="Specimen received."
                    />
                  )}
                  {["SPECIMEN_COLLECTED", "IN_PROGRESS"].includes(o.status) &&
                    can(ctx, "lab.specimen.collect", { branchId: b }) && (
                      <ActionDialog
                        action={rejectSpecimenAction}
                        fixed={{ specimenId: current.id }}
                        trigger="Reject specimen"
                        triggerVariant="ghost"
                        title="Reject specimen"
                        description="The order returns to 'to collect' and the requesting clinician is notified."
                        submitLabel="Reject"
                        tone="danger"
                        successMessage="Specimen rejected; recollection requested."
                        fields={[
                          {
                            name: "reason",
                            label: "Reason",
                            type: "select",
                            required: true,
                            options: [
                              "Haemolysed",
                              "Clotted",
                              "Insufficient volume",
                              "Wrong container",
                              "Unlabelled / mislabelled",
                              "Delayed transport",
                            ].map((v) => ({ value: v, label: v })),
                          },
                        ]}
                      />
                    )}
                </div>
              </CardBody>
            </Card>
          )}

          {o.status === "IN_PROGRESS" && can(ctx, "lab.result.enter", { branchId: b }) && (
            <Card>
              <CardHeader
                title="Enter results"
                description="Flags come only from clinician-approved reference ranges for the patient's sex and age."
              />
              <CardBody>
                <ResultsForm
                  orderId={o.id}
                  components={test.components.map((c) => ({
                    id: c.id,
                    name: c.name,
                    unit: c.unit,
                    resultType: c.resultType,
                    decimals: c.decimals,
                    allowedValues: c.allowedValues,
                    reference: referenceText(
                      selectRange(c.ranges.map(toRangeLike), o.patient.sexAtBirth, ageDays),
                      c.unit,
                    ),
                    draft: drafts.find((d) => d.componentId === c.id)?.valueText ?? "",
                  }))}
                />
              </CardBody>
            </Card>
          )}

          {(drafts.length > 0 || finals.length > 0) && (
            <Card>
              <CardHeader title={o.status === "RESULTED" ? "Results awaiting verification" : "Results"} />
              <CardBody className="space-y-3">
                <table className="w-full text-[14px]">
                  <caption className="sr-only">Results</caption>
                  <thead className="text-left text-xs uppercase text-muted">
                    <tr>
                      <th scope="col" className="py-1 font-medium">
                        Component
                      </th>
                      <th scope="col" className="py-1 font-medium">
                        Result
                      </th>
                      <th scope="col" className="py-1 font-medium">
                        Reference
                      </th>
                      <th scope="col" className="py-1 font-medium">
                        Flag
                      </th>
                      <th scope="col" className="py-1 font-medium">
                        Status
                      </th>
                      <th scope="col" className="py-1">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...finals, ...drafts].map((r) => {
                      const comp = test.components.find((c) => c.id === r.componentId)!;
                      return (
                        <tr
                          key={r.id}
                          className={`border-t border-border ${r.supersededAt ? "text-muted line-through" : ""}`}
                        >
                          <td className="py-1.5">{comp.name}</td>
                          <td className="tabular py-1.5 font-medium">
                            {r.valueText} {r.unit}
                            {r.amendmentReason && (
                              <span className="block text-xs font-normal text-warning no-underline">
                                Amended: {r.amendmentReason}
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 text-[13px] text-muted">{r.referenceText ?? "-"}</td>
                          <td className="py-1.5">
                            <FlagBadge flag={r.flag} />
                          </td>
                          <td className="py-1.5 text-xs text-muted">
                            {r.status === "DRAFT"
                              ? `Entered by ${r.enteredBy.displayName}`
                              : r.supersededAt
                                ? "Superseded"
                                : `Verified by ${r.verifiedBy?.displayName}`}
                          </td>
                          <td className="py-1.5 text-right">
                            {r.status === "FINAL" &&
                              !r.supersededAt &&
                              can(ctx, "lab.result.verify", { branchId: b }) && (
                                <ActionDialog
                                  action={amendResultAction}
                                  fixed={{ resultId: r.id }}
                                  trigger="Amend"
                                  triggerVariant="ghost"
                                  title={`Amend ${comp.name}`}
                                  description="The original value stays on record as superseded. The requesting clinician is notified and must review again."
                                  submitLabel="Sign amendment"
                                  tone="danger"
                                  successMessage="Result amended."
                                  fields={[
                                    comp.resultType === "CODED"
                                      ? {
                                          name: "value",
                                          label: "Corrected value",
                                          type: "select",
                                          required: true,
                                          options: comp.allowedValues.map((a) => ({ value: a, label: a })),
                                        }
                                      : {
                                          name: "value",
                                          label: `Corrected value${comp.unit ? ` (${comp.unit})` : ""}`,
                                          type: "text",
                                          required: true,
                                        },
                                    {
                                      name: "reason",
                                      label: "Reason for amendment",
                                      type: "textarea",
                                      required: true,
                                    },
                                    {
                                      name: "password",
                                      label: "Your password (signature)",
                                      type: "password",
                                      required: true,
                                    },
                                  ]}
                                />
                              )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {o.status === "RESULTED" && can(ctx, "lab.result.verify", { branchId: b }) && (
                  <div className="flex flex-wrap gap-2">
                    <SignDialog
                      action={verifyResultsAction}
                      input={{ orderId: o.id }}
                      trigger="Verify & release"
                      title="Verify results"
                      statement="You confirm these results are correct and release them to the requesting clinician. Verified results can only be changed by a signed amendment."
                      successMessage="Results verified and released."
                    />
                    <ActionDialog
                      action={returnResultsAction}
                      fixed={{ orderId: o.id }}
                      trigger="Return for correction"
                      triggerVariant="ghost"
                      title="Return for correction"
                      submitLabel="Return"
                      successMessage="Returned for correction."
                      fields={[
                        { name: "reason", label: "What needs checking?", type: "textarea", required: true },
                      ]}
                    />
                  </div>
                )}
              </CardBody>
            </Card>
          )}
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
                    `${patientName} · ${o.patient.dateOfBirth ? formatAge(o.patient.dateOfBirth) : "age unknown"} · ${o.patient.sexAtBirth.toLowerCase()}`,
                  ],
                  ["Priority", o.priority.toLowerCase()],
                  ["Clinical indication", o.clinicalIndication],
                  ["Requested by", `${o.orderedBy.displayName} · ${formatDateTime(o.orderedAt)}`],
                  ["Specimen", test.specimenType],
                  ["Expected turnaround", test.turnaroundHours ? `${test.turnaroundHours} h` : null],
                ]}
              />
            </CardBody>
          </Card>
          {can(ctx, "lab.result.enter", { branchId: b }) && o.status !== "CANCELLED" && (
            <Card>
              <CardHeader
                title="Attachments"
                description="e.g. analyser printout or report from a referral lab"
              />
              <CardBody className="space-y-3">
                {documents.length > 0 && (
                  <ul className="space-y-1 text-[13px]">
                    {documents.map((d) => (
                      <li key={d.id}>
                        <a className="text-accent hover:underline" href={`/api/documents/${d.id}`}>
                          {d.title}
                        </a>
                        <span className="text-muted">
                          {" "}
                          · {d.source === "EXTERNAL" ? `external (${d.sourceDescription})` : "internal"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <UploadForm orderId={o.id} defaultKind="LAB_REPORT" />
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
