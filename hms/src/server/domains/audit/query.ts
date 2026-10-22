import type { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "../../db";
import { requirePermission, type AuthContext } from "../../authz/context";
import { verifyAuditChain } from "../../audit";
import { localDayRange } from "@/lib/time";

export interface AuditQuery {
  from?: string;
  to?: string;
  action?: string;
  actorUserId?: string;
  patientId?: string;
  outcome?: "SUCCESS" | "DENIED" | "FAILURE";
  page: number;
}

const PAGE_SIZE = 50;

/** Audit trail viewer. Returns identifiers and action metadata only - never clinical content. */
export async function queryAudit(ctx: AuthContext, q: AuditQuery, db: DbClient = prisma) {
  requirePermission(ctx, "audit.read");
  const where: Prisma.AuditEventWhereInput = {};
  if (q.from || q.to) {
    where.occurredAt = {
      ...(q.from ? { gte: localDayRange(q.from).start } : {}),
      ...(q.to ? { lt: localDayRange(q.to).end } : {}),
    };
  }
  if (q.action) where.action = { startsWith: q.action };
  if (q.actorUserId) where.actorUserId = q.actorUserId;
  if (q.patientId) where.patientId = q.patientId;
  if (q.outcome) where.outcome = q.outcome;
  const [total, rows] = await Promise.all([
    db.auditEvent.count({ where }),
    db.auditEvent.findMany({
      where,
      orderBy: { seq: "desc" },
      skip: (q.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))];
  const actors = await db.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, displayName: true },
  });
  return {
    total,
    page: q.page,
    pageSize: PAGE_SIZE,
    rows: rows.map((r) => ({
      ...r,
      seq: r.seq.toString(),
      actorName: actors.find((a) => a.id === r.actorUserId)?.displayName ?? null,
    })),
  };
}

export async function verifyChain(ctx: AuthContext) {
  requirePermission(ctx, "audit.read");
  return verifyAuditChain();
}
