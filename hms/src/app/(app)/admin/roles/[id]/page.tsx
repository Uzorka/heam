import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { PERMISSIONS } from "@/server/authz/permissions";
import { getRole } from "@/server/domains/staff/roles";
import { formatDateTime } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Forbidden, PageHeader } from "@/components/ui/misc";
import { ActionDialog, ConfirmAction } from "@/components/forms/action-form";
import { load } from "../../../_lib/guard";
import { cancelRoleChangeAction, requestRoleChangeAction } from "../../actions";

export const metadata: Metadata = { title: "Role" };

const SENS_TONE = {
  LOW: "neutral",
  ADMIN: "info",
  PHI: "warning",
  CLINICAL: "danger",
  FINANCIAL: "accent",
  HR: "success",
} as const;

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await load(ctx, `/admin/roles/${id}`, () => getRole(ctx, id));
  if (!res.ok) return res.kind === "notfound" ? notFound() : <Forbidden message={res.message} />;
  const role = res.data;
  const held = new Set(role.permissions.map((p) => p.permissionCode));
  const groups = [...new Set(PERMISSIONS.map((p) => p.code.split(".")[0]!))];
  const pending = role.changeRequests.find((r) => r.status === "PENDING");

  return (
    <>
      <PageHeader
        title={role.name}
        description={role.description ?? undefined}
        back={{ href: "/admin/roles", label: "Roles & permissions" }}
        actions={
          can(ctx, "roles.request_change") &&
          !pending && (
            <ActionDialog
              action={requestRoleChangeAction}
              fixed={{ roleId: role.id }}
              trigger="Propose change"
              triggerVariant="primary"
              triggerSize="md"
              title={`Propose change to ${role.name}`}
              description="A different person with approval rights must approve before it takes effect."
              submitLabel="Submit for approval"
              successMessage="Change submitted for approval."
              fields={[
                {
                  name: "add",
                  label: "Add permissions",
                  type: "multicheck",
                  options: PERMISSIONS.filter((p) => !held.has(p.code)).map((p) => ({
                    value: p.code,
                    label: p.code,
                    hint: `${p.description} · ${p.sensitivity}`,
                  })),
                },
                {
                  name: "remove",
                  label: "Remove permissions",
                  type: "multicheck",
                  options: PERMISSIONS.filter((p) => held.has(p.code)).map((p) => ({
                    value: p.code,
                    label: p.code,
                    hint: p.description,
                  })),
                },
                { name: "reason", label: "Reason", type: "textarea", required: true },
              ]}
            />
          )
        }
      />
      {pending && (
        <Card className="mb-5 border-warning/50">
          <CardHeader
            title="Change awaiting approval"
            description={`By ${pending.requestedBy.displayName} · ${formatDateTime(pending.requestedAt)}`}
            actions={
              pending.requestedById === ctx.userId && (
                <ConfirmAction
                  action={cancelRoleChangeAction}
                  fixed={{ requestId: pending.id }}
                  trigger="Withdraw"
                  title="Withdraw this request?"
                  description="The role stays as it is."
                  submitLabel="Withdraw"
                  successMessage="Request withdrawn."
                />
              )
            }
          />
          <CardBody className="flex flex-wrap gap-1">
            {pending.addPermissions.map((c) => (
              <Badge key={c} tone="success">
                + {c}
              </Badge>
            ))}
            {pending.removePermissions.map((c) => (
              <Badge key={c} tone="danger">
                − {c}
              </Badge>
            ))}
          </CardBody>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => {
          const perms = PERMISSIONS.filter((p) => p.code.startsWith(`${g}.`));
          const count = perms.filter((p) => held.has(p.code)).length;
          return (
            <Card key={g}>
              <CardHeader title={g} description={`${count} of ${perms.length}`} />
              <ul className="space-y-1.5 px-5 py-3 text-[13px]">
                {perms.map((p) => (
                  <li key={p.code} className={held.has(p.code) ? "" : "text-muted/70"}>
                    <span aria-hidden>{held.has(p.code) ? "✓ " : "· "}</span>
                    <span className="sr-only">{held.has(p.code) ? "Granted: " : "Not granted: "}</span>
                    <span className="font-mono">{p.code}</span>{" "}
                    {held.has(p.code) && <Badge tone={SENS_TONE[p.sensitivity]}>{p.sensitivity}</Badge>}
                    <span className="block pl-4 text-xs text-muted">{p.description}</span>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
      {role.changeRequests.filter((r) => r.status !== "PENDING").length > 0 && (
        <Card className="mt-5">
          <CardHeader title="Change history" />
          <ul className="divide-y divide-border text-[13px]">
            {role.changeRequests
              .filter((r) => r.status !== "PENDING")
              .map((r) => (
                <li key={r.id} className="px-5 py-2.5">
                  <Badge tone={r.status === "APPROVED" ? "success" : "outline"}>
                    {r.status.toLowerCase()}
                  </Badge>{" "}
                  {r.addPermissions.length} added, {r.removePermissions.length} removed · requested by{" "}
                  {r.requestedBy.displayName}
                  {r.decidedBy ? `, decided by ${r.decidedBy.displayName}` : ""} · {r.reason}
                </li>
              ))}
          </ul>
        </Card>
      )}
    </>
  );
}
