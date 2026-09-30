# Test report

Environment: Linux container, 4 vCPU Intel Xeon 2.1 GHz, Node 22.22, PostgreSQL 16 (local), Redis 7 (local), Chromium 1194 (Playwright 1.56).
Date: 2026‑09‑30. All tests below were **run and passed** in this environment unless marked otherwise.

## Summary
| Suite | Tests | Result |
|---|---|---|
| `packages/shared` unit (money, rounding, parsing, business date, DST scan 2026–2027, opening hours, QR payload) | 44 | ✅ pass |
| `apps/api` integration on real PostgreSQL (fresh DB per run via `migrate deploy`) | 79 | ✅ pass |
| `e2e` Playwright full stack (API + worker + admin web + SMTP sink + Redis) | 2 | ✅ pass |
| `apps/admin` unit (date helpers) + `next build` + typecheck | 1 + build | ✅ pass |
| `apps/mobile` typecheck + unit + **Metro iOS bundle export** (1,705 modules) | 1 + bundle | ✅ pass |
| `expo-doctor` | 19/21 local checks | ⚠ 2 checks need network access to api.expo.dev (blocked by the sandbox proxy) |

## Acceptance criteria mapping
| # | Criterion | Evidence |
|---|---|---|
| 1 | 200 ₪ × 20% = 40 / 160; half-up rounding | `money.test.ts` (9 rounding cases), `redemption.test.ts › acceptance`, E2E |
| 2 | Second use same user/store/day rejected | `daily limit › second use…`, `two quotes prepared…` (DB-constraint path) |
| 3 | Other store same day allowed | same test |
| 4 | Second branch of same store rejected | same test |
| 5 | Next day allowed; midnight; DST; phone clock ignored | `local midnight resets…` (client `Date` header ignored), `DST…`, `session spanning midnight…`, shared DST scan |
| 6 | 20 concurrent confirms → 1 | `20 concurrent confirmations…` (same quote) and `…different quotes/staff…` |
| 7 | Idempotency replay / payload mismatch | `same Idempotency-Key replays…`, `concurrent identical retries…` |
| 8 | Suspension/expiry between scan & confirm; concurrent ordering | `card suspended after approval…`, `subscription cancelled…`, `concurrent suspension and confirmation serialize…` |
| 9 | Expired / reused / forged QR; other store; different amount | `expired, reused and forged QR…`, `staff of another merchant…`, `approval of a different amount…` |
| 10 | Offer change after quote | `offer change after quote invalidates it…` (+ old record immutability at DB level) |
| 11 | Scan/quote/close doesn't consume | `scan + quote + approval + abandon…` |
| 12 | Void preserves history, re-opens today only | `void keeps history…` |
| 13 | Staff isolation, can't change rate or grant admin | `staff cannot change offers…`, `dashboard aggregates… isolation`, `deactivated staff…` |
| 14 | Manual entry needs holder confirmation | `manual serial entry requires…`, `manual lookup is rate limited…` |
| 15 | Network loss after commit / push outage | idempotent replay test, E2E replay, `push failure never undoes…` |
| 16 | Expiry, renewal, replacement don't reset today | `card replacement and subscription renewal…`, `expired subscription blocks…` |
| 17 | Deletion revokes sessions and removes photos/PII | `account deletion` in `auth.test.ts` |
| 18 | Arabic & English; denied permissions | API localized errors test; mobile/admin UIs are bilingual; denied camera → manual entry and Settings link; denied push → in-app center. **UI behaviour on device: not tested (see below).** |

Also covered: registration/verification, login rate limiting, refresh rotation + reuse detection, tampered JWT, remote session revocation, password reset single-use/newest-only, email change, admin TOTP enrollment/verify/recovery codes, permission-scoped admin APIs, photo validation + EXIF stripping, photo approval workflow, CSV formula-injection neutralization, subscription stacking to local midnight across DST, catalog activation rules, invitation flows, directory availability states/filters/near-me/pagination, marketing opt-in broadcasts, expiry reminders deduplication, notification center, health/readiness, production config fail-fast, BFF CSRF/allow-list.

## Performance (measured, not estimated)
`apps/api/test/perf.test.ts` — in-process HTTP, local PostgreSQL, 30 sequential cashier flows on the machine above:

| Step | p50 | p95 | max |
|---|---|---|---|
| Scan → verification | 34 ms | 44 ms | 59 ms |
| Quote | 29 ms | 37 ms | 47 ms |
| Member approval | 15 ms | 24 ms | 33 ms |
| Confirm (transaction) | 42 ms | 53 ms | 63 ms |

Budget: p95 < 300 ms per cashier step server-side. Real-world latency adds network RTT and depends on the production database. Measure again in staging with production-like data (release-blockers.md).

## Not tested here (and why)
| Item | Reason | How to close |
|---|---|---|
| Mobile UI on a physical iPhone (camera scan, Face ID lock, push, RTL/LTR switch, Dynamic Type, VoiceOver, safe areas, number pad) | No macOS/Xcode/iPhone in this environment | Development build via `eas build --profile development`, run the checklist in app-store-release.md §Device test |
| Archive/IPA signing, TestFlight upload | Needs the owner's Apple Developer account and credentials | app-store-release.md |
| Real APNs delivery through Expo | Needs an EAS project, APNs key and a device | as above; verify `notification_deliveries` rows move to SENT |
| S3/MinIO storage driver | No object store running here (local driver tested) | Run staging with MinIO/S3 and repeat upload/delete tests |
| Real SMTP provider | Only a local SMTP sink | Configure the provider in staging (SPF/DKIM/DMARC) |
| Backup/restore drill | No production-like infrastructure | backup-restore.md procedure |
| Load test at scale / multi-instance | Single host | k6/Artillery in staging |
| Android build | iOS is the launch priority | `eas build -p android` when needed |
