import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { SETTING_DEFS, getAllSettings } from "@/server/domains/settings/system-settings";
import { formatDateTime } from "@/lib/time";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Forbidden, PageHeader } from "@/components/ui/misc";
import { ActionDialog, type FieldSpec } from "@/components/forms/action-form";
import { allowed } from "../../_lib/guard";
import { updateSettingAction } from "../actions";

export const metadata: Metadata = { title: "System settings" };

function fieldFor(key: string, value: unknown): FieldSpec {
  const def = SETTING_DEFS[key as keyof typeof SETTING_DEFS];
  const schema = def.schema as unknown as { options?: string[] };
  if (Array.isArray(schema.options)) {
    return { name: "value", label: def.label, type: "select", required: true, defaultValue: String(value), options: schema.options.map((o) => ({ value: o, label: o.replace(/_/g, " ").toLowerCase() })) };
  }
  return { name: "value", label: def.label, type: typeof def.default === "number" ? "number" : "text", required: true, defaultValue: String(value), hint: def.description };
}

export default async function SettingsPage() {
  const ctx = await requireAuthContext();
  if (!(await allowed(ctx, "/admin/settings", ["settings.read"]))) return <Forbidden />;
  const settings = await getAllSettings(prisma);
  const manage = can(ctx, "settings.manage");
  const e = env();
  return (
    <>
      <PageHeader title="System settings" description="Runtime configuration. Every change is recorded with before/after values in the audit trail." />
      <div className="space-y-5">
        <Card>
          <CardHeader title="Workflow settings" />
          <ul className="divide-y divide-border">
            {settings.map((s) => (
              <li key={s.key} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                <div className="max-w-2xl">
                  <p className="font-medium">{s.label}</p>
                  <p className="text-[13px] text-muted">{s.description}</p>
                  <p className="mt-1 text-[14px]">
                    <span className="font-mono">{String(s.value)}</span> {s.isDefault ? <Badge tone="outline">default</Badge> : s.updatedAt && <span className="text-xs text-muted">changed {formatDateTime(s.updatedAt)}</span>}
                  </p>
                </div>
                {manage && (
                  <ActionDialog action={updateSettingAction} fixed={{ key: s.key }} trigger="Change" triggerVariant="ghost" title={s.label} description={s.description} submitLabel="Save" successMessage="Setting updated." fields={[fieldFor(s.key, s.value)]} />
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Deployment configuration" description="Set through environment variables by the system administrator; shown read-only." />
          <ul className="divide-y divide-border text-[14px]">
            {[
              ["Session idle timeout", `${e.SESSION_IDLE_MINUTES} minutes`],
              ["Session maximum length", `${e.SESSION_ABSOLUTE_HOURS} hours`],
              ["Two-step verification for privileged roles", e.MFA_ENFORCE === "true" ? "Enforced" : "Not enforced (development)"],
              ["Document storage", e.STORAGE_DRIVER === "s3" ? "S3-compatible object storage" : "Local disk (development only)"],
              ["Email delivery", e.EMAIL_PROVIDER === "disabled" ? "Disabled - no provider configured" : e.EMAIL_PROVIDER],
              ["SMS delivery", e.SMS_PROVIDER === "disabled" ? "Disabled - no provider configured" : e.SMS_PROVIDER],
              ["Timezone / currency", "Africa/Lagos · NGN (amounts stored in kobo)"],
            ].map(([k, v]) => (
              <li key={k} className="flex flex-wrap justify-between gap-2 px-5 py-3">
                <span className="text-muted">{k}</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
