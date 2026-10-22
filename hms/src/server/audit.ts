import { Prisma, type ActorType, type AuditOutcome } from "@prisma/client";
import { prisma, withTx, type DbClient, type Tx } from "./db";
import { sha256 } from "./crypto";
import type { RequestMeta } from "./request-meta";

export const GENESIS_HASH = "0".repeat(64);

export interface AuditInput {
  actorType: ActorType;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  patientId?: string | null;
  branchId?: string | null;
  outcome?: AuditOutcome;
  /** Non-PHI metadata only: ids, field names changed, counts, reason codes. */
  details?: Record<string, unknown> | null;
  meta?: RequestMeta;
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

interface HashFields {
  id: string;
  occurredAt: string;
  actorType: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  patientId: string | null;
  branchId: string | null;
  outcome: string;
  details: unknown;
}

export function computeAuditHash(prevHash: string, f: HashFields): string {
  return sha256(prevHash + "|" + canonical(f));
}

/**
 * Append an audit event to the hash chain. Must be called inside the same transaction as the change
 * it records, so the audit entry commits (or rolls back) together with the change.
 */
export async function recordAudit(db: DbClient, input: AuditInput): Promise<void> {
  await withTx(db, async (tx: Tx) => {
    // Serialise chain appends; the lock is released at commit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7243001)`;
    const last = await tx.auditEvent.findFirst({ orderBy: { seq: "desc" }, select: { hash: true } });
    const prevHash = last?.hash ?? GENESIS_HASH;
    const id = crypto.randomUUID();
    const occurredAt = new Date();
    const fields: HashFields = {
      id,
      occurredAt: occurredAt.toISOString(),
      actorType: input.actorType,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      patientId: input.patientId ?? null,
      branchId: input.branchId ?? null,
      outcome: input.outcome ?? "SUCCESS",
      details: input.details ?? null,
    };
    await tx.auditEvent.create({
      data: {
        id,
        occurredAt,
        actorType: input.actorType,
        actorUserId: fields.actorUserId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: fields.resourceId,
        patientId: fields.patientId,
        branchId: fields.branchId,
        outcome: fields.outcome as AuditOutcome,
        details: (input.details ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        requestId: input.meta?.requestId ?? null,
        ip: input.meta?.ip ?? null,
        userAgent: input.meta?.userAgent ?? null,
        prevHash,
        hash: computeAuditHash(prevHash, fields),
      },
    });
  });
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  brokenAtSeq?: string;
  reason?: string;
}

/** Recompute the hash chain. Detects edits, deletions and re-ordering of audit rows. */
export async function verifyAuditChain(batchSize = 2000): Promise<ChainVerification> {
  let prevHash = GENESIS_HASH;
  let cursor: bigint | undefined;
  let checked = 0;
  for (;;) {
    const rows = await prisma.auditEvent.findMany({
      where: cursor !== undefined ? { seq: { gt: cursor } } : undefined,
      orderBy: { seq: "asc" },
      take: batchSize,
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      if (r.prevHash !== prevHash) {
        return {
          ok: false,
          checked,
          brokenAtSeq: r.seq.toString(),
          reason: "prevHash does not match previous row",
        };
      }
      const expected = computeAuditHash(prevHash, {
        id: r.id,
        occurredAt: r.occurredAt.toISOString(),
        actorType: r.actorType,
        actorUserId: r.actorUserId,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        patientId: r.patientId,
        branchId: r.branchId,
        outcome: r.outcome,
        details: r.details,
      });
      if (expected !== r.hash) {
        return {
          ok: false,
          checked,
          brokenAtSeq: r.seq.toString(),
          reason: "row content does not match its hash",
        };
      }
      prevHash = r.hash;
      checked++;
      cursor = r.seq;
    }
  }
  return { ok: true, checked };
}
