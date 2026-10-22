# Deployment

## Topology (recommended)

- Node.js 22 app container(s) behind an HTTPS reverse proxy / load balancer (TLS 1.2+, HSTS).
- Managed PostgreSQL 16 with encryption at rest, automated backups and PITR, private networking.
- S3-compatible object storage with server-side encryption for documents. Set `STORAGE_DRIVER=s3`, `S3_BUCKET`,
  `S3_REGION`, optional `S3_ENDPOINT` (MinIO etc.) and credentials. Block all public access on the bucket; the app
  streams files through an authorised route and never issues public URLs.
- Secrets from a secrets manager - never in images or the repository.

## Environment

See `.env.example`. Production requires: `DATABASE_URL` (least-privilege app user), `APP_URL`
(https), `DATA_ENCRYPTION_KEY` and `BLIND_INDEX_KEY` (distinct, 32 bytes base64), `STORAGE_DRIVER=s3`.
`MFA_ENFORCE` is forced on. Online payments stay off (`PAYMENT_PROVIDER=disabled`) until a merchant
agreement exists; enabling a provider requires `PAYMENT_WEBHOOK_SECRET` (startup refuses otherwise) and
registering `https://<host>/api/payments/callback` with the provider. `HMS_LOCAL_PRODUCTION_TEST` must **never** be set (it is refused for non-localhost URLs anyway).

## Release steps

1. CI green (format, lint, typecheck, schema validate, unit, integration, build, E2E smoke).
2. Backup / snapshot the database.
3. `npx prisma migrate deploy` (migrations are forward-only; write a corrective migration rather than editing applied ones).
   Then `npm run db:sync-permissions` to add any new permissions (granted only to template roles that include them;
   every grant is audited).
4. Deploy the new build; check `/api/health`.
5. Smoke test sign-in, patient search, queue.
6. Roll back by redeploying the previous build; schema changes must be backwards compatible for one release (expand → migrate → contract).

## Database roles

Create separate roles: migration owner (DDL), application (DML only on app tables, no TRUNCATE), read-only reporting.
The audit append-only triggers belong to the owner role; the application role must not own tables.

Never run the demo seed in production; it refuses when `NODE_ENV=production`.

## Public demo site (fictional data) on a serverless host

For a site where people can try the system with fictional data only. Any Node.js host that runs
Next.js 15 (Vercel, Netlify, Render, ...) with any PostgreSQL 15+ that allows the `btree_gist`
extension (Supabase, Neon, ...) and any S3-compatible bucket (Supabase Storage, Cloudflare R2, ...).

1. **Database.** Create a project. Use the **direct or session** connection string for migrations and
   seeding, and the **pooled (transaction)** string with `?pgbouncer=true&connection_limit=1` as the
   app's `DATABASE_URL` on serverless hosts.
2. **Migrate and seed from a workstation** (never from the host build):
   ```bash
   DATABASE_URL="<direct url>" npx prisma migrate deploy
   SEED_DEMO_PASSWORD="<long random password>" SEED_FORCE_PASSWORD_CHANGE=false \
     DATABASE_URL="<direct url>" DATA_ENCRYPTION_KEY=... BLIND_INDEX_KEY=... npm run db:seed
   ```
   Use a strong demo password: the site is public. Share it only with the people testing.
3. **Bucket.** Create a private bucket and S3 access keys. Set `STORAGE_DRIVER=s3`, `S3_ENDPOINT`,
   `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
4. **Host.** Import the repository with root directory `hms`. Build command `npm run build`
   (`postinstall` runs `prisma generate`). Environment: `DATABASE_URL` (pooled), `APP_URL`
   (the site's https URL), `DATA_ENCRYPTION_KEY` and `BLIND_INDEX_KEY` (the **same** values used when
   seeding, otherwise encrypted demo identifiers cannot be read), the S3 variables, and
   `HMS_DEMO_SITE=true` (shows a "fictional data only" warning on every page).
5. Check `https://<site>/api/health`, then sign in. MFA is enforced in production, so privileged demo
   roles (owner, admin, medical director, records, finance, HR, support, auditor) must enrol an
   authenticator app on first sign-in.

A demo site must never hold real patient data. A real deployment starts from an empty database
without the seed, with `HMS_DEMO_SITE=false`.
