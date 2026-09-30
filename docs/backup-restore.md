# Backup & restore

## Policy (proposed — confirm with owner/legal)
- PostgreSQL: managed automated backups **encrypted at rest**, point-in-time recovery window **7 days**, daily snapshots retained **35 days**, monthly snapshot retained 12 months in a separate account/region (the monthly retention for personal data must be approved by legal).
- Object storage (photos, store media): versioning on, noncurrent versions expire after **35 days** (so deleted photos really disappear); bucket private; SSE enabled.
- Redis: not backed up (no source-of-truth data).
- Secrets: stored in the secret manager with its own backup/rotation policy.
- Deleted accounts: PII is removed from live data immediately; backups age out within 35 days. A restored backup must be followed by **re-applying deletions**: after restore, run
  `SELECT user_id, completed_at FROM account_deletion_requests WHERE completed_at > '<backup time>'` and repeat deletion for those users (runbook step 6).

## Restore drill (quarterly, in staging)
1. Pick a target time T. Create a new DB instance from PITR at T (never overwrite the live instance).
2. `prisma migrate status` against the restored DB — note which migrations are applied.
3. Point a staging api at it; run `/ready` and the review-account smoke flow.
4. Verify counts: `SELECT count(*) FROM redemptions`, `users`, `audit_logs` vs. the expected values at T.
5. Record restore duration (RTO) and data-loss window (RPO) in the drill log.
6. Re-apply account deletions completed after T (see above) and re-run the photo deletion job.
7. Tear down the drill instance.

Targets to confirm: **RPO ≤ 5 min** (PITR), **RTO ≤ 2 h**.

## Local dump (development only)
```bash
pg_dump --format=custom --no-owner "$DATABASE_URL" > bitaqati.dump
pg_restore --no-owner --dbname "$NEW_EMPTY_DATABASE_URL" bitaqati.dump
```
