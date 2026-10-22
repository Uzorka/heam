# Backup & restore

RPO/RTO targets must be agreed with hospital management. Suggested starting point for a 24-hour
hospital: **RPO ≤ 15 minutes, RTO ≤ 4 hours**.

## Backups

- Managed PostgreSQL automated daily snapshots + continuous WAL archiving (point-in-time recovery), retained ≥ 35 days.
- Weekly logical dump (`pg_dump -Fc`) encrypted (e.g. `age`/GPG) to separate storage under a different account.
- Object storage versioning and cross-region replication (Phase 2+).
- Encryption keys backed up separately from data, with dual-control access.

## Restore test (monthly, recorded)

1. Restore the latest snapshot to an isolated environment (never to production; no outbound notifications configured).
2. `npx prisma migrate status` - confirm schema matches the release.
3. Run audit chain verification (Audit trail → Verify integrity) and record the result.
4. Spot-check patient counts and recent records against production.
5. Record duration (actual RTO), data age (actual RPO), issues; destroy the test copy.

## Local example

```bash
pg_dump -Fc -d "$DATABASE_URL" -f hms-$(date +%F).dump
createdb hms_restore && pg_restore -d hms_restore hms-$(date +%F).dump
```

## Dry run record

| Date        | Environment           | Steps                                                                                                                                 | Result                                                                                                                                                                                              |
| ----------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 22 Oct 2026 | Local dev (DEMO data) | `pg_dump -Fc` → `createdb` → `pg_restore --no-owner` → `prisma migrate status` → audit chain verification → row counts → guard checks | Restore 2 s; schema up to date; audit chain intact (1,968 events); Patient/Encounter/Audit/Payroll counts identical; payslip lock and audit append-only triggers active after restore; copy deleted |

This proves the procedure and that triggers and the hash chain survive a logical restore. It does not
measure production RPO/RTO; repeat on the production-like environment and record the timings.
