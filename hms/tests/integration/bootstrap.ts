import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PERMISSIONS, permissionAction, permissionResource } from "../../src/server/authz/permissions";
import { ROLE_TEMPLATES } from "../../src/server/authz/role-templates";

const prisma = new PrismaClient();

async function main() {
  await prisma.permission.createMany({
    data: PERMISSIONS.map((p) => ({
      code: p.code,
      resource: permissionResource(p.code),
      action: permissionAction(p.code),
      description: p.description,
      sensitivity: p.sensitivity,
    })),
    skipDuplicates: true,
  });
  for (const t of ROLE_TEMPLATES) {
    // Keep test roles identical to the templates on every run.
    const existing = await prisma.role.findUnique({ where: { code: t.code } });
    if (existing) {
      await prisma.rolePermission.deleteMany({ where: { roleId: existing.id } });
      await prisma.rolePermission.createMany({
        data: [...new Set(t.permissions)].map((permissionCode) => ({ roleId: existing.id, permissionCode })),
      });
      continue;
    }
    await prisma.role.create({
      data: {
        code: t.code,
        name: t.name,
        kind: t.kind,
        requiresMfa: t.requiresMfa,
        isSystemTemplate: true,
        permissions: { create: [...new Set(t.permissions)].map((permissionCode) => ({ permissionCode })) },
      },
    });
  }
  const org = (await prisma.organization.findFirst()) ?? (await prisma.organization.create({ data: { name: "Test Hospital" } }));
  for (const code of ["T-MAIN", "T-OTHER"]) {
    const b = await prisma.branch.upsert({
      where: { code },
      create: { organizationId: org.id, code, name: code, status: "ACTIVE", verificationStatus: "VERIFIED" },
      update: {},
    });
    await prisma.visitType.upsert({
      where: { code: `GOPD-${code}` },
      create: { code: `GOPD-${code}`, name: `General ${code}`, defaultDurationMin: 15 },
      update: {},
    });
    await prisma.department.upsert({
      where: { branchId_code: { branchId: b.id, code: "OPD" } },
      create: { branchId: b.id, code: "OPD", name: "Outpatients", kind: "CLINICAL" },
      update: {},
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
