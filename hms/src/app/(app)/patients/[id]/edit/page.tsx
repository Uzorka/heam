import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { loadScopedPatient } from "@/server/domains/patients/service";
import { NIGERIAN_STATES } from "@/lib/schemas/patient";
import { Card, CardBody } from "@/components/ui/card";
import { Forbidden, PageHeader } from "@/components/ui/misc";
import { Alert } from "@/components/ui/alert";
import { load } from "../../../_lib/guard";
import { EditPatientForm } from "./edit-form";

export const metadata: Metadata = { title: "Edit patient" };

export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await load(ctx, `/patients/${id}/edit`, () => loadScopedPatient(ctx, id, "patient.update"));
  if (!res.ok) return res.kind === "notfound" ? notFound() : <Forbidden message={res.message} />;
  const p = res.data;
  if (p.status === "MERGED") return <Alert tone="warning">Merged records cannot be edited.</Alert>;
  const dob = p.dateOfBirth ? p.dateOfBirth.toISOString().slice(0, 10) : undefined;
  return (
    <>
      <PageHeader
        title={`Edit ${p.givenName} ${p.familyName}`}
        description={`MRN ${p.mrn}. Changes are recorded in the audit trail (field names only).`}
        back={{ href: `/patients/${id}`, label: "Back to record" }}
      />
      <Card className="max-w-3xl">
        <CardBody>
          <EditPatientForm
            id={p.id}
            version={p.version}
            fields={[
              {
                name: "givenName",
                label: "First name",
                type: "text",
                required: true,
                defaultValue: p.givenName,
              },
              {
                name: "middleName",
                label: "Middle name",
                type: "text",
                defaultValue: p.middleName ?? undefined,
              },
              {
                name: "familyName",
                label: "Surname",
                type: "text",
                required: true,
                defaultValue: p.familyName,
              },
              {
                name: "preferredName",
                label: "Preferred name",
                type: "text",
                defaultValue: p.preferredName ?? undefined,
              },
              {
                name: "sexAtBirth",
                label: "Sex at birth",
                type: "select",
                required: true,
                defaultValue: p.sexAtBirth,
                options: [
                  { value: "FEMALE", label: "Female" },
                  { value: "MALE", label: "Male" },
                  { value: "INTERSEX", label: "Intersex" },
                  { value: "UNKNOWN", label: "Unknown / not stated" },
                ],
              },
              {
                name: "dobProvenance",
                label: "Date of birth source",
                type: "select",
                required: true,
                defaultValue: p.dobProvenance,
                hint: "To replace the date with a fresh estimate, clear the date and enter an estimated age.",
                options: [
                  { value: "DOCUMENT", label: "Seen on a document" },
                  { value: "STATED", label: "Stated by patient / relative" },
                  { value: "ESTIMATED", label: "Estimated (keep existing estimate)" },
                  { value: "UNKNOWN", label: "Unknown" },
                ],
              },
              { name: "dateOfBirth", label: "Date of birth", type: "date", defaultValue: dob },
              {
                name: "estimatedAgeYears",
                label: "Or estimated age (years)",
                type: "number",
                hint: "Only if the date is cleared",
              },
              { name: "phone", label: "Mobile phone", type: "tel", defaultValue: p.phoneE164 ?? undefined },
              {
                name: "altPhone",
                label: "Alternative phone",
                type: "tel",
                defaultValue: p.altPhoneE164 ?? undefined,
              },
              { name: "email", label: "Email", type: "email", defaultValue: p.email ?? undefined },
              {
                name: "addressLine",
                label: "Address",
                type: "text",
                span: 2,
                defaultValue: p.addressLine ?? undefined,
              },
              { name: "city", label: "Town / city", type: "text", defaultValue: p.city ?? undefined },
              { name: "lga", label: "LGA", type: "text", defaultValue: p.lga ?? undefined },
              {
                name: "state",
                label: "State",
                type: "select",
                defaultValue: p.state ?? "",
                options: NIGERIAN_STATES.map((s) => ({ value: s, label: s })),
              },
              {
                name: "occupation",
                label: "Occupation",
                type: "text",
                defaultValue: p.occupation ?? undefined,
              },
              {
                name: "maritalStatus",
                label: "Marital status",
                type: "text",
                defaultValue: p.maritalStatus ?? undefined,
              },
              {
                name: "referralSource",
                label: "Referral source",
                type: "text",
                defaultValue: p.referralSource ?? undefined,
              },
            ]}
          />
        </CardBody>
      </Card>
    </>
  );
}
