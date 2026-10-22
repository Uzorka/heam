# Threat model

Scope: the Aduraking HMS web application (`hms/`), its PostgreSQL database, document storage and
the patient portal. Method: STRIDE per trust boundary, reviewed at the end of Phase 6. This is an
engineering model for the hospital's security review and penetration test, not a certification.

## Assets

| Asset                                                                            | Why it matters                                            |
| -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Patient health information (notes, results, diagnoses, prescriptions, documents) | Confidentiality and integrity; NDPA special-category data |
| Identity numbers (NIN etc.), bank account numbers                                | Identity / financial fraud                                |
| Financial records (bills, payments, journal, payroll)                            | Fraud, misstatement                                       |
| Audit trail                                                                      | Evidence; must be complete and tamper-evident             |
| Credentials, sessions, MFA secrets, encryption keys                              | Lead to everything above                                  |

## Trust boundaries

1. Browser (staff or patient) → Next.js server (session cookie, server actions, route handlers)
2. Payment / payer providers → webhook route (signature, no cookies)
3. Server → PostgreSQL (least-privilege DB user, TLS in production)
4. Server → object storage (private bucket, server-side encryption)
5. Portal login (`kind = PORTAL`) → patient portal routes only

## Threats and mitigations

| STRIDE                 | Threat                                                          | Mitigation in code                                                                                                                                                        | Residual / owner                                   |
| ---------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Spoofing               | Password guessing / credential stuffing                         | Argon2id, lockout + per-IP rate limit, generic errors, MFA for privileged roles (enforced in production)                                                                  | Edge rate limiting / WAF: hospital IT              |
| Spoofing               | Forged payment callback                                         | HMAC-SHA512 signature check, events stored once (unique), amount and reference matched                                                                                    | Secret rotation, IP allow-list at edge             |
| Spoofing               | Portal user impersonating staff                                 | Portal users have only the PATIENT role; staff layout redirects `PORTAL` logins; every service checks staff permissions                                                   | -                                                  |
| Tampering              | Editing signed notes, verified results, approved payroll, audit | DB triggers (append-only / locked rows), signature hashes, hash-chained audit with integrity check                                                                        | DBA superuser access: restrict and log at provider |
| Tampering              | Direct URL / id manipulation                                    | Services re-check permission and record scope on every call; out-of-scope records return not found; tested (AC22)                                                         | -                                                  |
| Tampering              | CSRF                                                            | Server actions check Origin; SameSite=Lax cookies; GET routes have no side effects other than audit                                                                       | -                                                  |
| Repudiation            | "I didn't sign / approve that"                                  | Password re-entry signatures, named approver ≠ requester for every two-person rule, audited with request id and IP                                                        | -                                                  |
| Information disclosure | Over-broad access to charts                                     | Care-relationship model, branch scope, break-glass with review, chart views audited                                                                                       | Periodic access review: medical records            |
| Information disclosure | Portal shows unreviewed or another family's data                | Only clinician-released items; dependants only through verified, current, unrevoked guardian links; denials audited (AC20)                                                | Guardian verification procedure: medical records   |
| Information disclosure | Bulk export                                                     | `export.data` + report permission; aggregated reports only (no identifiers); watermark naming exporter; every attempt audited (AC21); FHIR export needs care relationship | DLP on endpoints: hospital IT                      |
| Information disclosure | Stored file served inline (XSS) or guessed                      | Signature-checked types, random keys, attachment disposition, sandbox CSP, authorised download routes only                                                                | Malware scanning: connect scanner                  |
| Information disclosure | Logs leaking PHI                                                | Structured logs with key-based redaction; notifications carry no clinical content                                                                                         | Error-monitoring scrubbing when enabled            |
| Denial of service      | Expensive report ranges                                         | Report range limited to ~1 year, branch-scoped SQL aggregates                                                                                                             | Infrastructure autoscaling / limits                |
| Elevation of privilege | Self-granting roles                                             | No self-grants; role permission changes need a second approver; temporary cover ≤ 31 days                                                                                 | -                                                  |
| Elevation of privilege | Vulnerable dependency                                           | `npm audit` triage each release (see TASKS.md); lockfile committed                                                                                                        | Next 16 / Prisma 7 upgrades pending                |

## Not yet covered

- External penetration test and code review by an independent party.
- Formal key management (KMS) and rotation drills.
- Portal sign-in has no MFA option yet; portal accounts are created by staff with a one-time link.
