# Security & privacy

This document describes safeguards implemented in code. It is **input for** the hospital's legal and
compliance review under the Nigeria Data Protection Act 2023; it is not a certification.

## Implemented controls (Phase 1)

| Control                    | Implementation                                                                                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password storage           | Argon2id (m=19 MiB, t=2, p=1). Policy: ≥12 chars, 3 character classes, common/email-derived passwords rejected.                                                                                                                                                      |
| Login protection           | Generic failure message; per-account lockout (5 failures → 15 min); per-IP rate limit (30 failures / 15 min); timing equalised for unknown accounts.                                                                                                                 |
| Sessions                   | 256-bit random tokens, stored as SHA-256; `HttpOnly`, `SameSite=Lax`, `Secure` + `__Host-` prefix in production; idle timeout (default 30 min) and absolute lifetime (default 12 h); revoked on logout, password change/reset, MFA change, suspension, admin action. |
| MFA                        | TOTP (RFC 6238) with encrypted secrets; privileged roles suspended until enrolled when enforced (always in production); 5 bad codes revoke the pending session.                                                                                                      |
| Authorisation              | Server-side checks in every service; branch-scoped, effective-dated grants loaded per request; record scope returns _not found_ for out-of-scope records; clinical access requires care relationship, branch-wide clinical permission, or break-glass.               |
| Segregation of duties      | Two-person rules: role permission changes, patient merges, guardian verification, break-glass review. No self-assignment of roles/status/MFA reset.                                                                                                                  |
| Break-glass                | Clinical roles only; structured reason + justification; time-limited; notifies reviewers; reviewed by someone else.                                                                                                                                                  |
| Audit                      | Append-only (DB triggers) and SHA-256 hash-chained; records sign-ins/failures, patient views, identifier reveals, all mutations (field names, not values), denials, settings before/after. Viewer shows identifiers only.                                            |
| Encryption at rest         | Identity numbers and MFA secrets: AES-256-GCM with versioned key prefix (rotation path). Full-disk/database encryption is provided by infrastructure (see Deployment).                                                                                               |
| Minimum necessary          | Masked phones and identifiers in lists; executive dashboard aggregated only; HR/support roles have no PHI; notifications carry no clinical content.                                                                                                                  |
| Transport & headers        | HSTS (production), CSP (`frame-ancestors 'none'`, no third-party scripts), X-Frame-Options DENY, nosniff, strict referrer, restricted permissions policy, `Cache-Control: no-store` on app pages.                                                                    |
| CSRF                       | Next.js server actions verify Origin; session cookie is SameSite=Lax; only GET route handler is the health check.                                                                                                                                                    |
| Logging                    | Structured JSON with key-based redaction; request correlation ids; no PHI or secrets by design.                                                                                                                                                                      |
| Fail-safe startup          | Production refuses to start without valid, distinct 32-byte keys, HTTPS `APP_URL`, non-local storage and a non-development DB password.                                                                                                                              |
| Data protection by default | Demo seed refuses to run in production; demo banner in non-production; DEMO labels on sample capacity.                                                                                                                                                               |

## Clinical safety

The system does not diagnose, triage, prescribe, alter treatment or discharge. Queue priority is a
staff judgement. Any future rule affecting care must have a named clinical reviewer, validation tests
and an owner. No drug-interaction engine is claimed. AI-generated clinical suggestions are not present.

## Outstanding before go-live

- DPIA, records of processing, privacy notice text and lawful bases (legal review).
- Retention/destruction schedule and data-subject request workflow (Phase 6).
- Upload scanning, signed URLs for documents (Phase 2 storage adapter).
- External penetration test; dependency audit triage (current advisories are in build tooling: PostCSS bundled with Next, Prisma CLI config dependency).
- Error-monitoring provider with PHI scrubbing (adapter exists, disabled).
- Key management (KMS/secrets manager) and rotation runbook.
