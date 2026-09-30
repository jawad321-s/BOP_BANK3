# بطاقتي | Bitaqati — Digital discount card platform

> Working name only. The name, brand and bundle identifier are placeholders until the owner confirms them
> (see [docs/launch-decisions.md](docs/launch-decisions.md)). Nothing in this repository has been published to
> the App Store, and Apple approval can't be guaranteed by code.

Members hold a personal digital card with a time-bound membership. The card gives one discount per **store** per
**local business day** (Asia/Hebron by default), and can be used at different stores on the same day. Merchants
verify the card holder, the server computes the discount, the member approves it in their app, and the merchant confirms
it once. The platform **does not** process invoice payments, store bank cards, or hold wallets.

| Part | Path | Stack |
|---|---|---|
| API (modular monolith) + worker | `apps/api` | NestJS 11, Prisma 6, PostgreSQL 16, BullMQ/Redis |
| Admin web | `apps/admin` | Next.js 15 (App Router), server-side BFF, TanStack Query |
| Mobile (member + merchant spaces) | `apps/mobile` | Expo SDK 57 / React Native 0.86, Expo Router, TanStack Query, RHF + Zod |
| Shared domain | `packages/shared` | money/time rules, Zod schemas, error codes, API types |
| Full-stack E2E | `e2e` | Playwright + real API/worker/admin + local SMTP sink |
| Docs | `docs` | business rules, security, metrics, release, operations |
| Infra | `infra`, `.github/workflows` | Docker Compose (dev), Dockerfiles, CI |

## Quick start from a clean machine

Prerequisites: Node 22.12+, pnpm 10 (`corepack enable`), Docker (or local PostgreSQL 16 + Redis 7).

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d        # postgres, redis, mailpit (email UI :8025), minio
cp .env.example apps/api/.env                           # then adjust; dev defaults work with compose
pnpm build:shared
pnpm --filter @bitaqati/api exec prisma migrate deploy  # apply migrations
pnpm db:seed                                            # DEVELOPMENT sample data (prints dev accounts)
pnpm dev:api        # http://localhost:4000  (OpenAPI UI at /docs outside production)
pnpm dev:worker     # outbox, push queue, scheduled jobs
pnpm dev:admin      # http://localhost:3000  (admin@bitaqati.test; TOTP enrollment on first login)
```

Mobile (needs a **development build**, not Expo Go, for camera/notifications/secure storage):

```bash
cd apps/mobile
EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:4000 npx expo run:ios --device   # requires macOS + Xcode 26
# or: eas build --profile development --platform ios
```

## Tests

```bash
pnpm --filter @bitaqati/shared test                 # 44 unit tests (money, rounding, DST, midnight)
pnpm --filter @bitaqati/api test                    # 79 integration tests on real PostgreSQL (creates & drops its own DB)
pnpm --filter @bitaqati/e2e e2e                     # full stack: register → activate → scan → approve → confirm → void
pnpm -r typecheck
pnpm --filter @bitaqati/mobile bundle:check         # Metro iOS bundle
```

Results and what could **not** be tested here (physical iPhone, TestFlight, real APNs): [docs/test-report.md](docs/test-report.md).

## Documentation map

- [docs/architecture.md](docs/architecture.md) — decisions, ERD, request flows
- [docs/business-rules.md](docs/business-rules.md) — daily limit, money, time, void, cards, subscriptions
- [docs/api.md](docs/api.md) + [docs/openapi.json](docs/openapi.json) — endpoints and error codes
- [docs/security.md](docs/security.md), [docs/metrics.md](docs/metrics.md)
- [docs/deployment.md](docs/deployment.md), [docs/backup-restore.md](docs/backup-restore.md), [docs/operations.md](docs/operations.md)
- [docs/app-store-release.md](docs/app-store-release.md), [docs/app-review-notes.md](docs/app-review-notes.md), [docs/app-store-metadata-ar-en.md](docs/app-store-metadata-ar-en.md)
- [docs/legal/](docs/legal) — privacy policy and terms **drafts**
- [docs/launch-decisions.md](docs/launch-decisions.md), [docs/release-blockers.md](docs/release-blockers.md), [docs/final-report.md](docs/final-report.md)

The folder `bank-palestine-presentation (1)/` predates this project and is unrelated; it was left untouched.
