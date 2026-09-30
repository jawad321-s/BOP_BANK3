# Deployment guide

Target topology (any cloud): managed PostgreSQL 16 (encrypted, PITR), managed Redis 7, S3-compatible private bucket,
container runtime for **api** (≥2 replicas), **worker** (1–2 replicas), **admin** (1–2 replicas), TLS load balancer.

## Environments
| | development | staging | production |
|---|---|---|---|
| Config validation | lenient (dev fallbacks) | **strict** (same as prod) | strict |
| Email | Mailpit | real provider, restricted recipients / test domain | real provider |
| Push | `log` (SIMULATED) | Expo + separate EAS project/APNs sandbox | Expo + production APNs |
| Storage | local / MinIO | separate bucket | separate bucket |
| Seed | `pnpm db:seed` | `SEED_MODE=review` only | `SEED_MODE=review` only (App Review accounts, isolated test merchant) |

Never point staging at production data. Never send staging notifications to real customers.

## Build
```bash
docker build -f infra/api.Dockerfile -t bitaqati-api:$(git rev-parse --short HEAD) .
docker build -f infra/admin.Dockerfile -t bitaqati-admin:$(git rev-parse --short HEAD) .
```

## Release procedure
1. **Backup check**: confirm last successful backup / PITR window.
2. **Migrate** (one-off job with the api image):
   `node /app/node_modules/prisma/build/index.js migrate deploy --schema /app/apps/api/prisma/schema.prisma`
   Migrations must be backward compatible with the previous app version (expand → deploy → contract).
3. Deploy **api** (rolling; readiness probe `GET /ready`, liveness `GET /health`).
4. Deploy **worker** (`CMD node dist/worker.js`). Only this process runs schedulers.
5. Deploy **admin** with `API_INTERNAL_URL` pointing to the internal API service (not public).
6. Smoke test: `/ready`, admin login (MFA), review-account flow (app-review-notes.md).

## Required production settings
See `.env.example`. The API refuses to start without `JWT_ACCESS_SECRET`, `MFA_ENCRYPTION_KEY`, `REDIS_URL`, SMTP, Expo push, S3 settings and an https `PUBLIC_API_URL`.
Set `TRUST_PROXY=true` behind the load balancer. Configure HSTS on the LB. Set admin settings (support email, privacy/terms URLs) in the admin UI after first deploy.

## TLS / domains
- `api.<domain>` → api service (HTTPS only).
- `admin.<domain>` → admin service; restrict by IP/VPN/SSO if possible.
- `<domain>` → public site hosting privacy policy, terms, support page, and the email-link landing pages (`/verify-email`, `/reset-password`, `/invite`, `/confirm-email-change`) that open the app (`bitaqati://…`) or show instructions. Configure iOS Universal Links (associated domains) before launch.

## Rollback
- App: redeploy previous image tags (api, worker, admin).
- DB: migrations are forward-only. Roll back by deploying the previous app version (compatible under expand/contract). For a destructive mistake, restore with PITR (backup-restore.md). Rollback steps are rehearsed in staging.

## Mobile
EAS profiles in `apps/mobile/eas.json` (`development`, `staging`, `production`). Set `IOS_BUNDLE_ID`, `EXPO_PUBLIC_API_URL`, `EAS_PROJECT_ID`, `APP_DISPLAY_NAME` as EAS environment variables. See app-store-release.md.
