import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { assessRoleChange, listPendingRoleChanges, listRoles } from "@/server/domains/staff/roles";
import { formatDateTime } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog } from "@/components/forms/action-form";
import { load } from "../../_lib/guard";
import { decideRoleChangeAction } from "../actions";

export const metadata: Metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  const ctx = await requireAuthContext();
  const res = await load(ctx, "/admin/roles", async () => ({
    roles: await listRoles(ctx),
    pending: await listPendingRoleChanges(ctx),
  }));
  if (!res.ok) return <Forbidden message={res.message} />;
  const { roles, pending } = res.data;
  const approver = can(ctx, "roles.approve_change");
  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Protective defaults: system administration never grants patient records; HR never sees patients; approvals are separated from requests. Changes to a role need a second authorised person."
      />
      {pending.length > 0 && (
        <Card className="mb-5">
          <CardHeader title="Pending role changes" description="Review the risk notes before approving." />
          <ul className="divide-y divide-border">
            {pending.map((p) => {
              const warnings = assessRoleChange(
                p.role.permissions.map((x) => x.permissionCode),
                p.addPermissions,
              );
              const mine = p.requestedById === ctx.userId;
              return (
                <li key={p.id} className="space-y-2 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{p.role.name}</p>
                      <p className="text-[13px] text-muted">
                        Requested by {p.requestedBy.displayName} · {formatDateTime(p.requestedAt)}
                      </p>
                      <p className="mt-1 text-[13px]">Reason: {p.reason}</p>
                    </div>
                    {approver && !mine ? (
                      <div className="flex gap-1">
                        <ActionDialog
                          action={decideRoleChangeAction}
                          fixed={{ requestId: p.id, approve: true }}
                          trigger="Approve"
                          triggerVariant="primary"
                          title="Approve role change"
                          description="Affects every user holding this role immediately."
                          submitLabel="Approve"
                          successMessage="Role change approved and applied."
                          fields={[{ name: "notes", label: "Notes", type: "textarea" }]}
                        />
                        <ActionDialog
                          action={decideRoleChangeAction}
                          fixed={{ requestId: p.id, approve: false }}
                          trigger="Reject"
                          triggerVariant="ghost"
                          title="Reject role change"
                          submitLabel="Reject"
                          tone="danger"
                          successMessage="Role change rejected."
                          fields={[{ name: "notes", label: "Reason", type: "textarea" }]}
                        />
                      </div>
                    ) : (
                      <Badge tone="outline">{mine ? "Awaiting another approver" : "Awaiting approver"}</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 text-[12px]">
                    {p.addPermissions.map((c) => (
                      <Badge key={c} tone="success">
                        + {c}
                      </Badge>
                    ))}
                    {p.removePermissions.map((c) => (
                      <Badge key={c} tone="danger">
                        − {c}
                      </Badge>
                    ))}
                  </div>
                  {warnings.length > 0 && (
                    <Alert tone="warning" title="Risk notes">
                      <ul className="list-disc pl-4">
                        {warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    </Alert>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <Card>
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Role</TH>
                <TH className="text-right">Permissions</TH>
                <TH className="text-right">Active holders</TH>
                <TH>Flags</TH>
              </tr>
            </THead>
            <tbody>
              {roles.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link
                      prefetch={false}
                      href={`/admin/roles/${r.id}`}
                      className="font-medium hover:text-accent hover:underline"
                    >
                      {r.name}
                    </Link>
                    <div className="text-[13px] text-muted">{r.description}</div>
                  </TD>
                  <TD className="tabular text-right">{r._count.permissions}</TD>
                  <TD className="tabular text-right">{r._count.userRoles}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {r.requiresMfa && <Badge tone="info">MFA</Badge>}
                      {r.kind === "PORTAL" && <Badge tone="outline">Portal</Badge>}
                      {r.changeRequests.length > 0 && <Badge tone="warning">Change pending</Badge>}
                    </div>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
      <CardBody className="px-0 text-[13px] text-muted">
        See <code>docs/PERMISSIONS_MATRIX.md</code> for the full matrix and rationale.
      </CardBody>
    </>
  );
}
