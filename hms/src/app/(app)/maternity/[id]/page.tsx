import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { getPregnancy } from "@/server/domains/maternity/service";
import { formatAge, formatCalendarDate, formatDateTime, todayLocal } from "@/lib/time";
import { formatGestation } from "@/lib/obstetrics";
import { statusText } from "@/lib/billing-labels";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog, ConfirmAction } from "@/components/forms/action-form";
import { FlagBadge } from "@/components/clinical/flag-badge";
import { load } from "../../_lib/guard";
import {
  adoptDatingAction,
  addDatingAction,
  ancErrorAction,
  ancVisitAction,
  endPregnancyAction,
  postnatalAction,
} from "../actions";
import { DeliveryForm } from "./delivery-form";

export const metadata: Metadata = { title: "Pregnancy record" };

const DATING: Record<string, string> = {
  LMP: "LMP",
  ULTRASOUND: "Ultrasound",
  ASSISTED_CONCEPTION: "Assisted conception",
  OTHER: "Other",
};

const MODE: Record<string, string> = {
  SVD: "Spontaneous vaginal",
  ASSISTED_VACUUM: "Assisted (vacuum)",
  ASSISTED_FORCEPS: "Assisted (forceps)",
  BREECH: "Vaginal breech",
  CAESAREAN_EMERGENCY: "Emergency caesarean",
  CAESAREAN_ELECTIVE: "Elective caesarean",
};

