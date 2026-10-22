import type { DbClient } from "../db";
import { recordAudit } from "../audit";
import { PERMISSIONS, permissionAction, permissionResource } from "./permissions";
import { ROLE_TEMPLATES } from "./role-templates";

/**
 * Bring the permission catalogue in the database up to date with the code.
 *
 * - Unknown permissions are created.
 * - A permission that is NEW in this release is granted to the system-template roles whose template
 *   includes it (so new features are usable), and each grant is audited.
 * - Existing role grants are never removed or overwritten: changes to running roles go through the
 *   two-person role-change workflow.
 */
export async function syncPermissionCatalog(db: DbClient): Promise<{ created: string[]; granted: { role: string; permission: string }[] }> {
  const existing = new Set((await db.permission.findMany({ select: { code: true } })).map((p) => p.code));
  const created: string[] = [];
  for (const p of PERMISSIONS) {
    await db.permission.upsert({
      where: { code: p.code },
      create: {
        code: p.code,
        resource: permissionResource(p.code),
        action: permissionAction(p.code),
        description: p.description,
        sensitivity: p.sensitivity,
      },
      update: { description: p.description, sensitivity: p.sensitivity },
    });
    if (!existing.has(p.code)) created.push(p.code);
  }
  const granted: { role: string; permission: string }[] = [];
  if (existing.size > 0 && created.length > 0) {
    for (const t of ROLE_TEMPLATES) {
      const role = await db.role.findUnique({ where: { code: t.code } });
      if (!role || !role.isSystemTemplate) continue;
      for (const code of created.filter((c) => (t.permissions as string[]).includes(c))) {
        await db.rolePermission.createMany({ data: [{ roleId: role.id, permissionCode: code }], skipDuplicates: true });
        granted.push({ role: t.code, permission: code });
      }
    }
    if (granted.length) {
      await recordAudit(db, {
        actorType: "SYSTEM",
        action: "roles.release_permissions_added",
        resourceType: "Role",
        details: { granted },
      });
    }
  }
  return { created, granted };
}
