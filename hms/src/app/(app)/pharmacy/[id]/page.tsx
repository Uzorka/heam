import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { getPharmacyPrescription } from "@/server/domains/pharmacy/service";
import { formatAge, formatCalendarDate, formatDateTime, toLocalDateString } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Forbidden } from "@/components/ui/misc";
import { ActionDialog } from "@/components/forms/action-form";
import {
  RX_ITEM_STATUS,
  RX_STATUS_LABEL,
  medicationLabel,
  sigLine,
} from "@/components/clinical/prescription-list";
import { load } from "../../_lib/guard";
import { closeItemAction, reverseDispenseAction, verifyItemAction } from "../actions";
import { DispenseForm } from "./dispense-form";

export const metadata: Metadata = { title: "Prescription" };

export default async function PharmacyPrescriptionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await load(ctx, `/pharmacy/${id}`, () => getPharmacyPrescription(ctx, id));
  if (!res.ok) {
    if (res.kind === "notfound") notFound();
    return <Forbidden message={res.message} />;
  }
  const { rx, allergies, locations, stock } = res.data;
  const b = rx.branchId;
  const today = toLocalDateString(new Date());
  return (
    <>
      <Link prefetch={false} href="/pharmacy" className="text-[13px] text-muted hover:text-foreground">
        ← Pharmacy worklist
      </Link>
      <div className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">
            {rx.patient.givenName} {rx.patient.familyName}
          </h1>
          <p className="text-[13px] text-muted">
            <span className="font-mono">{rx.patient.mrn}</span> ·{" "}
            {rx.patient.dateOfBirth ? formatAge(rx.patient.dateOfBirth) : "age not recorded"} ·{" "}
            {rx.patient.sexAtBirth.toLowerCase()} · visit{" "}
            <span className="font-mono">{rx.encounter.ref}</span>
          </p>
          <p className="text-[13px] text-muted">
            <span className="font-mono">{rx.ref}</span> · {rx.prescriber.displayName}
            {rx.signedAt && <> · signed {formatDateTime(rx.signedAt)}</>}
          </p>
        </div>
        <Badge tone={rx.status === "SIGNED" ? "accent" : "outline"}>{RX_STATUS_LABEL[rx.status]}</Badge>
      </div>
      <div className="mb-4">
        {allergies.length ? (
          <Alert tone="danger" title="Recorded allergies">
            {allergies
              .map(
                (a) => `${a.substance}${a.reaction ? ` (${a.reaction})` : ""} - ${a.severity.toLowerCase()}`,
              )
              .join("; ")}
          </Alert>
        ) : (
          <Alert tone="info">
            No active allergies recorded. Ask the patient before dispensing. No automated interaction checking
            is configured.
          </Alert>
        )}
        {rx.notes && (
          <p className="mt-2 text-[14px]">
            <span className="text-muted">Prescriber note:</span> {rx.notes}
          </p>
        )}
      </div>
      <div className="space-y-4">
        {rx.items.map((item) => {
          const st = RX_ITEM_STATUS[item.status]!;
          const remaining = item.quantity - item.quantityDispensed;
          const productLots = stock.filter((s) => s.productId === item.medication.inventoryProductId);
          const canDispense =
            rx.status === "SIGNED" &&
            ["VERIFIED", "PARTIALLY_DISPENSED"].includes(item.status) &&
            can(ctx, "pharmacy.dispense", { branchId: b }) &&
            (!item.medication.controlled || can(ctx, "pharmacy.controlled.dispense", { branchId: b }));
          return (
            <Card key={item.id}>
              <CardHeader
                title={medicationLabel(item.medication)}
                description={`${sigLine(item)} · supply ${item.quantity} ${item.medication.dispensingUnit}(s)`}
                actions={
                  <span className="flex flex-wrap items-center gap-2">
                    {item.medication.controlled && <Badge tone="warning">Controlled</Badge>}
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </span>
                }
              />
              <CardBody className="space-y-3">
                {item.instructions && <p className="text-[14px]">Instructions: {item.instructions}</p>}
                {item.pharmacistNote && (
                  <p className="text-[14px] text-warning">Pharmacist note: {item.pharmacistNote}</p>
                )}
                {item.cancelReason && <p className="text-[14px] text-muted">Stopped: {item.cancelReason}</p>}
                {!item.medication.nafdacVerified && (
                  <p className="text-[13px] text-muted">
                    NAFDAC registration not yet verified in the catalogue.
                  </p>
                )}
                {rx.status === "SIGNED" &&
                  ["PENDING", "QUERIED"].includes(item.status) &&
                  can(ctx, "pharmacy.verify", { branchId: b }) && (
                    <div className="flex flex-wrap gap-2">
                      <ActionDialog
                        action={verifyItemAction}
                        fixed={{ itemId: item.id, version: item.version, decision: "VERIFY" }}
                        trigger="Verify"
                        triggerVariant="primary"
                        title="Verify this item"
                        description="Confirm the dose, route, frequency, quantity and allergy status are appropriate."
                        submitLabel="Verify"
                        successMessage="Item verified."
                        fields={[{ name: "note", label: "Note (optional)", type: "textarea" }]}
                      />
                      {item.status === "PENDING" && (
                        <ActionDialog
                          action={verifyItemAction}
                          fixed={{ itemId: item.id, version: item.version, decision: "QUERY" }}
                          trigger="Query prescriber"
                          title="Query the prescriber"
                          description="The prescriber is notified. The item stays on hold until verified or cancelled."
                          submitLabel="Send query"
                          successMessage="Query recorded and prescriber notified."
                          fields={[{ name: "note", label: "Query", type: "textarea", required: true }]}
                        />
                      )}
                    </div>
                  )}
                {canDispense && remaining > 0 && (
                  <DispenseForm
                    itemId={item.id}
                    remaining={remaining}
                    unit={item.medication.dispensingUnit}
                    locations={locations.map((l) => ({ id: l.id, name: l.name }))}
                    lots={productLots.map((l) => ({
                      lotId: l.lotId,
                      locationId: l.locationId,
                      quantity: l.quantity,
                      problem: l.problem,
                      label: `${l.lotNumber}${l.expiryDate ? ` exp ${formatCalendarDate(l.expiryDate)}` : ""}`,
                    }))}
                  />
                )}
                {item.medication.controlled &&
                  ["VERIFIED", "PARTIALLY_DISPENSED"].includes(item.status) &&
                  !can(ctx, "pharmacy.controlled.dispense", { branchId: b }) && (
                    <Alert tone="warning">
                      Controlled drug: a pharmacist with controlled-drug rights must dispense this.
                    </Alert>
                  )}
                {item.dispenses.length > 0 && (
                  <ul className="space-y-1 text-[13px]">
                    {item.dispenses.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2">
                        <span>
                          {d.quantity} from lot <span className="font-mono">{d.lot.lotNumber}</span>
                          {d.lot.expiryDate && ` (exp ${formatCalendarDate(d.lot.expiryDate)})`} ·{" "}
                          {formatDateTime(d.dispensedAt)}
                          {d.counsellingGiven ? " · counselled" : ""}
                        </span>
                        {d.reversedAt ? (
                          <Badge tone="outline">Reversed: {d.reversalReason}</Badge>
                        ) : (
                          toLocalDateString(d.dispensedAt) === today &&
                          rx.status !== "CANCELLED" &&
                          can(ctx, "pharmacy.dispense", { branchId: b }) && (
                            <ActionDialog
                              action={reverseDispenseAction}
                              fixed={{ dispenseId: d.id }}
                              trigger="Reverse"
                              triggerVariant="ghost"
                              title="Reverse this dispense"
                              description="Use only when the medicine is returned unused today. Stock returns to the same lot."
                              submitLabel="Reverse"
                              tone="danger"
                              successMessage="Dispense reversed and stock returned."
                              fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
                            />
                          )
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {rx.status === "SIGNED" &&
                  ["VERIFIED", "PARTIALLY_DISPENSED", "QUERIED", "PENDING"].includes(item.status) &&
                  can(ctx, "pharmacy.dispense", { branchId: b }) && (
                    <ActionDialog
                      action={closeItemAction}
                      fixed={{ itemId: item.id }}
                      trigger="Stop supplying"
                      triggerVariant="ghost"
                      title="Stop supplying this item"
                      description="Closes the undispensed balance (e.g. patient declined or will buy elsewhere). The prescriber is notified."
                      submitLabel="Stop supplying"
                      tone="danger"
                      successMessage="Item closed and prescriber notified."
                      fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
                    />
                  )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </>
  );
}
