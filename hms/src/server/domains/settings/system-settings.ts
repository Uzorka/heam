import { z } from "zod";
import type { DbClient } from "../../db";

/** Typed registry of runtime settings. Every setting has a validated schema and a safe default. */
export const SETTING_DEFS = {
  "queue.initialStage": {
    schema: z.enum(["REGISTERED", "AWAITING_VITALS", "READY_FOR_DOCTOR"]),
    default: "AWAITING_VITALS" as const,
    label: "Queue stage after check-in",
    description: "Where a patient lands after the front desk checks them in.",
  },
  "appointments.defaultSlotMinutes": {
    schema: z.number().int().min(5).max(120),
    default: 15,
    label: "Default appointment length (minutes)",
    description: "Used when a visit type has no duration configured.",
  },
  "clinical.careRelationshipDays": {
    schema: z.number().int().min(1).max(365),
    default: 30,
    label: "Care relationship window (days)",
    description: "How long after a care-team assignment ends a clinician keeps read access to that patient's chart.",
  },
  "breakglass.durationMinutes": {
    schema: z.number().int().min(15).max(240),
    default: 60,
    label: "Emergency access duration (minutes)",
    description: "How long a break-glass grant lasts before it expires automatically.",
  },
  "privacy.noticeVersion": {
    schema: z.string().min(1).max(60),
    default: "draft-1 (pending legal review)",
    label: "Privacy notice version",
    description: "Version recorded when staff confirm the patient privacy notice was given.",
  },
  "records.retentionPolicyStatus": {
    schema: z.enum(["AWAITING_LEGAL_SIGNOFF", "APPROVED"]),
    default: "AWAITING_LEGAL_SIGNOFF" as const,
    label: "Record retention policy status",
    description: "Retention/destruction workflows stay disabled until legal sign-off is recorded.",
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_DEFS)[K]["schema"]>;

export async function getSetting<K extends SettingKey>(db: DbClient, key: K): Promise<SettingValue<K>> {
  const row = await db.systemSetting.findUnique({ where: { key } });
  const def = SETTING_DEFS[key];
  if (!row) return def.default as SettingValue<K>;
  const parsed = def.schema.safeParse(row.value);
  return (parsed.success ? parsed.data : def.default) as SettingValue<K>;
}

export async function getAllSettings(db: DbClient) {
  const rows = await db.systemSetting.findMany();
  return (Object.keys(SETTING_DEFS) as SettingKey[]).map((key) => {
    const def = SETTING_DEFS[key];
    const row = rows.find((r) => r.key === key);
    const parsed = row ? def.schema.safeParse(row.value) : null;
    return {
      key,
      label: def.label,
      description: def.description,
      value: parsed?.success ? parsed.data : def.default,
      isDefault: !row,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}
