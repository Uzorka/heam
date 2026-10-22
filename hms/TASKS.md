# Aduraking HMS - task tracker

Last updated: 22 Oct 2026 (end of Phase 1 session).

## Phase 1 - Foundation ✅

- [x] Next.js 15 / React 19 / TypeScript strict / Tailwind / Prisma 6 / PostgreSQL 16 project in `hms/`
- [x] Migration with DB-level integrity: clinician double-booking exclusion constraint, one open visit per patient/branch, append-only audit & queue triggers, check constraints
- [x] Auth: Argon2id, DB sessions (idle + absolute expiry, revocation), lockout + IP rate limit, TOTP MFA enrolment/verification, password reset tokens (single use), admin-issued setup links
- [x] RBAC: 110 permissions, 21 role templates, branch/all-branch scope, effective dates, temporary cover (≤31 days), MFA-gated privileged roles, no self-grants, two-person role-change approval with risk notes
- [x] Hash-chained, append-only audit trail + viewer + integrity verification; denials audited; patient views audited
- [x] Hospital configuration: organisation, branches (verification-gated activation), departments, wards, beds, visit types, typed system settings, setup checklist of unverified public facts
- [x] Patient registry: registration (full + emergency/provisional), explainable duplicate detection, two-person merge, encrypted identifiers with audited reveal, allergies (reported vs clinician-verified, entered-in-error), consents (superseding history), contacts, guardian links with independent verification, status (inactive/deceased), optimistic locking, timeline
- [x] Scheduling: booking, reschedule (linked), cancel, no-show, authorised overlap override, day view by clinician
- [x] Check-in (appointment or walk-in), visit queue state machine with role-gated transitions, care-team assignment, printable slip, 30 s safe polling
- [x] Dashboards: executive (aggregated, defined metrics, chart + table alternative), front desk, clinician, pending approvals; no placeholder numbers
- [x] Break-glass emergency access with review queue; clinical access rule (care team / branch-wide / break-glass) ready for Phase 2
- [x] UI shell: permission-built navigation, branch selector, global patient search (`/`), light/dark, mobile drawer, accessible forms with error summaries, toasts only after server confirmation
- [x] Fictional seed (22 staff, 19 patients incl. duplicate pair, twins, emergency, guardian link, live queue, history)
- [x] Docs: README, architecture, domain model, plan, permissions matrix (generated), setup & go-live checklists, security/privacy, deployment, backup/restore, incident response, operations
- [x] CI workflow (`.github/workflows/hms-ci.yml`)

### Test status

- Unit: 46 tests (money, time/Lagos, phone, MRN check digit, duplicate scoring, queue state machine, RBAC template invariants, env fail-safe, encryption, redaction, audit hash, password policy)
- Integration (real PostgreSQL): 36 tests (access control, registry, merges, identifiers, scheduling concurrency, check-in concurrency, full journey, auth/lockout/sessions/reset, audit chain & immutability, break-glass)
- E2E (Playwright, production build): 9 tests incl. register → duplicate warning → book → check in → nurse → doctor; access denials; security headers; phone + tablet layouts

### Known issues / notes

- `npm audit` advisories are in build tooling (PostCSS bundled by Next 15.5, Prisma CLI config dependency); none in runtime request paths identified. Re-check when upgrading to Next 16 / Prisma 7.
- No group-level `loading.tsx` (Next 15.5 navigation stall, see `app/(app)/layout.tsx`).
- `/patients/new` client bundle is large (~195 kB) because of full phone metadata; consider server-side normalisation only.
- Dev/test databases: integration tests are non-destructive; drop/recreate `hms_test` manually if it grows.
- Logo upload waits for the Phase 2 document storage adapter.

## Acceptance criteria (prompt §29)

| #     | Criterion                                                       | Status                                                                        |
| ----- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1     | Reception cannot read clinical notes                            | Partial: clinical-access rule tested (reception denied); notes arrive Phase 2 |
| 2     | HR no PHI; clinicians no payroll                                | ✅ integration + E2E                                                          |
| 3     | Multiple scoped roles; revocation immediate                     | ✅                                                                            |
| 4     | Branch / direct URL restriction                                 | ✅                                                                            |
| 5     | Duplicates never silently merged                                | ✅                                                                            |
| 6     | Idempotent payment callback                                     | Phase 4                                                                       |
| 7     | Concurrent bed assignment                                       | Phase 5 (same DB technique proven for appointments)                           |
| 8–9   | Dispensing lot accuracy; expired lots blocked                   | Phase 3                                                                       |
| 10–11 | Verified results / signed notes immutable with amendments       | Phase 2                                                                       |
| 12–15 | HMO patient-pay, claim vs preauth, remittance, effective tariff | Phase 4                                                                       |
| 16    | Pregnancy & newborn (twins) linked records                      | Phase 5                                                                       |
| 17    | Cancelled orders not chargeable                                 | Phase 2/4                                                                     |
| 18    | Critical result acknowledgement                                 | Phase 2                                                                       |
| 19    | Lagos time & kobo money                                         | ✅ unit                                                                       |
| 20    | Guardian sees only approved dependant documents                 | Partial: verified guardian links; portal Phase 6                              |
| 21    | Sensitive downloads/exports permissioned & logged               | Partial: identifier reveal; files/exports Phase 2/6                           |
| 22    | URL manipulation cannot bypass record rules                     | ✅                                                                            |
| 23    | Broken connector never marks eligibility verified               | Phase 4                                                                       |
| 24    | Core screens on phone/tablet                                    | Partial: front desk/queue verified; extend each phase                         |
| 25    | Production fails safely without secrets                         | ✅ unit + observed                                                            |

## Phase 2 - next

- [ ] Document storage adapter (local dev / S3) with signed short-lived URLs, type/size limits, scan hook; logo upload
- [ ] Encounter workspace; SOAP notes (templates, drafts, signature, addenda, version history, DB append-only)
- [ ] Vitals & triage with units, configured thresholds (clinician-approved), trends
- [ ] Diagnoses (provisional/confirmed), problem list, care plans
- [ ] Orders (lab, imaging, procedure, referral) with state machine and cancellation rules
- [ ] Lab: catalogue, reference ranges, specimens + labels, results, verification, release, critical acknowledgement, amendments
- [ ] Imaging: worklist, reports, sign-off, attachments
- [ ] Clinician/nurse/lab/imaging worklists and dashboard tiles; extend patient timeline with permission-aware clinical events
- [ ] Tests: criteria 1, 10, 11, 17, 18 + E2E visit → lab → verified result → review

## Continuation prompt for the next session

> Continue the Aduraking HMS in `hms/` on branch `claude/aduraking-hms`. Read `TASKS.md`, `docs/ARCHITECTURE.md`
> and `docs/DOMAIN_MODEL.md` first. Phase 1 is complete and green (unit, integration, E2E). Start Phase 2 exactly as
> listed in TASKS.md: add a new Prisma migration (never edit applied ones), put all rules in `src/server/domains/*`
> services with `requirePermission`/`getClinicalAccess` checks and same-transaction `recordAudit`, expose them via
> `defineAction`, and build pages using the existing UI kit (`components/ui`, `components/forms/action-form`).
> Clinical notes and verified results must be append-only with signed amendments (DB triggers + tests). Keep
> clinical rules configurable and clinician-approved; never add autonomous diagnosis. Run `npm run typecheck`,
> `npm run lint`, `npm test`, `npm run test:integration`, `npm run build`, `npm run test:e2e` before each commit,
> update TASKS.md, and never run destructive database resets without explicit user consent.
