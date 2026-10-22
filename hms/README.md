# Aduraking HMS

Hospital management system for **Aduraking Hospital and Maternity**, Ikorodu, Lagos.
A secure, role-aware modular monolith: Next.js 15 (App Router) · React 19 · TypeScript (strict) ·
PostgreSQL 16 · Prisma 6 · Tailwind CSS · Radix UI · Zod · Vitest · Playwright.

> **Status: Phases 1–2 of 6 complete** (foundation, access control, audit, configuration, patient
> registry, scheduling, check-in and queue; consultations, clinical notes, vitals/triage, diagnoses,
> orders, laboratory, imaging and documents). See [`TASKS.md`](TASKS.md) for exactly what is and is
> not implemented. **Only fictional data may be used** until the go-live checklist is signed off.

## Quick start (local development)

Prerequisites: Node.js 20.11+ (22 recommended), PostgreSQL 16 (or Docker).

```bash
cd hms
cp .env.example .env
# generate two DIFFERENT keys and paste them into .env
openssl rand -base64 32   # -> DATA_ENCRYPTION_KEY
openssl rand -base64 32   # -> BLIND_INDEX_KEY

docker compose up -d postgres        # or use a local PostgreSQL with the same credentials
npm ci
npx prisma migrate deploy            # apply migrations
npm run db:seed                      # fictional demo data (refuses to run in production)
npm run dev                          # http://localhost:3000
```

Without Docker: create role `hms` (password `hms_dev_password`, CREATEDB) and databases `hms` and
`hms_test`, as in `docker/postgres-init.sql`.

### Demo accounts (local development only)

All demo staff share the password in `SEED_DEMO_PASSWORD` (default `Demo-Aduraking-2026!`) and use
`<name>@demo.aduraking.test`. They exist only in the seed fixture, are never shown in the UI, and must
not exist in any shared environment. For shared/staging use set `SEED_FORCE_PASSWORD_CHANGE=true`.

| Login                                                    | Role(s)                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| `reception`                                              | Reception / registration                                          |
| `records`                                                | Medical records officer (approves merges, reveals identifiers)    |
| `nurse`, `midwife`, `nursesup`                           | Nursing                                                           |
| `doctor`, `doctor2`, `consultant`, `meddir`              | Clinicians / medical director                                     |
| `admin`                                                  | Hospital administrator (no clinical access)                       |
| `owner`                                                  | Executive (aggregated dashboard only)                             |
| `auditor`                                                | Compliance (audit trail, break-glass review)                      |
| `support`                                                | System support (no PHI)                                           |
| `lab`, `lab2`                                            | Laboratory scientists (results need a second scientist to verify) |
| `imaging`                                                | Radiographer                                                      |
| `hr`, `finance`, `cashier`, `hmo`, `pharmacist`, `store` | Later-phase roles                                                 |
| `multi`                                                  | Nurse + reception (multi-role example)                            |

Roles marked MFA in the matrix (admin, owner, medical director, records, finance, HR, support,
auditor) are paused until two-step verification is enrolled when `MFA_ENFORCE=true` (always on in
production).

## Commands

| Command                                                       | Purpose                                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`                                                 | Development server                                                           |
| `npm run build && npm start`                                  | Production build / server                                                    |
| `npm run typecheck` · `npm run lint` · `npm run format:check` | Static checks                                                                |
| `npm test`                                                    | Unit tests (no database)                                                     |
| `npm run test:integration`                                    | Integration tests against `TEST_DATABASE_URL` (non-destructive)              |
| `npm run test:e2e`                                            | Playwright browser tests (build + seed first; see below)                     |
| `npm run db:validate`                                         | Validate Prisma schema                                                       |
| `npm run docs:permissions`                                    | Regenerate `docs/PERMISSIONS_MATRIX.md` from code                            |
| `npm run db:sync-permissions`                                 | Release step: add new permissions and grant them to template roles (audited) |

E2E: `npm run build && npm run db:seed && npm run test:e2e`. The test server runs the production
build with `HMS_LOCAL_PRODUCTION_TEST=true`, which relaxes production hardening checks **only when
`APP_URL` is localhost**. If Chromium is pre-installed elsewhere, set `PW_CHROMIUM_PATH`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) · [Domain model](docs/DOMAIN_MODEL.md) · [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Permissions matrix](docs/PERMISSIONS_MATRIX.md) · [Security & privacy](docs/SECURITY_PRIVACY.md)
- [Hospital setup checklist](docs/HOSPITAL_SETUP_CHECKLIST.md) · [Go-live checklist](docs/HOSPITAL_GO_LIVE_CHECKLIST.md)
- [Operations workflows](docs/OPERATIONS_WORKFLOWS.md) · [Deployment](docs/DEPLOYMENT.md) · [Backup & restore](docs/BACKUP_RESTORE.md) · [Incident response](docs/INCIDENT_RESPONSE.md)
- [Task tracker](TASKS.md)

## Important limitations

This software does **not** diagnose, triage, prescribe or discharge. It holds no regulatory approval
or medical-device certification. HMO, payment, SMS/email and national health-exchange integrations
are **disabled** until credentials, agreements and testing exist. Public facts about the hospital are
loaded as _unverified_ setup facts and must be confirmed by an authorised person.
