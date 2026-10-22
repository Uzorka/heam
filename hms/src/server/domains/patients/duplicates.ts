import { editDistance, normalizeName } from "./normalize";

export interface DuplicateProbe {
  givenName: string;
  familyName: string;
  dateOfBirth: Date | null;
  phones: string[];
  identifierIndexes: string[];
}

export interface DuplicateCandidateData extends DuplicateProbe {
  id: string;
}

export interface DuplicateScore {
  score: number;
  reasons: string[];
}

/** Score threshold above which staff are warned before registration completes. */
export const DUPLICATE_WARN_THRESHOLD = 45;

function sameDay(a: Date | null, b: Date | null) {
  return !!a && !!b && a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

/**
 * Explainable duplicate score (0-100). Deliberately conservative: it only ever produces a
 * suggestion for human review; nothing is merged automatically.
 */
export function scoreDuplicate(probe: DuplicateProbe, candidate: DuplicateCandidateData): DuplicateScore {
  let score = 0;
  const reasons: string[] = [];
  const pg = normalizeName(probe.givenName);
  const pf = normalizeName(probe.familyName);
  const cg = normalizeName(candidate.givenName);
  const cf = normalizeName(candidate.familyName);

  if (probe.identifierIndexes.some((i) => candidate.identifierIndexes.includes(i))) {
    score += 60;
    reasons.push("Same identity document number");
  }
  if (probe.phones.some((p) => candidate.phones.includes(p))) {
    score += 30;
    reasons.push("Same phone number");
  }
  if (sameDay(probe.dateOfBirth, candidate.dateOfBirth)) {
    score += 25;
    reasons.push("Same date of birth");
  }
  if (pf && pf === cf) {
    score += 20;
    reasons.push("Same surname");
  } else if (pf && cf && editDistance(pf, cf) <= 2) {
    score += 10;
    reasons.push("Similar surname");
  }
  if (pg && pg === cg) {
    score += 20;
    reasons.push("Same first name");
  } else if (pg && cg && editDistance(pg, cg) <= 2) {
    score += 10;
    reasons.push("Similar first name");
  }
  if (pg && pf && pg === cf && pf === cg) {
    score += 25;
    reasons.push("First name and surname swapped");
  }
  return { score: Math.min(score, 100), reasons };
}

/** Canonical pair ordering for DuplicatePatientReview (patientAId < patientBId). */
export function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}