export default async function PregnancyPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await load(ctx, `/maternity/${id}`, () => getPregnancy(ctx, id));
  if (!res.ok) {
    if (res.kind === "notfound") notFound();
    return <Forbidden message={res.message} />;
  }
  const { ep, patient, dating, anc, deliveries, postnatal, gaToday } = res.data;
  const write = can(ctx, "maternity.write");
  const sign = can(ctx, "maternity.delivery.sign");
  const active = ep.status === "ACTIVE";
  const today = todayLocal();
  const motherAdmitted = !!(await prisma.admission.findFirst({
    where: { patientId: patient.id, status: { in: ["ADMITTED", "DISCHARGE_AUTHORISED"] } },
    select: { id: true },
  }));
  const babies = deliveries.flatMap((d) => d.newborns.filter((n) => n.baby).map((n) => n.baby!));
  return (
    <>
      <Link
        prefetch={false}
        href={`/patients/${patient.id}?tab=maternity`}
        className="text-[13px] text-muted hover:text-foreground"
      >
        ← Patient record
      </Link>
      <PageHeader
        title={`${patient.givenName} ${patient.familyName} - pregnancy ${ep.ref}`}
        description={
          <>
            <span className="font-mono">{patient.mrn}</span> ·{" "}
            {patient.dateOfBirth ? formatAge(patient.dateOfBirth) : "age not recorded"} · G{ep.gravida} P
            {ep.para} · booked {formatCalendarDate(ep.bookingDate)}
            {ep.bloodGroup && ` · blood group ${ep.bloodGroup}`}
          </>
        }
        actions={
          <>
            <Badge tone={active ? "accent" : ep.status === "DELIVERED" ? "success" : "outline"}>
              {statusText(ep.status)}
            </Badge>
            {active && write && (
              <ActionDialog
                action={endPregnancyAction}
                fixed={{ episodeId: ep.id }}
                trigger="Close record"
                triggerVariant="ghost"
                title="Close this pregnancy record without a delivery"
                description="e.g. miscarriage, transfer of care, or recorded in error. The record is kept."
                submitLabel="Close record"
                tone="danger"
                successMessage="Pregnancy record closed."
                fields={[{ name: "reason", label: "Outcome / reason", type: "textarea", required: true }]}
              />
            )}
          </>
        }
      />
      {ep.riskNotes && (
        <Alert tone="warning" title="Recorded risk factors" className="mb-4">
          {ep.riskNotes}
        </Alert>
      )}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-[13px] text-muted">Estimated date of delivery</p>
            <p className="text-xl font-semibold">{ep.edd ? formatCalendarDate(ep.edd) : "Not dated"}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-[13px] text-muted">Gestation today</p>
            <p className="text-xl font-semibold">{active ? formatGestation(gaToday) : "—"}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-[13px] text-muted">Antenatal visits</p>
            <p className="text-xl font-semibold">{anc.filter((a) => !a.enteredInErrorAt).length}</p>
          </CardBody>
        </Card>
      </div>
      <Card className="mb-5">
        <CardHeader
          title="Dating"
          description="Each method's EDD is shown; only the one a clinician adopts is used."
          actions={
            active &&
            write && (
              <ActionDialog
                action={addDatingAction}
                fixed={{ episodeId: ep.id }}
                trigger="Add dating"
                title="Record pregnancy dating"
                description="LMP: give the first day of the last period. Ultrasound: the scan date and gestation measured. Other: enter the EDD and explain."
                submitLabel="Save"
                successMessage="Dating recorded."
                fields={[
                  {
                    name: "method",
                    label: "Method",
                    type: "select",
                    required: true,
                    defaultValue: "LMP",
                    options: [
                      { value: "LMP", label: "Last menstrual period" },
                      { value: "ULTRASOUND", label: "Ultrasound" },
                      { value: "ASSISTED_CONCEPTION", label: "Assisted conception" },
                      { value: "OTHER", label: "Other" },
                    ],
                  },
                  { name: "lmp", label: "LMP (first day)", type: "date", max: today },
                  { name: "scanDate", label: "Scan date", type: "date", max: today },
                  { name: "gaWeeks", label: "Gestation at scan - weeks", type: "number" },
                  { name: "gaExtraDays", label: "Gestation at scan - extra days", type: "number" },
                  { name: "edd", label: "EDD (assisted conception / other)", type: "date" },
                  { name: "note", label: "Note", type: "textarea" },
                  { name: "adopt", label: "Adopt this as the pregnancy's EDD", type: "checkbox" },
                ]}
              />
            )
          }
        />
        {dating.length === 0 ? (
          <EmptyState title="Not dated yet" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Method</TH>
                  <TH>Details</TH>
                  <TH>EDD</TH>
                  <TH>Recorded</TH>
                  <TH>
                    <span className="sr-only">Adopt</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {dating.map((d) => (
                  <TR key={d.id}>
                    <TD>{DATING[d.method]}</TD>
                    <TD className="text-[13px]">
                      {d.lmp && `LMP ${formatCalendarDate(d.lmp)}`}
                      {d.scanDate &&
                        `Scan ${formatCalendarDate(d.scanDate)} at ${formatGestation(d.gaAtScanDays)}`}
                      {d.note && <span className="block text-muted">{d.note}</span>}
                    </TD>
                    <TD className="font-medium">{formatCalendarDate(d.edd)}</TD>
                    <TD className="text-[13px]">{formatDateTime(d.recordedAt)}</TD>
                    <TD className="text-right">
                      {d.adopted ? (
                        <Badge tone="success">adopted</Badge>
                      ) : (
                        active &&
                        write && (
                          <ConfirmAction
                            action={adoptDatingAction}
                            fixed={{ datingId: d.id }}
                            trigger="Adopt"
                            triggerVariant="ghost"
                            title={`Adopt EDD ${formatCalendarDate(d.edd)}?`}
                            description="Gestation on later visits is calculated from the adopted EDD."
                            submitLabel="Adopt"
                            successMessage="EDD adopted."
                          />
                        )
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
      <Card className="mb-5">
        <CardHeader
          title="Antenatal visits"
          description="Blood pressure flags appear only from approved thresholds."
          actions={
            active &&
            write && (
              <ActionDialog
                action={ancVisitAction}
                fixed={{ episodeId: ep.id }}
                trigger="Record ANC visit"
                triggerVariant="primary"
                title="Antenatal visit"
                submitLabel="Save"
                successMessage="Antenatal visit recorded."
                fields={[
                  {
                    name: "visitDate",
                    label: "Visit date",
                    type: "date",
                    required: true,
                    defaultValue: today,
                    max: today,
                  },
                  { name: "weightKg", label: "Weight (kg)", type: "number" },
                  { name: "systolicMmHg", label: "Systolic BP (mmHg)", type: "number" },
                  { name: "diastolicMmHg", label: "Diastolic BP (mmHg)", type: "number" },
                  { name: "fundalHeightCm", label: "Fundal height (cm)", type: "number" },
                  { name: "fetalHeartRate", label: "Fetal heart rate (bpm)", type: "number" },
                  { name: "presentation", label: "Presentation", type: "text" },
                  { name: "urineProtein", label: "Urine protein", type: "text" },
                  { name: "oedema", label: "Oedema", type: "text" },
                  { name: "notes", label: "Notes", type: "textarea" },
                ]}
              />
            )
          }
        />
        {anc.length === 0 ? (
          <EmptyState title="No antenatal visits yet" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>GA</TH>
                  <TH>Weight</TH>
                  <TH>BP</TH>
                  <TH>Fundal ht</TH>
                  <TH>FHR</TH>
                  <TH>Other</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {anc.map((v) => (
                  <TR key={v.id} className={v.enteredInErrorAt ? "opacity-50" : undefined}>
                    <TD
                      className={`whitespace-nowrap text-[13px] ${v.enteredInErrorAt ? "line-through" : ""}`}
                    >
                      {formatCalendarDate(v.visitDate)}
                    </TD>
                    <TD className="text-[13px]">{formatGestation(v.gestationDays)}</TD>
                    <TD>{v.weightKg ? `${Number(v.weightKg)} kg` : "—"}</TD>
                    <TD className="whitespace-nowrap">
                      {v.systolicMmHg ? `${v.systolicMmHg}/${v.diastolicMmHg ?? "?"}` : "—"}{" "}
                      <FlagBadge flag={v.flags.systolicMmHg ?? v.flags.diastolicMmHg} />
                    </TD>
                    <TD>{v.fundalHeightCm ? `${Number(v.fundalHeightCm)} cm` : "—"}</TD>
                    <TD>{v.fetalHeartRate ?? "—"}</TD>
                    <TD className="text-[13px]">
                      {[
                        v.presentation,
                        v.urineProtein && `urine protein ${v.urineProtein}`,
                        v.oedema && `oedema ${v.oedema}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      {v.notes && <span className="block text-muted">{v.notes}</span>}
                      {v.enteredInErrorAt && (
                        <span className="block text-muted">Entered in error: {v.errorReason}</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      {!v.enteredInErrorAt && write && (
                        <ActionDialog
                          action={ancErrorAction}
                          fixed={{ id: v.id }}
                          trigger="Error"
                          triggerVariant="ghost"
                          title="Mark visit as entered in error"
                          submitLabel="Mark"
                          tone="danger"
                          successMessage="Marked as entered in error."
                          fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
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
      {active && sign && (
        <Card className="mb-5">
          <CardHeader title="Record delivery" />
          <CardBody>
            <DeliveryForm episodeId={ep.id} today={today} motherAdmitted={motherAdmitted} />
          </CardBody>
        </Card>
      )}
      {deliveries.map((d) => (
        <Card key={d.id} className="mb-5">
          <CardHeader
            title={`Delivery ${d.ref}`}
            description={`${MODE[d.mode]} · ${formatDateTime(d.deliveredAt)}${d.gestationDays ? ` · ${formatGestation(d.gestationDays)}` : ""} · signed ${d.signedAt ? formatDateTime(d.signedAt) : ""}`}
          />
          <CardBody className="space-y-2 text-[14px]">
            <p className="text-[13px] text-muted">
              {[
                d.bloodLossMl !== null && `EBL ${d.bloodLossMl} mL`,
                d.placentaComplete !== null && `placenta ${d.placentaComplete ? "complete" : "incomplete"}`,
                d.perineum && `perineum: ${d.perineum}`,
                d.attendants && `attendants: ${d.attendants}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {d.complications && <p>{d.complications}</p>}
            <ul className="divide-y divide-border rounded-md border border-border">
              {d.newborns.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                  <span>
                    Baby {n.birthOrder}: {statusText(n.outcome)} · {n.sex.toLowerCase()} ·{" "}
                    {formatDateTime(n.birthAt)}
                    {n.birthWeightG && ` · ${n.birthWeightG} g`}
                    {n.apgar1 !== null && ` · Apgar ${n.apgar1}/${n.apgar5 ?? "?"}`}
                  </span>
                  {n.baby && (
                    <Link
                      prefetch={false}
                      href={`/patients/${n.baby.id}`}
                      className="text-accent hover:underline"
                    >
                      {n.baby.givenName} {n.baby.familyName}
                      {n.baby.preferredName && ` (${n.baby.preferredName})`} ·{" "}
                      <span className="font-mono">{n.baby.mrn}</span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ))}
      {ep.status === "DELIVERED" && (
        <Card>
          <CardHeader
            title="Postnatal care"
            actions={
              write && (
                <ActionDialog
                  action={postnatalAction}
                  fixed={{ episodeId: ep.id }}
                  trigger="Record postnatal check"
                  title="Postnatal check"
                  submitLabel="Save"
                  successMessage="Postnatal check recorded."
                  fields={[
                    {
                      name: "subject",
                      label: "For",
                      type: "select",
                      required: true,
                      defaultValue: "MOTHER",
                      options: [
                        { value: "MOTHER", label: "Mother" },
                        { value: "BABY", label: "Baby" },
                      ],
                    },
                    {
                      name: "babyPatientId",
                      label: "Which baby (if for a baby)",
                      type: "select",
                      options: babies.map((b) => ({
                        value: b.id,
                        label: `${b.givenName} ${b.familyName}${b.preferredName ? ` (${b.preferredName})` : ""} - ${b.mrn}`,
                      })),
                    },
                    {
                      name: "visitDate",
                      label: "Date",
                      type: "date",
                      required: true,
                      defaultValue: today,
                      max: today,
                    },
                    { name: "temperatureC", label: "Temperature (°C)", type: "number" },
                    { name: "systolicMmHg", label: "Systolic BP", type: "number" },
                    { name: "diastolicMmHg", label: "Diastolic BP", type: "number" },
                    { name: "weightG", label: "Weight (g)", type: "number" },
                    { name: "feeding", label: "Feeding", type: "text" },
                    { name: "findings", label: "Findings", type: "textarea", required: true },
                    { name: "plan", label: "Plan", type: "textarea" },
                  ]}
                />
              )
            }
          />
          {postnatal.length === 0 ? (
            <EmptyState title="No postnatal checks yet" />
          ) : (
            <CardBody>
              <ul className="space-y-2 text-[14px]">
                {postnatal.map((p) => {
                  const baby = babies.find((b) => b.id === p.babyPatientId);
                  return (
                    <li key={p.id}>
                      <span className="font-medium">{formatCalendarDate(p.visitDate)}</span> ·{" "}
                      {baby ? `${baby.givenName} ${baby.preferredName ?? ""}`.trim() : "Mother"}
                      {p.temperatureC && ` · ${Number(p.temperatureC)} °C`}
                      {p.systolicMmHg && ` · BP ${p.systolicMmHg}/${p.diastolicMmHg ?? "?"}`}
                      {p.weightG && ` · ${p.weightG} g`}
                      {p.feeding && ` · ${p.feeding}`}
                      <span className="block">{p.findings}</span>
                      {p.plan && <span className="block text-muted">Plan: {p.plan}</span>}
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          )}
        </Card>
      )}
    </>
  );
}
