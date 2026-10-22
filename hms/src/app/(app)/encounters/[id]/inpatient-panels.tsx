import Link from "next/link";
import type { Encounter } from "@prisma/client";
import { can, type AuthContext } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { availableBeds, marForEncounter } from "@/server/domains/inpatient/service";
import { formatDateTime } from "@/lib/time";
import { statusText } from "@/lib/billing-labels";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/misc";
import { ActionDialog, type FieldSpec } from "@/components/forms/action-form";
import { admitAction, marAction, marErrorAction } from "../../wards/actions";
import { medicationLabel, sigLine } from "@/components/clinical/prescription-list";

type Enc = Pick<Encounter, "id" | "branchId" | "status">;

/** Inpatient status line, or an Admit button for open outpatient visits. */
export async function AdmissionStrip({ ctx, enc }: { ctx: AuthContext; enc: Enc }) {
  const adm = await prisma.admission.findUnique({
    where: { encounterId: enc.id },
    include: {
      assignments: {
        where: { endAt: null },
        include: { bed: { include: { ward: { select: { name: true } } } } },
      },
    },
  });
  if (adm) {
    const bed = adm.assignments[0]?.bed;
    return (
      <Alert tone="info" title={`Inpatient - ${statusText(adm.status)}`}>
        Stay{" "}
        <Link
          prefetch={false}
          href={`/admissions/${adm.id}`}
          className="font-mono text-accent hover:underline"
        >
          {adm.ref}
        </Link>{" "}
        · {bed ? `${bed.ward.name}, ${bed.label}` : "no bed assigned"} · since{" "}
        {formatDateTime(adm.admittedAt)}
      </Alert>
    );
  }
  if (enc.status !== "OPEN" || !can(ctx, "admission.manage", { branchId: enc.branchId })) return null;
  const [wards, beds] = await Promise.all([
    prisma.ward.findMany({
      where: { branchId: enc.branchId, active: true },
      orderBy: { code: "asc" },
      select: { id: true, name: true },
    }),
    availableBeds({ ...ctx, activeBranchId: enc.branchId }),
  ]);
  if (!wards.length) return null;
  return (
    <div>
      <ActionDialog
        action={admitAction}
        fixed={{ encounterId: enc.id }}
        trigger="Admit"
        title="Admit this patient"
        description="The visit becomes an inpatient stay; notes, orders and prescriptions continue on it."
        submitLabel="Admit"
        successMessage="Patient admitted."
        fields={[
          {
            name: "wardId",
            label: "Ward",
            type: "select",
            required: true,
            options: wards.map((w) => ({ value: w.id, label: w.name })),
          },
          {
            name: "bedId",
            label: "Bed (optional - must be in the chosen ward)",
            type: "select",
            options: beds.map((b) => ({ value: b.id, label: `${b.ward.name} - ${b.label}` })),
          },
          { name: "reason", label: "Reason for admission", type: "textarea", required: true },
        ]}
      />
    </div>
  );
}

/** Medication administration record for an inpatient stay. */
export async function MarPanel({ ctx, enc }: { ctx: AuthContext; enc: Enc }) {
  const adm = await prisma.admission.findUnique({
    where: { encounterId: enc.id },
    select: { id: true, status: true },
  });
  if (!adm) return null;
  const { items, who } = await marForEncounter(enc.id);
  const canRecord = can(ctx, "nursing.mar.record", { branchId: enc.branchId }) && adm.status !== "DISCHARGED";
  return (
    <Card>
      <CardHeader
        title="Medication administration (MAR)"
        description="Each dose given, held or refused is recorded with the time and who did it. Controlled drugs need a witness."
      />
      {items.length === 0 ? (
        <EmptyState title="No active prescriptions on this stay" />
      ) : (
        <CardBody className="space-y-3">
          {items.map((i) => {
            const fields: FieldSpec[] = [
              {
                name: "status",
                label: "Outcome",
                type: "select",
                required: true,
                defaultValue: "GIVEN",
                options: [
                  { value: "GIVEN", label: "Given" },
                  { value: "HELD", label: "Held" },
                  { value: "REFUSED", label: "Refused by patient" },
                  { value: "NOT_AVAILABLE", label: "Not available" },
                ],
              },
              { name: "doseGiven", label: "Dose given", type: "text", defaultValue: i.dose },
              { name: "route", label: "Route", type: "text", defaultValue: i.route },
              { name: "reason", label: "Reason (if not given)", type: "textarea" },
              ...(i.medication.controlled
                ? ([
                    { name: "witnessEmail", label: "Witness email", type: "email", required: true },
                    { name: "witnessPassword", label: "Witness password", type: "password", required: true },
                  ] satisfies FieldSpec[])
                : []),
            ];
            return (
              <section key={i.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="text-[14px]">
                    <p className="font-medium">
                      {medicationLabel(i.medication)}{" "}
                      {i.medication.controlled && <Badge tone="warning">controlled</Badge>}
                    </p>
                    <p className="text-[13px] text-muted">
                      {sigLine(i)} · {i.prescription.ref}
                    </p>
                  </div>
                  {canRecord && (
                    <ActionDialog
                      action={marAction}
                      fixed={{ prescriptionItemId: i.id, encounterId: enc.id }}
                      trigger="Record dose"
                      title={`Record administration: ${i.medication.genericName}`}
                      submitLabel="Record"
                      successMessage="Administration recorded."
                      fields={fields}
                    />
                  )}
                </div>
                {i.administrations.length > 0 && (
                  <ul className="mt-2 space-y-1 text-[13px]">
                    {i.administrations.map((a) => (
                      <li key={a.id} className={a.enteredInErrorAt ? "text-muted line-through" : undefined}>
                        {formatDateTime(a.administeredAt)} ·{" "}
                        <Badge tone={a.status === "GIVEN" ? "success" : "warning"}>
                          {statusText(a.status)}
                        </Badge>{" "}
                        {a.doseGiven} {a.route} · {who(a.recordedById)}
                        {a.witnessedById && ` · witness ${who(a.witnessedById)}`}
                        {a.reason && ` · ${a.reason}`}
                        {!a.enteredInErrorAt && a.recordedById === ctx.userId && (
                          <span className="ml-1 inline-block">
                            <ActionDialog
                              action={marErrorAction}
                              fixed={{ id: a.id }}
                              trigger="Entered in error"
                              triggerVariant="ghost"
                              title="Mark this entry as entered in error"
                              submitLabel="Mark"
                              tone="danger"
                              successMessage="Marked as entered in error."
                              fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
                            />
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </CardBody>
      )}
    </Card>
  );
}
