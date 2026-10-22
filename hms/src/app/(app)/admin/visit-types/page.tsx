import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { listDepartments, listVisitTypes } from "@/server/domains/settings/service";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog, type FieldSpec } from "@/components/forms/action-form";
import { allowed } from "../../_lib/guard";
import { saveVisitTypeAction } from "../actions";

export const metadata: Metadata = { title: "Visit types" };

export default async function VisitTypesPage() {
  const ctx = await requireAuthContext();
  if (!(await allowed(ctx, "/admin/visit-types", ["settings.read"]))) return <Forbidden />;
  const [types, departments] = await Promise.all([listVisitTypes(), listDepartments()]);
  const manage = can(ctx, "settings.manage");
  const fields = (v?: (typeof types)[number]): FieldSpec[] => [
    { name: "code", label: "Code", type: "text", required: true, defaultValue: v?.code },
    { name: "name", label: "Name", type: "text", required: true, defaultValue: v?.name },
    {
      name: "departmentId",
      label: "Department",
      type: "select",
      defaultValue: v?.departmentId ?? "",
      options: departments.map((d) => ({ value: d.id, label: d.name })),
    },
    {
      name: "defaultDurationMin",
      label: "Default duration (minutes)",
      type: "number",
      required: true,
      defaultValue: String(v?.defaultDurationMin ?? 15),
    },
    { name: "active", label: "Active", type: "checkbox", defaultChecked: v?.active ?? true },
  ];
  return (
    <>
      <PageHeader
        title="Visit types"
        description="Used for booking, check-in and (from Phase 4) default consultation charges."
        actions={
          manage && (
            <ActionDialog
              action={saveVisitTypeAction}
              trigger="Add visit type"
              triggerVariant="primary"
              triggerSize="md"
              title="Add visit type"
              submitLabel="Save"
              successMessage="Visit type saved."
              fields={fields()}
            />
          )
        }
      />
      <Card>
        <CardHeader title={`${types.length} visit types`} />
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Code</TH>
                <TH>Name</TH>
                <TH>Department</TH>
                <TH className="text-right">Duration</TH>
                <TH>Status</TH>
                {manage && (
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                )}
              </tr>
            </THead>
            <tbody>
              {types.map((v) => (
                <TR key={v.id}>
                  <TD className="font-mono text-[13px]">{v.code}</TD>
                  <TD>{v.name}</TD>
                  <TD className="text-[13px]">{v.department?.name ?? "-"}</TD>
                  <TD className="tabular text-right">{v.defaultDurationMin} min</TD>
                  <TD>
                    {v.active ? <Badge tone="success">Active</Badge> : <Badge tone="outline">Inactive</Badge>}
                  </TD>
                  {manage && (
                    <TD className="text-right">
                      <ActionDialog
                        action={saveVisitTypeAction}
                        fixed={{ id: v.id }}
                        trigger="Edit"
                        triggerVariant="ghost"
                        title={`Edit ${v.name}`}
                        submitLabel="Save"
                        successMessage="Visit type saved."
                        fields={fields(v)}
                      />
                    </TD>
                  )}
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
    </>
  );
}
