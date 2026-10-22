import type { Prisma, PatientStatus, SexAtBirth } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { blindIndex, decryptField, encryptField } from "../../crypto";
import { can, requireActingBranch, requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { isValidMrn, nextMrn } from "../../sequence";
import { normalizePhone, maskPhone } from "@/lib/phone";
import { calendarDateToUtcMidnight, formatAge, parseLocalDate, todayLocal } from "@/lib/time";
import { maskIdentifier } from "@/lib/mask";
import type { registerPatientSchema, searchPatientsSchema, statusSchema, updatePatientSchema } from "@/lib/schemas/patient";
import { buildNameSearch, normalizeName } from "./normalize";
import { DUPLICATE_WARN_THRESHOLD, orderedPair, scoreDuplicate, type DuplicateProbe } from "./duplicates";
import { patientScopeWhere } from "./scope";

export interface PatientSummary {
  id: string;
  mrn: string;
  name: string;
  sexAtBirth: SexAtBirth;
  age: string | null;
  maskedPhone: string;
  status: PatientStatus;
  registrationStatus: "COMPLETE" | "PROVISIONAL";
  lastVisitAt: Date | null;
}

export interface DuplicateCandidate {
  id: string;
  mrn: string;
  name: string;
  birthYear: number | null;
  maskedPhone: string;
  score: number;
  reasons: string[];
}

export function identifierIndex(type: string, value: string): string {
  return blindIndex(value, `patient-identifier:${type}`);
}

function fullName(p: { givenName: string; middleName?: string | null; familyName: string }) {
  return [p.givenName, p.middleName, p.familyName].filter(Boolean).join(" ");
}

function resolveDob(input: { dateOfBirth?: string; estimatedAgeYears?: number }, now = new Date()): Date | null {
  if (input.dateOfBirth) {
    const dob = calendarDateToUtcMidnight(input.dateOfBirth);
    const today = calendarDateToUtcMidnight(todayLocal(now));
    if (dob > today) throw new ValidationError("Date of birth cannot be in the future.", { dateOfBirth: "Cannot be in the future" });
    if (today.getUTCFullYear() - dob.getUTCFullYear() > 130) {
      throw new ValidationError("Date of birth is implausible.", { dateOfBirth: "Check the year" });
    }
    return dob;
  }
  if (input.estimatedAgeYears !== undefined) {
    const { y, m, d } = parseLocalDate(todayLocal(now));
    return new Date(Date.UTC(y - input.estimatedAgeYears, m - 1, d));
  }
  return null;
}

// ───────────── Duplicate detection ─────────────

export async function findDuplicateCandidates(
  db: DbClient,
  probe: DuplicateProbe,
  excludeId?: string,
): Promise<DuplicateCandidate[]> {
  const given = normalizeName(probe.givenName);
  const family = normalizeName(probe.familyName);
  const or: Prisma.PatientWhereInput[] = [];
  if (probe.phones.length) {
    or.push({ phoneE164: { in: probe.phones } }, { altPhoneE164: { in: probe.phones } });
  }
  if (probe.identifierIndexes.length) {
    or.push({ identifiers: { some: { blindIndex: { in: probe.identifierIndexes }, revokedAt: null } } });
  }
  if (probe.dateOfBirth) {
    or.push({
      dateOfBirth: probe.dateOfBirth,
      OR: [{ nameSearch: { contains: family } }, { nameSearch: { contains: given } }],
    });
  }
  if (given && family) {
    or.push({ AND: [{ nameSearch: { contains: given } }, { nameSearch: { contains: family } }] });
  }
  if (!or.length) return [];
  const rows = await db.patient.findMany({
    where: { OR: or, status: { not: "MERGED" }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: {
      id: true,
      mrn: true,
      givenName: true,
      familyName: true,
      dateOfBirth: true,
      phoneE164: true,
      altPhoneE164: true,
      identifiers: { where: { revokedAt: null }, select: { blindIndex: true } },
    },
    take: 25,
  });
  return rows
    .map((r) => {
      const s = scoreDuplicate(probe, {
        id: r.id,
        givenName: r.givenName,
        familyName: r.familyName,
        dateOfBirth: r.dateOfBirth,
        phones: [r.phoneE164, r.altPhoneE164].filter((x): x is string => !!x),
        identifierIndexes: r.identifiers.map((i) => i.blindIndex),
      });
      return {
        id: r.id,
        mrn: r.mrn,
        name: `${r.givenName.slice(0, 1)}. ${r.familyName}`,
        birthYear: r.dateOfBirth?.getUTCFullYear() ?? null,
        maskedPhone: maskPhone(r.phoneE164),
        ...s,
      };
    })
    .filter((c) => c.score >= DUPLICATE_WARN_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}

// ───────────── Registration ─────────────

export type RegisterResult =
  | { status: "DUPLICATES_FOUND"; candidates: DuplicateCandidate[] }
  | { status: "CREATED"; patientId: string; mrn: string };

export async function registerPatient(
  ctx: AuthContext,
  input: z.output<typeof registerPatientSchema>,
  db: DbClient = prisma,
): Promise<RegisterResult> {
  const branchId = requireActingBranch(ctx, "patient.create");
  const dob = resolveDob(input);
  const dobProvenance = input.estimatedAgeYears !== undefined ? "ESTIMATED" : dob ? input.dobProvenance : "UNKNOWN";
  const identifierValue = input.identifier?.value?.replace(/\s+/g, "");
  const idIndex = identifierValue && input.identifier ? identifierIndex(input.identifier.type, identifierValue) : null;

  const probe: DuplicateProbe = {
    givenName: input.givenName,
    familyName: input.familyName,
    dateOfBirth: dob,
    phones: [input.phone, input.altPhone].filter((x): x is string => !!x),
    identifierIndexes: idIndex ? [idIndex] : [],
  };
  const candidates = await findDuplicateCandidates(db, probe);
  const unacknowledged = candidates.filter((c) => !input.acknowledgedDuplicateIds.includes(c.id));
  if (unacknowledged.length) return { status: "DUPLICATES_FOUND", candidates };

  return withTx(db, async (tx) => {
    const mrn = await nextMrn(tx);
    const patient = await tx.patient.create({
      data: {
        mrn,
        registeredBranchId: branchId,
        givenName: input.givenName,
        middleName: input.middleName,
        familyName: input.familyName,
        preferredName: input.preferredName,
        nameSearch: buildNameSearch(input),
        dateOfBirth: dob,
        dobProvenance,
        sexAtBirth: input.sexAtBirth,
        genderIdentity: input.genderIdentity,
        phoneE164: input.phone,
        altPhoneE164: input.altPhone,
        email: input.email,
        addressLine: input.addressLine,
        city: input.city,
        lga: input.lga,
        state: input.state,
        occupation: input.occupation,
        maritalStatus: input.maritalStatus,
        preferredLanguage: input.preferredLanguage,
        referralSource: input.referralSource,
        registrationStatus: input.registrationStatus,
        allergyReviewStatus: input.allergyReviewStatus,
        createdById: ctx.userId,
      },
    });
    if (input.nextOfKin?.name && input.nextOfKin.relationship) {
      await tx.patientContact.create({
        data: {
          patientId: patient.id,
          kind: "BOTH",
          name: input.nextOfKin.name,
          relationship: input.nextOfKin.relationship,
          phoneE164: input.nextOfKin.phone,
          isPrimary: true,
        },
      });
    }
    if (identifierValue && input.identifier && idIndex) {
      await tx.patientIdentifier.create({
        data: {
          patientId: patient.id,
          type: input.identifier.type,
          valueEnc: encryptField(identifierValue),
          valueLast4: identifierValue.slice(-4),
          blindIndex: idIndex,
          createdById: ctx.userId,
        },
      });
    }
    if (input.privacyNoticeGiven) {
      await tx.consentRecord.create({
        data: {
          patientId: patient.id,
          type: "DATA_PROCESSING_NOTICE",
          status: "GRANTED",
          legalBasis: "CONTRACT",
          noticeVersion: "draft-1 (pending legal review)",
          capturedById: ctx.userId,
        },
      });
    }
    await tx.consentRecord.create({
      data: {
        patientId: patient.id,
        type: "SMS_REMINDERS",
        status: input.smsReminderConsent ? "GRANTED" : "DECLINED",
        legalBasis: "CONSENT",
        capturedById: ctx.userId,
      },
    });
    for (const c of candidates) {
      const [a, b] = orderedPair(patient.id, c.id);
      await tx.duplicatePatientReview.upsert({
        where: { patientAId_patientBId: { patientAId: a, patientBId: b } },
        create: { patientAId: a, patientBId: b, score: c.score, reasons: c.reasons, raisedById: ctx.userId },
        update: {},
      });
    }
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "patient.create",
      resourceType: "Patient",
      resourceId: patient.id,
      patientId: patient.id,
      branchId,
      details: {
        mrn,
        registrationStatus: input.registrationStatus,
        acknowledgedDuplicates: candidates.length,
      },
      meta: ctx.meta,
    });
    return { status: "CREATED" as const, patientId: patient.id, mrn };
  });
}

// ───────────── Search ─────────────

export async function searchPatients(
  ctx: AuthContext,
  input: z.output<typeof searchPatientsSchema>,
  db: DbClient = prisma,
): Promise<{ rows: PatientSummary[]; total: number; page: number; pageSize: number }> {
  const scope = patientScopeWhere(ctx, "patient.search");
  if (!scope) throw new ForbiddenError(undefined, "patient.search");

  const q = input.q.trim();
  const filters: Prisma.PatientWhereInput[] = [scope];
  filters.push(input.includeInactive ? { status: { not: "MERGED" } } : { status: { in: ["ACTIVE", "DECEASED"] } });
  if (q) {
    const upper = q.toUpperCase().replace(/\s+/g, "");
    const phone = /^[+\d][\d\s-]{6,}$/.test(q) ? normalizePhone(q) : null;
    if (/^ADK\d+$/.test(upper)) {
      filters.push({ mrn: isValidMrn(upper) ? upper : { startsWith: upper } });
    } else if (phone) {
      filters.push({ OR: [{ phoneE164: phone }, { altPhoneE164: phone }] });
    } else {
      const tokens = normalizeName(q).split(" ").filter((t) => t.length >= 2).slice(0, 4);
      if (!tokens.length) return { rows: [], total: 0, page: input.page, pageSize: input.pageSize };
      for (const t of tokens) filters.push({ nameSearch: { contains: t } });
    }
  }
  const where: Prisma.PatientWhereInput = { AND: filters };
  const [total, rows] = await Promise.all([
    db.patient.count({ where }),
    db.patient.findMany({
      where,
      orderBy: q ? [{ familyName: "asc" }, { givenName: "asc" }] : { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        mrn: true,
        givenName: true,
        middleName: true,
        familyName: true,
        sexAtBirth: true,
        dateOfBirth: true,
        phoneE164: true,
        status: true,
        registrationStatus: true,
        encounters: { orderBy: { arrivedAt: "desc" }, take: 1, select: { arrivedAt: true } },
      },
    }),
  ]);
  return {
    total,
    page: input.page,
    pageSize: input.pageSize,
    rows: rows.map((r) => ({
      id: r.id,
      mrn: r.mrn,
      name: fullName(r),
      sexAtBirth: r.sexAtBirth,
      age: r.dateOfBirth ? formatAge(r.dateOfBirth) : null,
      maskedPhone: maskPhone(r.phoneE164),
      status: r.status,
      registrationStatus: r.registrationStatus,
      lastVisitAt: r.encounters[0]?.arrivedAt ?? null,
    })),
  };
}

// ───────────── Detail ─────────────

/** Load a patient the caller may see under `permission`; NotFound if missing or out of scope. */
export async function loadScopedPatient(
  ctx: AuthContext,
  patientId: string,
  permission: "patient.read" | "patient.update" | "patient.search" | "patient.status.manage" | "patient.identifiers.read",
  db: DbClient = prisma,
) {
  const scope = patientScopeWhere(ctx, permission);
  if (!scope) throw new ForbiddenError(undefined, permission);
  const patient = await db.patient.findFirst({ where: { AND: [{ id: patientId }, scope] } });
  if (!patient) throw new NotFoundError("Patient not found.");
  return patient;
}

export async function getPatientDetail(ctx: AuthContext, patientId: string, db: DbClient = prisma) {
  const patient = await loadScopedPatient(ctx, patientId, "patient.read", db);
  const [contacts, allergies, consents, identifiers, guardians, dependents, mergedInto] = await Promise.all([
    db.patientContact.findMany({ where: { patientId, active: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }),
    db.patientAllergy.findMany({ where: { patientId }, orderBy: { recordedAt: "desc" } }),
    db.consentRecord.findMany({ where: { patientId, supersededAt: null }, orderBy: { capturedAt: "desc" } }),
    db.patientIdentifier.findMany({
      where: { patientId, revokedAt: null },
      select: { id: true, type: true, valueLast4: true, issuer: true, verified: true },
    }),
    db.guardianRelationship.findMany({ where: { dependentPatientId: patientId, revokedAt: null } }),
    db.guardianRelationship.findMany({
      where: { guardianPatientId: patientId, revokedAt: null },
      include: { dependent: { select: { id: true, mrn: true, givenName: true, familyName: true } } },
    }),
    patient.mergedIntoId
      ? db.patient.findUnique({ where: { id: patient.mergedIntoId }, select: { id: true, mrn: true } })
      : Promise.resolve(null),
  ]);
  await recordAudit(db, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action: "patient.view",
    resourceType: "Patient",
    resourceId: patient.id,
    patientId: patient.id,
    branchId: ctx.activeBranchId,
    meta: ctx.meta,
  });
  return {
    patient,
    age: patient.dateOfBirth ? formatAge(patient.dateOfBirth) : null,
    contacts,
    allergies,
    consents,
    identifiers: identifiers.map((i) => ({ ...i, masked: maskIdentifier(i.valueLast4) })),
    guardians,
    dependents,
    mergedInto,
    canRevealIdentifiers: can(ctx, "patient.identifiers.read"),
  };
}

export async function revealIdentifier(ctx: AuthContext, identifierId: string, db: DbClient = prisma) {
  const ident = await db.patientIdentifier.findUnique({ where: { id: identifierId } });
  if (!ident) throw new NotFoundError();
  await loadScopedPatient(ctx, ident.patientId, "patient.identifiers.read", db);
  await recordAudit(db, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action: "patient.identifier.reveal",
    resourceType: "PatientIdentifier",
    resourceId: ident.id,
    patientId: ident.patientId,
    details: { type: ident.type },
    meta: ctx.meta,
  });
  return { type: ident.type, value: decryptField(ident.valueEnc) };
}

