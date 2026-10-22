"use client";
import { useRouter } from "next/navigation";
import { ActionForm, type FieldSpec } from "@/components/forms/action-form";
import { updatePatientAction } from "../../actions";

export function EditPatientForm({ id, version, fields }: { id: string; version: number; fields: FieldSpec[] }) {
  const router = useRouter();
  return (
    <ActionForm
      action={updatePatientAction}
      fixed={{ id, version }}
      fields={fields}
      submitLabel="Save changes"
      successMessage="Patient details updated."
      onDone={() => router.push(`/patients/${id}`)}
    />
  );
}
