import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { getOrganization, listBranches } from "@/server/domains/settings/service";
import { formatPhone } from "@/lib/phone";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DescriptionList, Forbidden, PageHeader } from "@/components/ui/misc";
import { ActionDialog, type FieldSpec } from "@/components/forms/action-form";
import { allowed } from "../../_lib/guard";
import { saveBranchAction, updateOrganizationAction } from "../actions";

export const metadata: Metadata = { title: "Hospital & branches" };

const branchFields = (b?: {
  code: string;
  name: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  phoneE164: string | null;
  email: string | null;
  status: string;
  verificationStatus: string;
  verificationNotes: string | null;
}): FieldSpec[] => [
  {
    name: "code",
    label: "Code",
    type: "text",
    required: true,
    defaultValue: b?.code,
    hint: "Short unique code, e.g. MAIN",
  },
  { name: "name", label: "Name", type: "text", required: true, defaultValue: b?.name },
  { name: "addressLine", label: "Address", type: "text", span: 2, defaultValue: b?.addressLine ?? undefined },
  { name: "city", label: "Town / city", type: "text", defaultValue: b?.city ?? undefined },
  { name: "state", label: "State", type: "text", defaultValue: b?.state ?? undefined },
  { name: "phone", label: "Phone", type: "tel", defaultValue: b?.phoneE164 ?? undefined },
  { name: "email", label: "Email", type: "email", defaultValue: b?.email ?? undefined },
  {
    name: "verificationStatus",
    label: "Verification",
    type: "select",
    required: true,
    defaultValue: b?.verificationStatus ?? "UNKNOWN",
    options: [
      { value: "UNKNOWN", label: "Unknown" },
      { value: "AWAITING_APPROVAL", label: "Awaiting approval" },
      { value: "VERIFIED", label: "Verified" },
      { value: "REJECTED", label: "Rejected" },
    ],
  },
  {
    name: "status",
    label: "Operational status",
    type: "select",
    required: true,
    defaultValue: b?.status ?? "PENDING_VERIFICATION",
    hint: "A branch can only be activated once verified.",
    options: [
      { value: "PENDING_VERIFICATION", label: "Pending verification" },
      { value: "ACTIVE", label: "Active" },
      { value: "INACTIVE", label: "Inactive" },
    ],
  },
  {
    name: "verificationNotes",
    label: "Verification notes",
    type: "textarea",
    defaultValue: b?.verificationNotes ?? undefined,
  },
];

export default async function OrganizationPage() {
  const ctx = await requireAuthContext();
  if (!(await allowed(ctx, "/admin/organization", ["settings.read"]))) return <Forbidden />;
  const [org, branches] = await Promise.all([getOrganization(), listBranches()]);
  const manage = can(ctx, "settings.manage");
  return (
    <>
      <PageHeader
        title="Hospital & branches"
        description="Identity shown on slips and documents. One campus is active by default until administrators confirm others."
      />
      <div className="space-y-5">
        <Card>
          <CardHeader
            title="Hospital identity"
            actions={
              manage && (
                <ActionDialog
                  action={updateOrganizationAction}
                  fixed={{ version: org.version }}
                  trigger="Edit"
                  title="Hospital identity"
                  submitLabel="Save"
                  successMessage="Hospital identity updated."
                  fields={[
                    {
                      name: "name",
                      label: "Name",
                      type: "text",
                      required: true,
                      defaultValue: org.name,
                      span: 2,
                    },
                    {
                      name: "subtitle",
                      label: "Subtitle",
                      type: "text",
                      defaultValue: org.subtitle ?? undefined,
                    },
                    {
                      name: "tagline",
                      label: "Tagline",
                      type: "text",
                      defaultValue: org.tagline ?? undefined,
                    },
                    {
                      name: "legalName",
                      label: "Registered legal name",
                      type: "text",
                      defaultValue: org.legalName ?? undefined,
                    },
                    {
                      name: "website",
                      label: "Website",
                      type: "text",
                      defaultValue: org.website ?? undefined,
                    },
                    { name: "email", label: "Email", type: "email", defaultValue: org.email ?? undefined },
                    { name: "phone", label: "Phone", type: "tel", defaultValue: org.phoneE164 ?? undefined },
                    {
                      name: "letterhead",
                      label: "Letterhead text",
                      type: "textarea",
                      defaultValue: org.letterhead ?? undefined,
                    },
                  ]}
                />
              )
            }
          />
          <CardBody>
            <DescriptionList
              items={[
                ["Name", org.name],
                ["Subtitle", org.subtitle],
                ["Tagline", org.tagline],
                ["Legal name", org.legalName],
                ["Website", org.website],
                ["Email", org.email],
                ["Phone", org.phoneE164 ? formatPhone(org.phoneE164) : null],
                ["Timezone / currency", `${org.timezone} · ${org.currency}`],
                ["Logo", "Not uploaded - document storage arrives with Phase 2"],
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Branches"
            actions={
              manage && (
                <ActionDialog
                  action={saveBranchAction}
                  trigger="Add branch"
                  title="Add branch"
                  submitLabel="Save"
                  successMessage="Branch saved."
                  fields={branchFields()}
                />
              )
            }
          />
          <ul className="divide-y divide-border">
            {branches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                <div className="max-w-2xl">
                  <p className="font-medium">
                    {b.name} <span className="font-mono text-[12px] text-muted">{b.code}</span>
                  </p>
                  <p className="text-[13px] text-muted">
                    {[b.addressLine, b.city, b.state].filter(Boolean).join(", ") || "No address"}
                  </p>
                  {b.verificationNotes && <p className="mt-1 text-xs text-muted">{b.verificationNotes}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={b.status === "ACTIVE" ? "success" : b.status === "INACTIVE" ? "outline" : "warning"}
                  >
                    {b.status.toLowerCase().replace("_", " ")}
                  </Badge>
                  <Badge tone={b.verificationStatus === "VERIFIED" ? "success" : "warning"}>
                    {b.verificationStatus.toLowerCase().replace("_", " ")}
                  </Badge>
                  {manage && (
                    <ActionDialog
                      action={saveBranchAction}
                      fixed={{ id: b.id }}
                      trigger="Edit"
                      triggerVariant="ghost"
                      title={`Edit ${b.name}`}
                      submitLabel="Save"
                      successMessage="Branch saved."
                      fields={branchFields(b)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
