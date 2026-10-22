# Deployment

## Topology (recommended)

- Node.js 22 app container(s) behind an HTTPS reverse proxy / load balancer (TLS 1.2+, HSTS).
- Managed PostgreSQL 16 with encryption at rest, automated backups and PITR, private networking.
- S3-compatible object storage with server-side encryption (documents, Phase 2+).
- Secrets from a secrets manager - never in images or the repository.

## Environment

See `.env.example`. Production requires: `DATABASE_URL` (least-privilege app user), `APP_URL`
(https), `DATA_ENCRYPTION_KEY` and `BLIND_INDEX_KEY` (distinct, 32 bytes base64), `STORAGE_DRIVER=s3`.
`MFA_ENFORCE` is forced on. `HMS_LOCAL_PRODUCTION_TEST` must **never** be set (it is refused for non-localhost URLs anyway).

## Release steps

1. CI green (format, lint, typecheck, schema validate, unit, integration, build, E2E smoke).
2. Backup / snapshot the database.
3. `npx prisma migrate deploy` (migrations are forward-only; write a corrective migration rather than editing applied ones).
4. Deploy the new build; check `/api/health`.
5. Smoke test sign-in, patient search, queue.
6. Roll back by redeploying the previous build; schema changes must be backwards compatible for one release (expand → migrate → contract).

## Database roles

Create separate roles: migration owner (DDL), application (DML only on app tables, no TRUNCATE), read-only reporting.
The audit append-only triggers belong to the owner role; the application role must not own tables.

Never run the demo seed in production; it refuses when `NODE_ENV=production`.