export async function addIdentifier(
  ctx: AuthContext,
  input: { patientId: string; type: "NIN" | "NHIA_NUMBER" | "PASSPORT" | "VOTERS_CARD" | "DRIVERS_LICENCE" | "OTHER"; value: string; issuer?: string },
  db: DbClient = prisma,
) {
  const patient = await loadScopedPatient(ctx, input.patientId, "patient.update", db);
  const value = input.value.replace(/\s+/g, "");
  if (value.length < 4) throw new ValidationError("Identifier is too short.", { value: "Too short" });
  const idx = identifierIndex(input.type, value);
  const clash = await db.patientIdentifier.findFirst({
    where: { type: input.type, blindIndex: idx, revokedAt: null, patientId: { not: patient.id } },
    select: { patientId: true },
  });
  return withTx(db, async (tx) => {
    const row = await tx.patientIdentifier.create({
      data: {
        patientId: patient.id,
        type: input.type,
        valueEnc: encryptField(value),
        valueLast4: value.slice(-4),
        blindIndex: idx,
        issuer: input.issuer,
        createdById: ctx.userId,
      },
    });
    if (clash) {
      const [a, b] = orderedPair(patient.id, clash.patientId);
      await tx.duplicatePatientReview.upsert({
        where: { patientAId_patientBId: { patientAId: a, patientBId: b } },
        create: { patientAId: a, patientBId: b, score: 60, reasons: ["Same identity document number"], raisedById: ctx.userId },
        update: {},
      });
    }
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "patient.identifier.add",
      resourceType: "PatientIdentifier",
      resourceId: row.id,
      patientId: patient.id,
      details: { type: input.type, duplicateRaised: !!clash },
      meta: ctx.meta,
    });
    return { id: row.id, duplicateRaised: !!clash };
  });
}

