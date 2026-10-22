import { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { branchesWith, can, type AuthContext } from "../../authz/context";
import type { PermissionCode } from "../../authz/permissions";
import { ForbiddenError, ValidationError } from "../../errors";
import { localDayRange } from "@/lib/time";
import { koboToNairaString } from "@/lib/money";

/**
 * Aggregated reports. None of them contains patient identifiers; each has its own permission,
 * and exporting additionally needs export.data and is audited and watermarked.
 */
export interface ReportResult {
  key: ReportKey;
  title: string;
  columns: string[];
  rows: (string | number)[][];
  note?: string;
}

export const REPORTS = {
  visits: { title: "Visits by day and visit type", permission: "report.operational" },
  lab_tat: { title: "Laboratory turnaround (order to verification)", permission: "report.operational" },
  bed_occupancy: { title: "Admissions and discharges by day", permission: "report.operational" },
  diagnoses: { title: "Most frequent diagnoses", permission: "report.clinical" },
  deliveries: { title: "Deliveries by mode and outcome", permission: "report.clinical" },
  revenue: { title: "Charges by service category", permission: "report.financial" },
  collections: { title: "Collections by day and method", permission: "report.financial" },
  claims: { title: "HMO claims by payer and status", permission: "report.hmo" },
} as const satisfies Record<string, { title: string; permission: PermissionCode }>;

export type ReportKey = keyof typeof REPORTS;

export function isReportKey(k: string): k is ReportKey {
  return k in REPORTS;
}

function branchSql(ctx: AuthContext, permission: PermissionCode, column: Prisma.Sql) {
  const b = branchesWith(ctx, permission);
  if (b !== "ALL" && b.length === 0) throw new ForbiddenError(undefined, permission);
  return b === "ALL"
    ? Prisma.sql`TRUE`
    : Prisma.sql`${column} IN (${Prisma.join(b.map((x) => Prisma.sql`${x}::uuid`))})`;
}

export async function runReport(
  ctx: AuthContext,
  key: ReportKey,
  from: string,
  to: string,
  db: DbClient = prisma,
): Promise<ReportResult> {
  const def = REPORTS[key];
  if (!can(ctx, def.permission)) throw new ForbiddenError(undefined, def.permission);
  if (to < from) throw new ValidationError("The end date is before the start date.");
  const start = localDayRange(from).start;
  const end = localDayRange(to).end;
  if (end.getTime() - start.getTime() > 400 * 86_400_000)
    throw new ValidationError("Choose a range of at most about a year.");
  const day = (col: Prisma.Sql) => Prisma.sql`to_char(${col} AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD')`;
  switch (key) {
    case "visits": {
      const rows = await db.$queryRaw<{ d: string; vt: string; n: bigint }[]>`
        SELECT ${day(Prisma.sql`e."arrivedAt"`)} AS d, v."name" AS vt, COUNT(*)::bigint AS n
        FROM "Encounter" e JOIN "VisitType" v ON v."id" = e."visitTypeId"
        WHERE e."arrivedAt" >= ${start} AND e."arrivedAt" < ${end} AND e."status" <> 'CANCELLED'
          AND ${branchSql(ctx, def.permission, Prisma.sql`e."branchId"`)}
        GROUP BY 1, 2 ORDER BY 1, 2`;
      return {
        key,
        title: def.title,
        columns: ["Date", "Visit type", "Visits"],
        rows: rows.map((r) => [r.d, r.vt, Number(r.n)]),
      };
    }
    case "lab_tat": {
      const rows = await db.$queryRaw<{ test: string; n: bigint; median: number; p90: number }[]>`
        SELECT t."name" AS test, COUNT(*)::bigint AS n,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (o."verifiedAt" - o."orderedAt")) / 3600) AS median,
          percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (o."verifiedAt" - o."orderedAt")) / 3600) AS p90
        FROM "ServiceOrder" o JOIN "LabTestDefinition" t ON t."id" = o."labTestId"
        WHERE o."kind" = 'LAB' AND o."verifiedAt" >= ${start} AND o."verifiedAt" < ${end}
          AND ${branchSql(ctx, def.permission, Prisma.sql`o."branchId"`)}
        GROUP BY 1 ORDER BY 1`;
      return {
        key,
        title: def.title,
        columns: ["Test", "Verified", "Median hours", "90th percentile hours"],
        rows: rows.map((r) => [
          r.test,
          Number(r.n),
          Math.round(r.median * 10) / 10,
          Math.round(r.p90 * 10) / 10,
        ]),
      };
    }
    case "bed_occupancy": {
      const rows = await db.$queryRaw<{ d: string; admitted: bigint; discharged: bigint }[]>`
        WITH a AS (SELECT ${day(Prisma.sql`"admittedAt"`)} AS d, COUNT(*) AS n FROM "Admission"
                   WHERE "admittedAt" >= ${start} AND "admittedAt" < ${end} AND ${branchSql(ctx, def.permission, Prisma.sql`"branchId"`)} GROUP BY 1),
             x AS (SELECT ${day(Prisma.sql`"dischargedAt"`)} AS d, COUNT(*) AS n FROM "Admission"
                   WHERE "dischargedAt" >= ${start} AND "dischargedAt" < ${end} AND ${branchSql(ctx, def.permission, Prisma.sql`"branchId"`)} GROUP BY 1)
        SELECT COALESCE(a.d, x.d) AS d, COALESCE(a.n, 0)::bigint AS admitted, COALESCE(x.n, 0)::bigint AS discharged
        FROM a FULL OUTER JOIN x ON a.d = x.d ORDER BY 1`;
      return {
        key,
        title: def.title,
        columns: ["Date", "Admitted", "Discharged"],
        rows: rows.map((r) => [r.d, Number(r.admitted), Number(r.discharged)]),
      };
    }
    case "diagnoses": {
      const rows = await db.$queryRaw<{ dx: string; code: string | null; n: bigint }[]>`
        SELECT lower(d."description") AS dx, d."code" AS code, COUNT(*)::bigint AS n
        FROM "Diagnosis" d JOIN "Encounter" e ON e."id" = d."encounterId"
        WHERE d."recordedAt" >= ${start} AND d."recordedAt" < ${end} AND d."status" <> 'ENTERED_IN_ERROR' AND d."certainty" <> 'REFUTED'
          AND ${branchSql(ctx, def.permission, Prisma.sql`e."branchId"`)}
        GROUP BY 1, 2 HAVING COUNT(*) >= 1 ORDER BY 3 DESC LIMIT 50`;
      return {
        key,
        title: def.title,
        columns: ["Diagnosis", "ICD-10", "Count"],
        rows: rows.map((r) => [r.dx, r.code ?? "", Number(r.n)]),
        note: "Counts below 5 should not be published outside the hospital (small numbers can identify people).",
      };
    }
    case "deliveries": {
      const rows = await db.$queryRaw<{ mode: string; outcome: string; n: bigint }[]>`
        SELECT d."mode"::text AS mode, n."outcome"::text AS outcome, COUNT(*)::bigint AS n
        FROM "DeliveryRecord" d JOIN "NewbornRecord" n ON n."deliveryId" = d."id" JOIN "PregnancyEpisode" p ON p."id" = d."episodeId"
        WHERE d."deliveredAt" >= ${start} AND d."deliveredAt" < ${end} AND d."status" = 'SIGNED'
          AND ${branchSql(ctx, def.permission, Prisma.sql`p."branchId"`)}
        GROUP BY 1, 2 ORDER BY 1, 2`;
      return {
        key,
        title: def.title,
        columns: ["Mode", "Outcome", "Babies"],
        rows: rows.map((r) => [r.mode, r.outcome, Number(r.n)]),
      };
    }
    case "revenue": {
      const rows = await db.$queryRaw<{ cat: string; n: bigint; patient: bigint; payer: bigint }[]>`
        SELECT s."category"::text AS cat, COUNT(*)::bigint AS n, COALESCE(SUM(c."patientPortionKobo"), 0)::bigint AS patient, COALESCE(SUM(c."payerPortionKobo"), 0)::bigint AS payer
        FROM "Charge" c JOIN "ServiceItem" s ON s."id" = c."serviceItemId"
        WHERE c."status" = 'ACTIVE' AND c."createdAt" >= ${start} AND c."createdAt" < ${end}
          AND ${branchSql(ctx, def.permission, Prisma.sql`c."branchId"`)}
        GROUP BY 1 ORDER BY 1`;
      return {
        key,
        title: def.title,
        columns: ["Category", "Charges", "Patient share (NGN)", "Payer share (NGN)"],
        rows: rows.map((r) => [r.cat, Number(r.n), koboToNairaString(r.patient), koboToNairaString(r.payer)]),
      };
    }
    case "collections": {
      const rows = await db.$queryRaw<{ d: string; method: string; n: bigint; amount: bigint }[]>`
        SELECT ${day(Prisma.sql`p."confirmedAt"`)} AS d, p."method"::text AS method, COUNT(*)::bigint AS n, SUM(p."amountKobo")::bigint AS amount
        FROM "Payment" p
        WHERE p."status" = 'CONFIRMED' AND p."confirmedAt" >= ${start} AND p."confirmedAt" < ${end}
          AND ${branchSql(ctx, def.permission, Prisma.sql`p."branchId"`)}
        GROUP BY 1, 2 ORDER BY 1, 2`;
      return {
        key,
        title: def.title,
        columns: ["Date", "Method", "Payments", "Amount (NGN)"],
        rows: rows.map((r) => [r.d, r.method, Number(r.n), koboToNairaString(r.amount)]),
      };
    }
    case "claims": {
      const rows = await db.$queryRaw<
        { payer: string; status: string; n: bigint; claimed: bigint; paid: bigint }[]
      >`
        SELECT y."name" AS payer, c."status"::text AS status, COUNT(*)::bigint AS n, SUM(c."claimedKobo")::bigint AS claimed, SUM(c."paidKobo")::bigint AS paid
        FROM "Claim" c JOIN "Payer" y ON y."id" = c."payerId"
        WHERE c."createdAt" >= ${start} AND c."createdAt" < ${end} AND ${branchSql(ctx, def.permission, Prisma.sql`c."branchId"`)}
        GROUP BY 1, 2 ORDER BY 1, 2`;
      return {
        key,
        title: def.title,
        columns: ["Payer", "Status", "Claims", "Claimed (NGN)", "Paid (NGN)"],
        rows: rows.map((r) => [
          r.payer,
          r.status,
          Number(r.n),
          koboToNairaString(r.claimed),
          koboToNairaString(r.paid),
        ]),
      };
    }
  }
}

const cell = (v: string | number) => {
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/**
 * CSV export: needs export.data on top of the report's own permission. Every attempt - allowed or
 * denied - is audited, and the file carries a watermark naming the exporter and time.
 */
export async function exportReport(
  ctx: AuthContext,
  key: ReportKey,
  from: string,
  to: string,
  db: DbClient = prisma,
) {
  const allowed = can(ctx, "export.data") && can(ctx, REPORTS[key].permission);
  if (!allowed) {
    await recordAudit(db, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "denied.export.report",
      resourceType: "Report",
      resourceId: key,
      outcome: "DENIED",
      details: { from, to },
      meta: ctx.meta,
    });
    throw new ForbiddenError(undefined, "export.data");
  }
  const r = await runReport(ctx, key, from, to, db);
  const stamp = new Date().toISOString();
  await recordAudit(db, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action: "export.report",
    resourceType: "Report",
    resourceId: key,
    details: { from, to, rows: r.rows.length },
    meta: ctx.meta,
  });
  const lines = [
    `# ${r.title} | ${from} to ${to} | Exported by ${ctx.displayName} (${ctx.email}) at ${stamp} | CONFIDENTIAL - Aduraking HMS`,
    r.columns.map(cell).join(","),
    ...r.rows.map((row) => row.map(cell).join(",")),
  ];
  return { filename: `${key}-${from}-to-${to}.csv`, csv: "﻿" + lines.join("\r\n") + "\r\n" };
}
