import type { FieldSpec } from "@/components/forms/action-form";

interface PayerLike {
  code: string;
  name: string;
  scheme: string;
  providerCode: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  claimsEmail: string | null;
  contractStart: Date | null;
  contractEnd: Date | null;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);

export function payerFields(p?: PayerLike): FieldSpec[] {
  return [
    { name: "code", label: "Short code", type: "text", required: true, defaultValue: p?.code },
    { name: "name", label: "Name", type: "text", required: true, defaultValue: p?.name },
    {
      name: "scheme",
      label: "Scheme",
      type: "select",
      required: true,
      defaultValue: p?.scheme ?? "PRIVATE_HMO",
      options: [
        { value: "PRIVATE_HMO", label: "Private HMO" },
        { value: "NHIA", label: "NHIA" },
        { value: "STATE_SCHEME", label: "State health insurance scheme" },
        { value: "CORPORATE", label: "Corporate / retainership" },
      ],
    },
    {
      name: "providerCode",
      label: "Hospital's provider code with this payer",
      type: "text",
      defaultValue: p?.providerCode ?? undefined,
    },
    { name: "contactName", label: "Contact person", type: "text", defaultValue: p?.contactName ?? undefined },
    { name: "contactPhone", label: "Contact phone", type: "tel", defaultValue: p?.contactPhone ?? undefined },
    {
      name: "contactEmail",
      label: "Contact email",
      type: "email",
      defaultValue: p?.contactEmail ?? undefined,
    },
    { name: "claimsEmail", label: "Claims email", type: "email", defaultValue: p?.claimsEmail ?? undefined },
    {
      name: "contractStart",
      label: "Contract start",
      type: "date",
      defaultValue: iso(p?.contractStart ?? null),
    },
    { name: "contractEnd", label: "Contract end", type: "date", defaultValue: iso(p?.contractEnd ?? null) },
  ];
}
