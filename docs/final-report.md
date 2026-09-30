# Final report | التقرير الختامي

Date: 2026‑09‑30 · Branch: `claude/focused-cori-8nysf6`

## Status: technically working system — **not** a release candidate yet
The full discount flow works end-to-end between the member, merchant and admin roles, with an atomic daily limit, exact money calculation,
enforced permissions, immutable history, account deletion, documented operations and passing tests. It isn't a release
candidate until the items in `release-blockers.md` are closed (sales model decision, Apple accounts/TestFlight, iPhone device tests,
legal pages, production-like staging). Nothing was deployed or submitted to Apple.

## Delivered
| Area | Implemented | Tested |
|---|---|---|
| Shared domain (money, rounding, business day/DST, schemas, errors ar/en) | ✅ | ✅ 44 unit tests |
| API: auth (Argon2id, email verification, rotating refresh + reuse detection, reset, email change, invitations, admin TOTP MFA + recovery codes) | ✅ | ✅ |
| API: cards, QR (hashed, single-use, 60 s), verification + visual match, manual lookup with holder consent, quotes, fingerprint-bound approvals, idempotent atomic confirmation, void | ✅ | ✅ incl. 20-way concurrency |
| API: stores directory (filters, near-me, availability states), home/history, notifications center, preferences, push tokens, account deletion | ✅ | ✅ |
| API: merchant dashboard/transactions/staff management with server-side scope | ✅ | ✅ |
| API: admin users/photos/cards/subscriptions/permissions, catalog (merchants/stores/branches/categories/offers/plans/media), redemptions + CSV, reports, broadcasts, settings, audit | ✅ | ✅ |
| Worker: transactional outbox, push queue (BullMQ, retry, dedupe, honest delivery status), scheduled broadcasts, expiry reminders, opt-in daily summary | ✅ | ✅ (outbox/notifications in tests + E2E; BullMQ path smoke-started) |
| DB: migrations with partial unique index, CHECKs, append-only/immutability triggers | ✅ | ✅ applied to a fresh DB on every test run |
| Admin web (Next.js BFF, MFA login, RBAC nav, dashboard + accessible charts, users, merchants, plans, transactions, notifications, settings, audit) | ✅ | ✅ build + Playwright E2E |
| Mobile (Expo SDK 57): member tabs (home, stores, card/QR, history, account), approvals sheet, photo, devices, deletion, notification center; merchant tabs (dashboard, scan/manual, verification→confirm, transactions, staff, settings); AR/EN with RTL | ✅ | ⚠ typecheck + Metro iOS bundle only; **device testing pending** |
| Docs, OpenAPI, Docker Compose, Dockerfiles, CI, .env.example | ✅ | CI workflow not yet run on GitHub |

## Owner actions (summary)
See `launch-decisions.md` (17 decisions) and `release-blockers.md` (13 items). The most important:
1. Decide how memberships are sold (App Store 3.1) — this blocks public sale.
2. Provide Apple Developer / App Store Connect access through secure channels (not in chat), set the bundle id, and create an EAS project.
3. Legal entity plus reviewed privacy policy and terms on public HTTPS URLs, plus a support channel.
4. Staging infrastructure (PostgreSQL, Redis, S3, SMTP provider) and a physical-iPhone test pass.

## Commands
```bash
pnpm install && pnpm build:shared
docker compose -f infra/docker-compose.yml up -d
pnpm --filter @bitaqati/api exec prisma migrate deploy && pnpm db:seed
pnpm dev:api & pnpm dev:worker & pnpm dev:admin
pnpm --filter @bitaqati/api test && pnpm --filter @bitaqati/shared test && pnpm --filter @bitaqati/e2e e2e
cd apps/mobile && eas build --profile development --platform ios
```
