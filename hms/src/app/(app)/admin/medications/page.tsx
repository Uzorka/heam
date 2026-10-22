import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { listFrequencies, listMedications } from "@/server/domains/pharmacy/prescribing";
import { formatDate } from "@/lib/time";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog, ConfirmAction, type FieldSpec } from "@/components/forms/action-form";
import { allowed } from "../../_lib/guard";
import { createFrequencyAction, saveMedicationAction, setFrequencyStatusAction } from "./actions";

export const metadata: Metadata = { title: "Medication catalogue" };
const TABS = ["medicines", "frequencies"] as const;
const STATUS_TONE = { DRAFT: "warning", APPROVED: "success", RETIRED: "outline" } as const;
const FORMS = [
  "TABLET",
  "CAPSULE",
  "SYRUP",
  "SUSPENSION",
  "INJECTION",
  "INFUSION",
  "CREAM",
  "OINTMENT",
  "DROPS",
  "INHALER",
  "SUPPOSITORY",
  "PESSARY",
  "OTHER",
];

type Med = Awaited<ReturnType<typeof listMedications>>[number];

function medFields(m?: Med): FieldSpec[] {
  return [
    {
      name: "genericName",
      label: "Generic name",
      type: "text",
      required: true,
      defaultValue: m?.genericName,
    },
    { name: "brandName", label: "Brand name", type: "text", defaultValue: m?.brandName ?? undefined },
    {
      name: "strength",
      label: "Strength",
      type: "text",
      required: true,
      placeholder: "e.g. 500 mg",
      defaultValue: m?.strength,
    },
    {
      name: "form",
      label: "Dosage form",
      type: "select",
      required: true,
      defaultValue: m?.form ?? "TABLET",
      options: FORMS.map((f) => ({ value: f, label: f.charAt(0) + f.slice(1).toLowerCase() })),
    },
    {
      name: "defaultRoute",
      label: "Default route",
      type: "text",
      required: true,
      defaultValue: m?.defaultRoute ?? "Oral",
    },
    {
      name: "dispensingUnit",
      label: "Dispensing unit",
      type: "text",
      required: true,
      hint: "The unit stock is counted and supplied in, e.g. tablet, bottle, ampoule.",
      defaultValue: m?.dispensingUnit ?? "tablet",
    },
    {
      name: "sku",
      label: "Stock code (SKU)",
      type: "text",
      required: true,
      defaultValue: m?.inventoryProduct.sku,
    },
    {
      name: "nafdacNumber",
      label: "NAFDAC registration number",
      type: "text",
      hint: "Recorded as unverified until checked against the NAFDAC register.",
      defaultValue: m?.nafdacNumber ?? undefined,
    },
    {
      name: "formularyStatus",
      label: "Formulary status",
      type: "select",
      defaultValue: m?.formularyStatus ?? "FORMULARY",
      options: [
        { value: "FORMULARY", label: "Formulary" },
        { value: "RESTRICTED", label: "Restricted" },
        { value: "NON_FORMULARY", label: "Non-formulary" },
      ],
    },
    {
      name: "reorderLevel",
      label: "Reorder level",
      type: "number",
      defaultValue: String(m?.inventoryProduct.reorderLevel ?? 0),
    },
    {
      name: "reorderQuantity",
      label: "Reorder quantity",
      type: "number",
      defaultValue: String(m?.inventoryProduct.reorderQuantity ?? 0),
    },
    {
      name: "controlled",
      label: "Controlled drug (separate dispensing permission)",
      type: "checkbox",
      defaultChecked: m?.controlled,
    },
    {
      name: "active",
      label: "Active (available for prescribing)",
      type: "checkbox",
      defaultChecked: m?.active ?? true,
    },
  ];
}

