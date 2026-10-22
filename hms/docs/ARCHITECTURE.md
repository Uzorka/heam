# Architecture

## Shape

A **modular monolith**: one Next.js application and one PostgreSQL database, organised by domain.
No microservices; boundaries are enforced by folder structure and by routing every mutation through
a domain service.

```
Browser ──HTTPS──▶ Next.js (App Router)
                    ├─ middleware.ts           request id, redirect if no session cookie (UX only)
                    ├─ app/(auth)              sign-in, MFA, password reset
                    ├─ app/(app)/**/page.tsx   server components: load via services, render
                    ├─ app/(app)/**/actions.ts server actions: defineAction(name, zodSchema, service)
                    └─ app/api/health          liveness/readiness
                           │
                           ▼
                 src/server/domains/*          ALL business rules, authorisation, transactions, audit
                           │
                 src/server/{authz,auth,audit,crypto,sequence,env,logger}
                           │
                       Prisma ──▶ PostgreSQL 16 (constraints, exclusion, triggers)
```

## Request lifecycle (mutation)

1. Middleware assigns `x-request-id`.
2. Server action wrapper (`src/server/action.ts`) resolves the session (DB lookup of hashed token,
   idle/absolute expiry), loads the **AuthContext fresh from the database** (active, effective-dated,
   branch-scoped grants), validates input with Zod, calls the service, maps errors to safe messages.
3. The service checks permissions (`requirePermission`, `requireActingBranch`, record scope via
   `patientScopeWhere`, clinical access via `getClinicalAccess`), runs one DB transaction, and appends
   an audit event **in the same transaction**.
4. Denials are audited (`denied.<action>`), unexpected errors are logged with redaction and the request id.

Pages follow the same pattern (`load()` / `allowed()` in `app/(app)/_lib/guard.ts`). Navigation is
built from permissions, but hiding a link is never relied on.

## Domains (current and planned)

| Domain                                           | Folder                                  | Phase                                   |
| ------------------------------------------------ | --------------------------------------- | --------------------------------------- |
| auth, sessions, MFA                              | `server/auth`, `domains/security`       | 1 ✅                                    |
| authorisation, roles                             | `server/authz`, `domains/staff`         | 1 ✅                                    |
| audit                                            | `server/audit.ts`, `domains/audit`      | 1 ✅                                    |
| settings / setup                                 | `domains/settings`                      | 1 ✅                                    |
| patients                                         | `domains/patients`                      | 1 ✅                                    |
| appointments, queue                              | `domains/appointments`, `domains/queue` | 1 ✅                                    |
| dashboards                                       | `domains/dashboard`                     | 1 ✅ (only metrics backed by real data) |
| encounters/EMR, nursing, lab, imaging            | `domains/clinical`, `lab`, `imaging`    | 2                                       |
| pharmacy, inventory, procurement                 | `domains/pharmacy`, `inventory`         | 3                                       |
| billing, payments, HMO, finance                  | `domains/billing`, `hmo`, `finance`     | 4                                       |
| maternity, admissions                            | `domains/maternity`, `admissions`       | 5                                       |
| HR/payroll, portal, reports, notifications, FHIR | …                                       | 6                                       |

## Key decisions

| Decision                                                                             | Reason                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB-backed opaque sessions (SHA-256 hashed tokens) instead of JWT/Auth.js credentials | Immediate revocation (logout, suspension, password change), idle timeout and "role change revokes access promptly" are hard with stateless JWTs. Uses only standard primitives: Argon2id (`@node-rs/argon2`), `crypto.randomBytes`, `otplib` TOTP. No custom cryptography. |
| Permissions loaded per request                                                       | Revocations and expiring delegations apply immediately without cache invalidation.                                                                                                                                                                                         |
| Integrity in PostgreSQL                                                              | Exclusion constraint for clinician double-booking, partial unique index for one open visit per patient/branch, triggers making audit and queue history append-only, check constraints. Application checks give friendly messages; the DB is the last line of defence.      |
| Hash-chained audit                                                                   | Detects edits, deletions or re-ordering (`verifyAuditChain`), plus DB triggers blocking UPDATE/DELETE/TRUNCATE.                                                                                                                                                            |
| Integer kobo, UTC storage, Africa/Lagos display                                      | `src/lib/money.ts` (BigInt), `src/lib/time.ts` (Intl, no hard-coded offset).                                                                                                                                                                                               |
| UUIDv4 ids + transactional human references                                          | MRN `ADK` + 6 digits + Luhn check digit; `APT-YYYY-NNNNNN`, `ENC-YYYY-NNNNNN` via `Sequence` row locks.                                                                                                                                                                    |
| Encrypted identifiers + blind index                                                  | AES-256-GCM with versioned key prefix; HMAC blind index for exact matching (duplicate detection) without decrypting.                                                                                                                                                       |
| No group-level `loading.tsx`                                                         | Reproducible client-navigation stalls with Next 15.5; use scoped Suspense.                                                                                                                                                                                                 |
| Link prefetch disabled                                                               | Avoids speculative loading of patient pages (privacy) and keeps audit "view" events meaningful.                                                                                                                                                                            |

## Interoperability

A FHIR-ready mapping layer (Patient, Practitioner, Encounter, Observation, Condition,
MedicationRequest, DiagnosticReport, ServiceRequest, Coverage, Claim) is planned for Phase 6 as an
**adapter**, not a live connection. No NHIA/national exchange connection is made without
specifications, agreements, credentials and testing.
