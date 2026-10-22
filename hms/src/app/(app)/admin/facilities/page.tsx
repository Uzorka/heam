import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { listBranches, listDepartments, listWardsWithBeds } from "@/server/domains/settings/service";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog } from "@/components/forms/action-form";
import { allowed } from "../../_lib/guard";
import { saveBedAction, saveDepartmentAction, saveWardAction } from "../actions";

export const metadata: Metadata = { title: "Departments & beds" };

const DEPT_KINDS = [
  { value: "CLINICAL", label: "Clinical" },
  { value: "DIAGNOSTIC", label: "Diagnostic" },
  { value: "SUPPORT", label: "Support" },
  { value: "ADMINISTRATIVE", label: "Administrative" },
];
const WARD_KINDS = ["GENERAL", "MATERNITY", "LABOUR", "PAEDIATRIC", "NEWBORN", "EMERGENCY", "PRIVATE", "OTHER"].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }));
const BED_TONE = { FREE: "success", RESERVED: "info", OCCUPIED: "accent", CLEANING: "warning", UNAVAILABLE: "outline" } as const;

export default async function FacilitiesPage() {
  const ctx = await requireAuthContext();
  if (!(await allowed(ctx, "/admin/facilities", ["settings.read"]))) return <Forbidden />;
  const [branches, departments, wards] = await Promise.all([listBranches(), listDepartments(), listWardsWithBeds()]);
  const manage = can(ctx, "settings.manage");
  const branchOptions = branches.map((b) => ({ value: b.id, label: b.name }));
  const defaultBranch = ctx.activeBranchId ?? branches[0]?.id;

  return (
    <>
      <PageHeader title="Departments, wards & beds" description="Configure the physical layout. Bed allocation to patients arrives with admissions (Phase 5)." />
      {wards.some((w) => w.isDemo) && (
        <Alert tone="warning" className="mb-5" title="Demo wards present">
          Wards and beds labelled DEMO are sample configuration, not the hospital&apos;s real capacity. Replace them with the confirmed layout before go-live.
        </Alert>
      )}
      <div className="space-y-5">
        <Card>
          <CardHeader
            title="Departments"
            actions={
              manage && (
                <ActionDialog
                  action={saveDepartmentAction}
                  trigger="Add department"
                  title="Add department"
                  submitLabel="Save"
                  successMessage="Department saved."
                  fields={[
                    { name: "branchId", label: "Branch", type: "select", required: true, defaultValue: defaultBranch, options: branchOptions },
                    { name: "code", label: "Code", type: "text", required: true },
                    { name: "name", label: "Name", type: "text", required: true },
                    { name: "kind", label: "Type", type: "select", required: true, defaultValue: "CLINICAL", options: DEPT_KINDS },
                    { name: "active", label: "Active", type: "checkbox", defaultChecked: true },
                  ]}
                />
              )
            }
          />
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Code</TH>
                  <TH>Name</TH>
                  <TH>Type</TH>
                  <TH>Branch</TH>
                  <TH>Status</TH>
                  {manage && <TH><span className="sr-only">Actions</span></TH>}
                </tr>
              </THead>
              <tbody>
                {departments.map((d) => (
                  <TR key={d.id}>
                    <TD className="font-mono text-[13px]">{d.code}</TD>
                    <TD>{d.name}</TD>
                    <TD className="text-[13px]">{d.kind.toLowerCase()}</TD>
                    <TD className="text-[13px]">{d.branch.name}</TD>
                    <TD>{d.active ? <Badge tone="success">Active</Badge> : <Badge tone="outline">Inactive</Badge>}</TD>
                    {manage && (
                      <TD className="text-right">
                        <ActionDialog
                          action={saveDepartmentAction}
                          fixed={{ id: d.id, branchId: d.branchId }}
                          trigger="Edit"
                          triggerVariant="ghost"
                          title={`Edit ${d.name}`}
                          submitLabel="Save"
                          successMessage="Department saved."
                          fields={[
                            { name: "code", label: "Code", type: "text", required: true, defaultValue: d.code },
                            { name: "name", label: "Name", type: "text", required: true, defaultValue: d.name },
                            { name: "kind", label: "Type", type: "select", required: true, defaultValue: d.kind, options: DEPT_KINDS },
                            { name: "active", label: "Active", type: "checkbox", defaultChecked: d.active },
                          ]}
                        />
                      </TD>
                    )}
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>

        <Card>
          <CardHeader
            title="Wards & beds"
            actions={
              manage && (
                <ActionDialog
                  action={saveWardAction}
                  trigger="Add ward"
                  title="Add ward"
                  submitLabel="Save"
                  successMessage="Ward saved."
                  fields={[
                    { name: "branchId", label: "Branch", type: "select", required: true, defaultValue: defaultBranch, options: branchOptions },
                    { name: "code", label: "Code", type: "text", required: true },
                    { name: "name", label: "Name", type: "text", required: true },
                    { name: "kind", label: "Ward type", type: "select", required: true, defaultValue: "GENERAL", options: WARD_KINDS },
                    { name: "departmentId", label: "Department", type: "select", options: departments.map((d) => ({ value: d.id, label: d.name })) },
                    { name: "active", label: "Active", type: "checkbox", defaultChecked: true },
                  ]}
                />
              )
            }
          />
          {wards.length === 0 ? (
            <EmptyState title="No wards configured" />
          ) : (
            <div className="divide-y divide-border">
              {wards.map((w) => (
                <section key={w.id} className="px-5 py-4" aria-label={w.name}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {w.name} {w.isDemo && <Badge tone="warning">DEMO</Badge>} {!w.active && <Badge tone="outline">Inactive</Badge>}
                      </p>
                      <p className="text-[13px] text-muted">
                        {w.kind.toLowerCase()} · {w.branch.name}
                        {w.department ? ` · ${w.department.name}` : ""} · {w.beds.length} beds
                      </p>
                    </div>
                    {manage && (
                      <ActionDialog
                        action={saveBedAction}
                        fixed={{ wardId: w.id }}
                        trigger="Add bed"
                        triggerVariant="ghost"
                        title={`Add bed to ${w.name}`}
                        submitLabel="Save"
                        successMessage="Bed added."
                        fields={[
                          { name: "code", label: "Code", type: "text", required: true, placeholder: "e.g. B05" },
                          { name: "label", label: "Label", type: "text", required: true },
                          { name: "category", label: "Category", type: "text", required: true, defaultValue: "STANDARD", hint: "Used for bed tariffs in Phase 4/5" },
                          { name: "active", label: "Active", type: "checkbox", defaultChecked: true },
                        ]}
                      />
                    )}
                  </div>
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    {w.beds.map((b) => (
                      <li key={b.id} className="rounded-md border border-border p-2.5 text-[13px]">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono font-medium">{b.code}</span>
                          <Badge tone={BED_TONE[b.status]}>{b.status.toLowerCase()}</Badge>
                        </div>
                        <p className="mt-1 truncate text-muted" title={b.label}>
                          {b.label}
                        </p>
                        {manage && (
                          <div className="mt-1">
                            <ActionDialog
                              action={saveBedAction}
                              fixed={{ id: b.id, wardId: w.id }}
                              trigger="Edit"
                              triggerVariant="link"
                              title={`Edit bed ${b.code}`}
                              description="Occupied or reserved beds can only be changed through the admissions workflow."
                              submitLabel="Save"
                              successMessage="Bed updated."
                              fields={[
                                { name: "code", label: "Code", type: "text", required: true, defaultValue: b.code },
                                { name: "label", label: "Label", type: "text", required: true, defaultValue: b.label },
                                { name: "category", label: "Category", type: "text", required: true, defaultValue: b.category },
                                ...(b.status === "OCCUPIED" || b.status === "RESERVED"
                                  ? []
                                  : [
                                      {
                                        name: "status",
                                        label: "Status",
                                        type: "select" as const,
                                        defaultValue: b.status,
                                        options: [
                                          { value: "FREE", label: "Free" },
                                          { value: "CLEANING", label: "Cleaning" },
                                          { value: "UNAVAILABLE", label: "Unavailable" },
                                        ],
                                      },
                                    ]),
                                { name: "active", label: "Active", type: "checkbox", defaultChecked: b.active },
                              ]}
                            />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
