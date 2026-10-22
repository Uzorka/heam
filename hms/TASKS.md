# Aduraking HMS - task tracker

Last updated: 22 Oct 2026 (end of Phase 2).

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

## Phase 2 - Clinical, laboratory, imaging, documents ✅

- [x] Migration `phase2_clinical` with DB immutability triggers (signed notes, verified results, signed reports, vitals, triage), append-only history tables, plausibility CHECKs, one approved threshold per vital, one current verified result per component, order/catalogue consistency checks
- [x] Clinical access model: current-visit access for staff on duty in the branch; full history with care relationship / branch-wide / break-glass; documenting care joins the care team; chart and visit views audited
- [x] Encounter workspace (`/encounters/[id]`): summary, vitals & triage, notes, diagnoses, orders & results; queue stage moves from the workspace
- [x] Clinical notes: SOAP / progress / nursing / procedure templates, versioned drafts with conflict detection, unsaved-change warning, password-confirmed signing with content hash, addenda, discard (kept), others' drafts hidden
- [x] Vitals with units, BMI only from valid inputs, entered-in-error corrections; triage with staff-assigned acuity
- [x] Diagnoses: provisional / confirmed / refuted, resolved / entered-in-error, optional ICD-10, problem list
- [x] Orders: lab, imaging, procedure, referral; idempotent placement; duplicate-open-order guard; cancellation only before work starts; clinician result review
- [x] Laboratory: worklists, accession numbers, QR specimen labels, receive/reject (orderer notified), typed result entry, flags only from approved ranges (sex/age aware), independent password-confirmed verification (setting), return for correction, critical-result alerts with attributed acknowledgement, signed amendments that supersede (clinician must re-review), turnaround metric
- [x] Imaging: worklist, scheduling, report drafts, signed reports, amended reports
- [x] Documents: local/S3 storage adapter, signature-based type check, 10 MB limit, scan hook, authorised + audited downloads, void instead of delete
- [x] Clinical catalogue admin: lab tests & components, imaging studies, reference ranges and vital thresholds with draft → approval by a different clinician
- [x] Results inbox, critical alerts, dashboard tiles (results to review, lab queues, lab TAT), notification texts without clinical content
- [x] Patient record "Clinical" tab (history) with restricted state and break-glass entry point
- [x] Release-time permission sync (`npm run db:sync-permissions`) - new permissions `clinical.rules.approve`, `clinical.results.review`
- [x] Seed: 8 lab tests, 6 imaging studies, DRAFT placeholder ranges/thresholds, demo clinical activity, second lab scientist

### Phase 2 test status

- Unit: +8 (range selection, numeric/coded flags, strict parsing, vital flags, BMI)
- Integration: +16 (clinical access, note immutability/addenda, drafts privacy, vitals correction & DB guards, approval of thresholds, diagnoses, order idempotency, cancellation rules, full lab journey, unflagged without ranges, result immutability & amendment, critical acknowledgement, specimen rejection, imaging report immutability & amendment, document permissions/audit/type checks)
- E2E: +1 (nurse vitals → doctor signed note → lab order → collection/receipt/result → same-person verification refused → second scientist verifies → doctor reviews → reception blocked)
- Totals at end of Phase 2: 105 unit + integration, 10 E2E - all passing

### Known limitations after Phase 2

- No PACS/DICOM, no analyser interfaces (manual entry / file attachment).
- Malware scanner not bundled (`scanUpload` hook); files are labelled "not virus-scanned".
- Note templates and the triage acuity scale are code-defined placeholders pending medical director approval; no template editor yet.
- No medication orders yet (Phase 3 prescribing); allergies are displayed but no interaction engine exists (by design until a validated knowledge base is configured).
- Results are not yet released to the patient portal (Phase 6).
- Specimen collection is a lab permission; nurse collection requires a role change if the hospital wants it.

## Phase 3 - next (pharmacy, inventory, procurement)

- [ ] Medication catalogue (generic/brand, strength, form, route, NAFDAC number when verified, pack conversions, controlled flag)
- [ ] Prescribing from the encounter workspace with password signature; allergy display; no fabricated interaction checks
- [ ] Pharmacist verification queue; dispensing with FEFO lot selection, partial fills, authorised substitutions, returns
- [ ] Lot-level stock ledger (append-only), expiry/quarantine blocking, low-stock and near-expiry alerts
- [ ] Suppliers, requisitions → approval → PO → goods received (quarantine) → stock; transfers; cycle counts; adjustments with approval
- [ ] MAR foundations (administration records) for inpatient use in Phase 5
- [ ] Tests: acceptance criteria 8 and 9 (dispense once updates the correct lot; expired lots blocked), concurrency on stock

## Continuation prompt for the next session

> Continue the Aduraking HMS in `hms/` on branch `claude/aduraking-hms`. Read `TASKS.md`, `docs/ARCHITECTURE.md`
> and `docs/DOMAIN_MODEL.md` first. Phases 1-2 are complete and green (unit, integration, E2E). Start Phase 3 exactly as
> listed in TASKS.md: add a new Prisma migration (never edit applied ones), put all rules in `src/server/domains/*`
> services with `requirePermission`/`getClinicalAccess` checks and same-transaction `recordAudit`, expose them via
> `defineAction`, and build pages using the existing UI kit (`components/ui`, `components/forms/action-form`).
> Clinical notes and verified results must be append-only with signed amendments (DB triggers + tests). Keep
> clinical rules configurable and clinician-approved; never add autonomous diagnosis. Run `npm run typecheck`,
> `npm run lint`, `npm test`, `npm run test:integration`, `npm run build`, `npm run test:e2e` before each commit,
> update TASKS.md, and never run destructive database resets without explicit user consent.
