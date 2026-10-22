import type { Metadata } from "next";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { listUsers } from "@/server/domains/staff/users";
import { formatDateTime } from "@/lib/time";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { load } from "../../_lib/guard";

export const metadata: Metadata = { title: "Staff & access" };

export default async function UsersPage() {
  const ctx = await requireAuthContext();
  const res = await load(ctx, "/admin/users", () => listUsers(ctx));
  if (!res.ok) return <Forbidden message={res.message} />;
  const users = res.data;
  return (
    <>
      <PageHeader
        title="Staff & access"
        description="Staff accounts and their scoped role assignments. Employment records, rosters and payroll arrive in Phase 6."
        actions={
          can(ctx, "users.manage") && (
            <Button asChild>
              <Link prefetch={false} href="/admin/users/new">
                <UserPlus className="h-4 w-4" aria-hidden /> Add staff account
              </Link>
            </Button>
          )
        }
      />
      <Card>
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Roles</TH>
                <TH>Status</TH>
                <TH>2-step</TH>
                <TH>Last sign-in</TH>
              </tr>
            </THead>
            <tbody>
              {users.map((u) => (
                <TR key={u.id}>
                  <TD>
                    <Link prefetch={false} href={`/admin/users/${u.id}`} className="font-medium hover:text-accent hover:underline">
                      {u.displayName}
                    </Link>
                    <div className="text-[13px] text-muted">
                      {u.jobTitle ?? "-"} · {u.email}
                    </div>
                  </TD>
                  <TD>
                    <div className="flex max-w-md flex-wrap gap-1">
                      {u.roles.length === 0 && <span className="text-[13px] text-muted">No active roles</span>}
                      {u.roles.map((r) => (
                        <Badge key={r.id} tone={r.isDelegation ? "warning" : "neutral"} title={r.allBranches ? "All branches" : r.branch?.name}>
                          {r.role.name.split(" /")[0]}
                          {r.isDelegation ? " (cover)" : ""}
                        </Badge>
                      ))}
                    </div>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={u.status === "ACTIVE" ? "success" : "outline"}>{u.status.toLowerCase()}</Badge>
                      {u.lockedUntil && u.lockedUntil > new Date() && <Badge tone="danger">Locked</Badge>}
                      {u.isDemo && <Badge tone="warning">Demo</Badge>}
                    </div>
                  </TD>
                  <TD>{u.mfaEnabled ? <Badge tone="success">On</Badge> : <Badge tone="outline">Off</Badge>}</TD>
                  <TD className="whitespace-nowrap text-[13px]">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
    </>
  );
}
