# Operations runbook

## Health & logs
- `GET /health` (liveness), `GET /ready` (DB + Redis).
- Structured JSON logs (pino) with `requestId` (echoed in `X-Request-Id` and in every error body) — users can quote it to support.
- PII redaction: auth headers, cookies, passwords, tokens, QR payloads, MFA codes. Bodies and query strings are not logged.
- Ship logs to a store with access control and 30–90-day retention.

## Metrics & alerts to configure (monitoring stack of choice)
| Signal | Source | Alert |
|---|---|---|
| Confirmation failures | logs `path=/v1/merchant/redemptions` status ≥ 500, or `SERVICE_UNAVAILABLE` | > 1% over 5 min |
| Duplicate/idempotent replays | 200 responses on confirmation route | spike vs. baseline (network trouble at stores) |
| `ALREADY_REDEEMED_TODAY` rate | error code in logs | spike → possible abuse or UX issue |
| Verification abuse | `RATE_LIMITED` on `manual:`/`verify:` keys, `verification.mismatch` audits | per-staff anomalies |
| Outbox lag | `SELECT count(*), min(created_at) FROM outbox_events WHERE processed_at IS NULL` | oldest > 2 min |
| Outbox poison | `attempts >= 8` | any |
| Push queue | BullMQ `push-delivery` failed/waiting counts; `notification_deliveries` FAILED share | > 5% |
| DB | connections, slow queries (> 200 ms), locks, replication lag, storage | provider defaults |
| Latency | p95 per route | cashier routes > 300 ms |

Error monitoring (e.g. Sentry) can be added to the global exception filter. Scrub PII the same way as logs, and don't send request bodies.

## Routine tasks
- **Weekly**: review the audit log for `redemption.void`, `card.*`, `subscription.granted`, `admin.permissions_changed`, `settings.updated`. Voids per admin should be explainable.
- **Weekly**: `pnpm audit --prod`; patch high/critical.
- **Daily (automated)**: purge expired `idempotency_records` (`expires_at < now()`), used/expired `qr_tokens` older than 7 days, and verification/quote rows older than 90 days that aren't referenced by redemptions. (SQL in the appendix; scheduling via the worker is a follow-up.)
- **Quarterly**: backup restore drill, access review of admin accounts, secret rotation (JWT secret rotation requires a short dual-validity window; MFA key rotation requires re-encrypting secrets).

## Incident playbooks
- **Push provider down**: redemptions continue (outbox). Deliveries retry with backoff, and in-app notifications still exist.
- **Redis down**: the API still serves redemptions (limits enforced by PostgreSQL), but rate limiting falls back to per-instance memory and queues stall. Restore Redis; the outbox catches up.
- **Wrong offer published**: publish a corrected version (open quotes are invalidated automatically). Past redemptions keep their snapshot. If specific transactions were wrong, void them with a reason.
- **Suspected card sharing**: suspend the card (revokes QR and cancels open verifications), review `verification.mismatch` audits and redemption history, and contact the member.
- **Stolen device**: member or admin revokes sessions. Admin can REPLACE the card (new serial, old QR invalid).

## Appendix: cleanup SQL
```sql
DELETE FROM idempotency_records WHERE expires_at < now();
DELETE FROM qr_tokens WHERE (used_at IS NOT NULL OR revoked_at IS NOT NULL OR expires_at < now()) AND created_at < now() - interval '7 days';
```
