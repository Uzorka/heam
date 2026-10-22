import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { syncPermissionCatalog } from "../../src/server/authz/catalog-sync";
import { ROLE_TEMPLATES } from "../../src/server/authz/role-templates";

const prisma = new PrismaClient();

async function main() {
  await syncPermissionCatalog(prisma);
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
  const org =
    (await prisma.organization.findFirst()) ??
    (await prisma.organization.create({ data: { name: "Test Hospital" } }));
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
  await prisma.labTestDefinition.upsert({
    where: { code: "T-HB" },
    update: {},
    create: {
      code: "T-HB",
      name: "Haemoglobin (test)",
      specimenType: "EDTA blood",
      components: {
        create: [
          {
            code: "HB",
            name: "Haemoglobin",
            unit: "g/dL",
            resultType: "NUMERIC",
            decimals: 1,
            allowedValues: [],
          },
        ],
      },
    },
  });
  await prisma.labTestDefinition.upsert({
    where: { code: "T-MP" },
    update: {},
    create: {
      code: "T-MP",
      name: "Malaria parasite (test)",
      specimenType: "EDTA blood",
      components: {
        create: [
          {
            code: "MP",
            name: "Malaria parasites",
            resultType: "CODED",
            allowedValues: ["Not seen", "Seen (+)", "Seen (++)", "Seen (+++)"],
          },
        ],
      },
    },
  });
  await prisma.imagingStudyDefinition.upsert({
    where: { code: "T-CXR" },
    update: {},
    create: { code: "T-CXR", name: "Chest X-ray PA (test)", modality: "XRAY", bodyPart: "Chest" },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