// ───────────── Update ─────────────

const TRACKED_FIELDS = [
  "givenName",
  "middleName",
  "familyName",
  "preferredName",
  "dateOfBirth",
  "dobProvenance",
  "sexAtBirth",
  "genderIdentity",
  "phoneE164",
  "altPhoneE164",
  "email",
  "addressLine",
  "city",
  "lga",
  "state",
  "occupation",
  "maritalStatus",
  "preferredLanguage",
  "referralSource",
] as const;

export async function updatePatient(
  ctx: AuthContext,
  input: z.output<typeof updatePatientSchema>,
  db: DbClient = prisma,
): Promise<{ version: number }> {
  const existing = await loadScopedPatient(ctx, input.id, "patient.update", db);
  if (existing.status === "MERGED") throw new ConflictError("Merged records cannot be edited. Edit the surviving record.");
  const dob = resolveDob(input);
  const data = {
    givenName: input.givenName,
    middleName: input.middleName ?? null,
    familyName: input.familyName,
    preferredName: input.preferredName ?? null,
    dateOfBirth: dob,
    dobProvenance: input.estimatedAgeYears !== undefined ? ("ESTIMATED" as const) : dob ? input.dobProvenance : ("UNKNOWN" as const),
    sexAtBirth: input.sexAtBirth,
    genderIdentity: input.genderIdentity ?? null,
    phoneE164: input.phone ?? null,
    altPhoneE164: input.altPhone ?? null,
    email: input.email ?? null,
    addressLine: input.addressLine ?? null,
    city: input.city ?? null,
    lga: input.lga ?? null,
    state: input.state ?? null,
    occupation: input.occupation ?? null,
    maritalStatus: input.maritalStatus ?? null,
    preferredLanguage: input.preferredLanguage ?? null,
    referralSource: input.referralSource ?? null,
  };
  const changed = TRACKED_FIELDS.filter((f) => {
    const before = existing[f];
    const after = data[f];
    if (before instanceof Date || after instanceof Date) {
      return (before as Date | null)?.getTime() !== (after as Date | null)?.getTime();
    }
    return (before ?? null) !== (after ?? null);
  });
  if (!changed.length) return { version: existing.version };

  return withTx(db, async (tx) => {
    const res = await tx.patient.updateMany({
      where: { id: existing.id, version: input.version },
      data: {
        ...data,
        nameSearch: buildNameSearch({
          givenName: data.givenName,
          middleName: data.middleName,
          familyName: data.familyName,
          preferredName: data.preferredName,
        }),
        version: { increment: 1 },
      },
    });
    if (res.count !== 1) {
      throw new ConflictError("This record was changed by someone else. Reload the page and re-apply your edits.", "STALE");
    }
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "patient.update",
      resourceType: "Patient",
      resourceId: existing.id,
      patientId: existing.id,
      details: { fields: [...changed] },
      meta: ctx.meta,
    });
    return { version: input.version + 1 };
  });
}

