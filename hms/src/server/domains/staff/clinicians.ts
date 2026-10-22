import { prisma, type DbClient } from "../../db";

/**
 * Staff who may be booked or assigned as the attending clinician in a branch: active accounts with
 * a current grant (branch or all-branches) whose role includes `clinical.note.sign`.
 */
export async function listClinicians(branchId: string, db: DbClient = prisma) {
  const now = new Date();
  return db.user.findMany({
    where: {
      status: "ACTIVE",
      kind: "STAFF",
      roles: {
        some: {
          revokedAt: null,
          effectiveFrom: { lte: now },
          AND: [
            { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
            { OR: [{ allBranches: true }, { branchId }] },
          ],
          role: { active: true, permissions: { some: { permissionCode: "clinical.note.sign" } } },
        },
      },
    },
    select: { id: true, displayName: true, jobTitle: true },
    orderBy: { displayName: "asc" },
  });
}

export async function isClinicianInBranch(userId: string, branchId: string, db: DbClient = prisma): Promise<boolean> {
  const list = await listClinicians(branchId, db);
  return list.some((u) => u.id === userId);
}