export default async function MedicationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAuthContext();
  if (!(await allowed(ctx, "/admin/medications", ["pharmacy.catalogue.manage", "clinical.rules.approve"])))
    return <Forbidden />;
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as (typeof TABS)[number])
    : "medicines";
  const manage = can(ctx, "pharmacy.catalogue.manage");
  const approve = can(ctx, "clinical.rules.approve");
  const [meds, freqs] = await Promise.all([
    tab === "medicines" ? listMedications({ includeInactive: true }) : [],
    tab === "frequencies" ? listFrequencies() : [],
  ]);
  return (
    <>
      <PageHeader
        title="Medication catalogue"
        description="Medicines available for prescribing and the dose-frequency list. Each medicine is linked to a stock item."
      />
      <LinkTabs
        label="Catalogue sections"
        current={tab}
        tabs={[
          { key: "medicines", label: "Medicines", href: "/admin/medications" },
          { key: "frequencies", label: "Dose frequencies", href: "/admin/medications?tab=frequencies" },
        ]}
      />
      {tab === "medicines" && (
        <Card>
          <CardHeader
            title="Medicines"
            actions={
              manage && (
                <ActionDialog
                  action={saveMedicationAction}
                  trigger="Add medicine"
                  triggerVariant="primary"
                  title="Add medicine"
                  submitLabel="Save"
                  successMessage="Medicine saved."
                  fields={medFields()}
                />
              )
            }
          />
          {meds.length === 0 ? (
            <EmptyState title="No medicines yet">Add the hospital&apos;s formulary items.</EmptyState>
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Medicine</TH>
                    <TH>Form / unit</TH>
                    <TH>SKU</TH>
                    <TH>NAFDAC</TH>
                    <TH>Status</TH>
                    <TH>
                      <span className="sr-only">Edit</span>
                    </TH>
                  </tr>
                </THead>
                <tbody>
                  {meds.map((m) => (
                    <TR key={m.id}>
                      <TD>
                        <span className="font-medium">
                          {m.genericName} {m.strength}
                        </span>
                        {m.brandName && <span className="block text-[13px] text-muted">{m.brandName}</span>}
                      </TD>
                      <TD className="text-[13px]">
                        {m.form.toLowerCase()} · {m.dispensingUnit} · {m.defaultRoute}
                      </TD>
                      <TD className="font-mono text-[13px]">{m.inventoryProduct.sku}</TD>
                      <TD className="text-[13px]">
                        {m.nafdacNumber ? (
                          <>
                            {m.nafdacNumber}{" "}
                            <Badge tone={m.nafdacVerified ? "success" : "warning"}>
                              {m.nafdacVerified ? "verified" : "unverified"}
                            </Badge>
                          </>
                        ) : (
                          <span className="text-muted">not recorded</span>
                        )}
                      </TD>
                      <TD className="space-x-1">
                        <Badge tone={m.active ? "success" : "outline"}>
                          {m.active ? "active" : "inactive"}
                        </Badge>
                        {m.controlled && <Badge tone="warning">controlled</Badge>}
                        {m.formularyStatus !== "FORMULARY" && (
                          <Badge tone="outline">{m.formularyStatus.toLowerCase().replace("_", "-")}</Badge>
                        )}
                      </TD>
                      <TD className="text-right">
                        {manage && (
                          <ActionDialog
                            action={saveMedicationAction}
                            fixed={{ id: m.id }}
                            trigger="Edit"
                            triggerVariant="ghost"
                            title={`Edit ${m.genericName} ${m.strength}`}
                            submitLabel="Save"
                            successMessage="Medicine updated."
                            fields={medFields(m)}
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
      )}
      {tab === "frequencies" && (
        <Card>
          <CardHeader
            title="Dose frequencies"
            description="Clinical content: a frequency can be used on prescriptions only after a clinician other than its author approves it."
            actions={
              manage && (
                <ActionDialog
                  action={createFrequencyAction}
                  trigger="Propose frequency"
                  triggerVariant="primary"
                  title="Propose a dose frequency"
                  submitLabel="Save as draft"
                  successMessage="Frequency saved as draft for approval."
                  fields={[
                    { name: "code", label: "Code", type: "text", required: true, placeholder: "e.g. BD" },
                    {
                      name: "label",
                      label: "Meaning",
                      type: "text",
                      required: true,
                      placeholder: "e.g. Twice daily",
                    },
                    {
                      name: "timesPerDay",
                      label: "Times per day",
                      type: "number",
                      hint: "Used only to suggest a quantity. Leave blank for PRN or irregular schedules.",
                    },
                  ]}
                />
              )
            }
          />
          {freqs.some((f) => f.status === "DRAFT") && (
            <div className="px-4 pb-2">
              <Alert tone="warning">Draft frequencies are not available to prescribers until approved.</Alert>
            </div>
          )}
          {freqs.length === 0 ? (
            <EmptyState title="No frequencies" />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Code</TH>
                    <TH>Meaning</TH>
                    <TH>Times/day</TH>
                    <TH>Status</TH>
                    <TH>
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <tbody>
                  {freqs.map((f) => (
                    <TR key={f.id}>
                      <TD className="font-mono">{f.code}</TD>
                      <TD>{f.label}</TD>
                      <TD>{f.timesPerDay === null ? "-" : Number(f.timesPerDay)}</TD>
                      <TD>
                        <Badge tone={STATUS_TONE[f.status]}>{f.status.toLowerCase()}</Badge>
                        {f.approvedAt && (
                          <span className="ml-1 text-xs text-muted">{formatDate(f.approvedAt)}</span>
                        )}
                      </TD>
                      <TD className="space-x-1 text-right">
                        {approve && f.status === "DRAFT" && f.createdById !== ctx.userId && (
                          <ConfirmAction
                            action={setFrequencyStatusAction}
                            fixed={{ id: f.id, status: "APPROVED" }}
                            trigger="Approve"
                            triggerVariant="primary"
                            title={`Approve ${f.code}?`}
                            description="Your name is recorded as the approving clinician."
                            submitLabel="Approve"
                            successMessage="Frequency approved."
                          />
                        )}
                        {approve && f.status !== "RETIRED" && (
                          <ConfirmAction
                            action={setFrequencyStatusAction}
                            fixed={{ id: f.id, status: "RETIRED" }}
                            trigger="Retire"
                            triggerVariant="ghost"
                            title={`Retire ${f.code}?`}
                            description="Existing prescriptions keep it; new prescriptions cannot use it."
                            submitLabel="Retire"
                            successMessage="Frequency retired."
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
      )}
    </>
  );
}