export async function completeRegistration(ctx: AuthContext, patientId: string, db: DbClient = prisma) {
  const p = await loadScopedPatient(ctx, patientId, "patient.update", db);
  if (p.registrationStatus === "COMPLETE") return;
  const problems: string[] = [];
  if (!p.dateOfBirth) problems.push("date of birth or estimated age");
  const nok = await db.patientContact.count({ where: { patientId, active: true, phoneE164: { not: null } } });
  if (!p.phoneE164 && !nok) problems.push("a patient or next-of-kin phone number");
  const notice = await db.consentRecord.count({
    where: { patientId, type: "DATA_PROCESSING_NOTICE", status: "GRANTED", supersededAt: null },
  });
  if (!notice) problems.push("privacy notice acknowledgement");
  if (problems.length) throw new ValidationError(`Before completing registration, record: ${problems.join(", ")}.`);
  await withTx(db, async (tx) => {
    await tx.patient.update({ where: { id: p.id }, data: { registrationStatus: "COMPLETE", version: { increment: 1 } } });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "patient.registration_completed",
      resourceType: "Patient",
      resourceId: p.id,
      patientId: p.id,
      meta: ctx.meta,
    });
  });
}

// ───────────── Status (inactive / deceased) ─────────────

export async function setPatientStatus(
  ctx: AuthContext,
  input: z.output<typeof statusSchema>,
  db: DbClient = prisma,
): Promise<void> {
  requirePermission(ctx, "patient.status.manage");
  const p = await loadScopedPatient(ctx, input.patientId, "patient.status.manage", db);
  if (p.status === "MERGED") throw new ConflictError("Merged records cannot change status.");
  if (input.status === "DECEASED" && !input.deceasedDate) {
    throw new ValidationError("Date of death is required.", { deceasedDate: "Required" });
  }
  await withTx(db, async (tx) => {
    await tx.patient.update({
      where: { id: p.id },
      data: {
        status: input.status,
        statusReason: input.reason,
        deceasedAt: input.status === "DECEASED" && input.deceasedDate ? calendarDateToUtcMidnight(input.deceasedDate) : null,
        version: { increment: 1 },
      },
    });
    let cancelled = 0;
    if (input.status === "DECEASED") {
      const r = await tx.appointment.updateMany({
        where: { patientId: p.id, status: "BOOKED", startAt: { gt: new Date() } },
        data: { status: "CANCELLED", cancelReason: "Patient record status changed", version: { increment: 1 } },
      });
      cancelled = r.count;
    }
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "patient.status_change",
      resourceType: "Patient",
      resourceId: p.id,
      patientId: p.id,
      details: { from: p.status, to: input.status, futureAppointmentsCancelled: cancelled },
      meta: ctx.meta,
    });
  });
}
