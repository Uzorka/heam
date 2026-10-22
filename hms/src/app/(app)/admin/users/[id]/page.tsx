import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { getUserDetail, listUserSessions } from "@/server/domains/staff/users";
import { formatDate, formatDateTime } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { DescriptionList, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog, ConfirmAction } from "@/components/forms/action-form";
import { load } from "../../../_lib/guard";
import {
  assignRoleAction,
  resetMfaAction,
  revokeRoleAction,
  revokeSessionsAction,
  setUserStatusAction,
} from "../../actions";
import { ResetLinkButton } from "./reset-link";

export const metadata: Metadata = { title: "Staff account" };

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await load(ctx, `/admin/users/${id}`, () => getUserDetail(ctx, id));
  if (!res.ok) return res.kind === "notfound" ? notFound() : <Forbidden message={res.message} />;
  const u = res.data;
  const self = u.id === ctx.userId;
  const manage = can(ctx, "users.manage") && !self;
  const creds = can(ctx, "users.credentials.reset") && !self;
  const now = new Date();
  const [roles, branches, others, sessions] = await Promise.all([
    manage
      ? prisma.role.findMany({
          where: { active: true, kind: u.kind },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : [],
    manage
      ? prisma.branch.findMany({
          where: { status: { not: "INACTIVE" } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : [],
    manage
      ? prisma.user.findMany({
          where: { status: "ACTIVE", kind: "STAFF", NOT: { id: u.id } },
          orderBy: { displayName: "asc" },
          select: { id: true, displayName: true },
        })
      : [],
    can(ctx, "sessions.manage") ? listUserSessions(ctx, u.id) : null,
  ]);
  const activeRoles = u.roles.filter((r) => !r.revokedAt && (!r.effectiveTo || r.effectiveTo > now));
  const pastRoles = u.roles.filter((r) => !activeRoles.includes(r));

  return (
    <>
      <PageHeader
        title={u.displayName}
        description={`${u.jobTitle ?? "No job title"} · ${u.email}`}
        back={{ href: "/admin/users", label: "Staff & access" }}
      />
      {self && (
        <Alert tone="info" className="mb-4">
          This is your own account. Role and status changes must be made by another administrator.
        </Alert>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader
              title="Current roles"
              description="Permissions take effect on the user's next request - no sign-out needed."
              actions={
                manage && (
                  <ActionDialog
                    action={assignRoleAction}
                    fixed={{ userId: u.id }}
                    trigger="Assign role"
                    triggerVariant="primary"
                    title="Assign role"
                    description="For temporary cover, tick 'temporary cover' and set an end date (max 31 days)."
                    submitLabel="Assign"
                    successMessage="Role assigned."
                    fields={[
                      {
                        name: "roleId",
                        label: "Role",
                        type: "select",
                        required: true,
                        options: roles.map((r) => ({ value: r.id, label: r.name })),
                      },
                      {
                        name: "branchId",
                        label: "Branch",
                        type: "select",
                        defaultValue: ctx.activeBranchId ?? undefined,
                        options: branches.map((b) => ({ value: b.id, label: b.name })),
                      },
                      { name: "allBranches", label: "All branches", type: "checkbox" },
                      { name: "effectiveFrom", label: "Starts", type: "date" },
                      { name: "effectiveTo", label: "Ends", type: "date" },
                      { name: "isDelegation", label: "Temporary cover for a colleague", type: "checkbox" },
                      {
                        name: "delegatedFromUserId",
                        label: "Covering for",
                        type: "select",
                        options: others.map((o) => ({ value: o.id, label: o.displayName })),
                      },
                      { name: "reason", label: "Reason", type: "textarea", required: true },
                    ]}
                  />
                )
              }
            />
            {activeRoles.length === 0 ? (
              <CardBody>
                <p className="text-[13px] text-muted">No active roles. This person cannot access anything.</p>
              </CardBody>
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <tr>
                      <TH>Role</TH>
                      <TH>Scope</TH>
                      <TH>Period</TH>
                      <TH>Granted by</TH>
                      {manage && (
                        <TH>
                          <span className="sr-only">Actions</span>
                        </TH>
                      )}
                    </tr>
                  </THead>
                  <tbody>
                    {activeRoles.map((r) => (
                      <TR key={r.id}>
                        <TD>
                          <span className="font-medium">{r.role.name}</span>
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {r.role.requiresMfa && <Badge tone="info">MFA required</Badge>}
                            {r.isDelegation && (
                              <Badge tone="warning">Cover for {r.delegatedFrom?.displayName}</Badge>
                            )}
                            {r.effectiveFrom > now && <Badge tone="outline">Starts later</Badge>}
                          </div>
                        </TD>
                        <TD className="text-[13px]">
                          {r.allBranches ? "All branches" : r.branch?.name}
                          {r.department ? ` · ${r.department.name}` : ""}
                        </TD>
                        <TD className="whitespace-nowrap text-[13px]">
                          {formatDate(r.effectiveFrom)} –{" "}
                          {r.effectiveTo ? formatDate(r.effectiveTo) : "ongoing"}
                        </TD>
                        <TD className="text-[13px]">{r.grantedBy?.displayName ?? "System"}</TD>
                        {manage && (
                          <TD className="text-right">
                            <ActionDialog
                              action={revokeRoleAction}
                              fixed={{ userRoleId: r.id }}
                              trigger="Revoke"
                              triggerVariant="ghost"
                              title={`Revoke ${r.role.name}?`}
                              description="Access is removed immediately. The assignment stays in history."
                              submitLabel="Revoke role"
                              tone="danger"
                              successMessage="Role revoked."
                              fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
                            />
                          </TD>
                        )}
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </Card>
          {pastRoles.length > 0 && (
            <Card>
              <CardHeader title="Role history" />
              <ul className="divide-y divide-border text-[13px]">
                {pastRoles.map((r) => (
                  <li key={r.id} className="px-5 py-2.5">
                    <span className="font-medium">{r.role.name}</span> ·{" "}
                    {r.allBranches ? "All branches" : r.branch?.name} · {formatDate(r.effectiveFrom)} –{" "}
                    {r.revokedAt
                      ? `revoked ${formatDate(r.revokedAt)} by ${r.revokedBy?.displayName ?? "?"}${r.revokedReason ? ` (${r.revokedReason})` : ""}`
                      : r.effectiveTo
                        ? `ended ${formatDate(r.effectiveTo)}`
                        : ""}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {sessions && (
            <Card>
              <CardHeader
                title="Active sessions"
                actions={
                  sessions.length > 0 &&
                  !self && (
                    <ConfirmAction
                      action={revokeSessionsAction}
                      fixed={{ userId: u.id }}
                      trigger="Sign out everywhere"
                      title="End all sessions?"
                      description="The user will need to sign in again on every device."
                      submitLabel="End sessions"
                      tone="danger"
                      successMessage="Sessions ended."
                    />
                  )
                }
              />
              {sessions.length === 0 ? (
                <CardBody>
                  <p className="text-[13px] text-muted">No active sessions.</p>
                </CardBody>
              ) : (
                <ul className="divide-y divide-border text-[13px]">
                  {sessions.map((s) => (
                    <li key={s.id} className="px-5 py-2.5">
                      Signed in {formatDateTime(s.createdAt)} · last active {formatDateTime(s.lastSeenAt)} ·{" "}
                      {s.ip ?? "unknown IP"}
                      <span className="block truncate text-muted">{s.userAgent}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Account" />
            <CardBody className="space-y-4">
              <DescriptionList
                className="sm:grid-cols-1"
                items={[
                  [
                    "Status",
                    <Badge key="s" tone={u.status === "ACTIVE" ? "success" : "outline"}>
                      {u.status.toLowerCase()}
                    </Badge>,
                  ],
                  ["Two-step verification", u.mfaEnabled ? "Enabled" : "Not enabled"],
                  ["Staff number", u.staffNumber],
                  ["Phone", u.phoneE164 ? formatPhone(u.phoneE164) : null],
                  ["Last sign-in", u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"],
                  ["Created", formatDateTime(u.createdAt)],
                  ...(u.lockedUntil && u.lockedUntil > now
                    ? ([["Locked until", formatDateTime(u.lockedUntil)]] as [string, string][])
                    : []),
                  ...(u.statusReason ? ([["Status reason", u.statusReason]] as [string, string][]) : []),
                ]}
              />
              <div className="flex flex-wrap gap-2">
                {manage && (
                  <ActionDialog
                    action={setUserStatusAction}
                    fixed={{ userId: u.id }}
                    trigger="Change status"
                    title="Account status"
                    description="Suspending or deactivating ends all of the person's sessions immediately."
                    submitLabel="Save"
                    successMessage="Account status updated."
                    fields={[
                      {
                        name: "status",
                        label: "Status",
                        type: "select",
                        required: true,
                        defaultValue: u.status,
                        options: [
                          { value: "ACTIVE", label: "Active" },
                          { value: "SUSPENDED", label: "Suspended (e.g. leave, investigation)" },
                          { value: "INACTIVE", label: "Inactive (left the hospital)" },
                        ],
                      },
                      { name: "reason", label: "Reason", type: "textarea", required: true },
                    ]}
                  />
                )}
                {creds && <ResetLinkButton userId={u.id} />}
                {creds && u.mfaEnabled && (
                  <ActionDialog
                    action={resetMfaAction}
                    fixed={{ userId: u.id }}
                    trigger="Reset two-step"
                    triggerVariant="ghost"
                    title="Reset two-step verification"
                    description="Use when the person lost their device. Confirm their identity first. They must enrol again."
                    submitLabel="Reset"
                    tone="danger"
                    successMessage="Two-step verification reset."
                    fields={[
                      {
                        name: "reason",
                        label: "Reason and identity check performed",
                        type: "textarea",
                        required: true,
                      },
                    ]}
                  />
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
