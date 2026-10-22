import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { Forbidden, PageHeader } from "@/components/ui/misc";
import { allowed } from "../../../_lib/guard";
import { NewUserForm } from "./new-user-form";

export const metadata: Metadata = { title: "Add staff account" };

export default async function NewUserPage() {
  const ctx = await requireAuthContext();
  if (!(await allowed(ctx, "/admin/users/new", ["users.manage"]))) return <Forbidden />;
  const [roles, branches] = await Promise.all([
    prisma.role.findMany({ where: { active: true, kind: "STAFF" }, orderBy: { name: "asc" }, select: { id: true, name: true, requiresMfa: true } }),
    prisma.branch.findMany({ where: { status: { not: "INACTIVE" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <>
      <PageHeader title="Add staff account" description="The person sets their own password with a one-time link. Administrators never see or choose passwords." back={{ href: "/admin/users", label: "Staff & access" }} />
      <NewUserForm roles={roles} branches={branches} defaultBranchId={ctx.activeBranchId ?? branches[0]?.id ?? ""} />
    </>
  );
}
