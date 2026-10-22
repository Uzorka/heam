"use client";
import { useRouter } from "next/navigation";
import { ActionForm, type FieldSpec } from "@/components/forms/action-form";
import { checkInAction } from "../actions";

export function CheckInForm({ fixed, fields }: { fixed: Record<string, unknown>; fields: FieldSpec[] }) {
  const router = useRouter();
  return (
    <ActionForm
      action={checkInAction}
      fixed={fixed}
      fields={fields}
      submitLabel="Check in"
      successMessage="Patient checked in."
      onDone={(d) => router.push(`/queue/${(d as { id: string }).id}/slip?new=1`)}
    />
  );
}
