# API overview

Base path `/v1`. JSON only (plus multipart for uploads). The generated OpenAPI document is `docs/openapi.json`
(regenerate: `pnpm --filter @bitaqati/api openapi`); an interactive UI runs at `/docs` outside production.

## Conventions
- Auth: `Authorization: Bearer <access token>` (15 min). Refresh: `POST /v1/auth/refresh` (rotating, reuse detection).
- Admin endpoints require an **MFA-verified** admin session plus the specific permission.
- Money: integer minor units (`…Minor`); rates in basis points (`rateBps`).
- Pagination: `?limit=1..100&cursor=<opaque>` → `{ items, nextCursor }`.
- Errors: `{ "error": { "code": "ALREADY_REDEEMED_TODAY", "message": "<localized by Accept-Language>", "requestId": "…", "details"?: {} } }`.
  Every response carries `X-Request-Id`.
- `POST /v1/merchant/redemptions` requires `Idempotency-Key` (16–100 chars). The same key with the same body returns the original result (200). The same key with a different body returns 422 `IDEMPOTENCY_KEY_REUSED`.

## Endpoints (by area)
| Area | Endpoints |
|---|---|
| Health | `GET /health`, `GET /ready` |
| Public | `GET /v1/config`, `GET /v1/stores`, `GET /v1/stores/:id`, `GET /v1/categories`, `GET /v1/cities`, `GET /v1/media/stores/:storeId/:file` |
| Auth | `POST /v1/auth/register`, `/verify-email`, `/verify-email/resend`, `/login`, `/refresh`, `/logout`, `/password/forgot`, `/password/reset`, `/email/confirm-change`, `/invitations/accept`, `/admin/login`, `/admin/mfa/enroll`, `/admin/mfa/verify` |
| Profile & card | `GET/PATCH /v1/me`, `GET /v1/me/workspaces`, `GET /v1/me/home`, `GET /v1/me/card`, `POST /v1/me/card/qr-token`, `GET /v1/me/usage`, `POST/GET /v1/me/photo` |
| Approvals | `GET /v1/me/approvals/pending`, `POST /v1/me/approvals/:quoteId/approve|reject`, `GET /v1/me/verification-requests`, `POST /v1/me/verification-requests/:id/accept|decline` |
| Security | `GET /v1/me/sessions`, `DELETE /v1/me/sessions/:id`, `POST /v1/me/sessions/revoke-others`, `POST /v1/me/password`, `POST /v1/me/email/change` |
| Notifications | `GET /v1/me/notifications`, `POST /v1/me/notifications/read`, `GET/PATCH /v1/me/notification-preferences`, `POST /v1/me/push-tokens`, `POST /v1/me/push-tokens/remove` |
| Deletion | `POST /v1/me/deletion-request` |
| Merchant | `GET /v1/merchant/dashboard`, `POST /v1/merchant/verifications`, `GET /v1/merchant/verifications/:id`, `GET …/:id/photo`, `POST …/:id/match`, `POST …/:id/cancel`, `POST /v1/merchant/quotes`, `POST /v1/merchant/redemptions`, `GET /v1/merchant/redemptions`, `GET /v1/merchant/redemptions/:id`, staff: `GET/POST/PATCH/DELETE /v1/merchant/merchants/:merchantId/staff…` |
| Admin | dashboard, reports/timeseries, audit-logs, users (list/detail/photo/review/status/card/subscriptions/permissions/mfa reset), plans, merchants, memberships, categories, stores (+logo/images/status/offers), branches, invitations, redemptions (list/detail/void/export.csv), broadcasts (preview/create/schedule/cancel), settings |

## Error codes
`VALIDATION_FAILED, UNAUTHENTICATED, INVALID_CREDENTIALS, EMAIL_NOT_VERIFIED, SESSION_EXPIRED, MFA_REQUIRED, MFA_ENROLLMENT_REQUIRED, MFA_INVALID, FORBIDDEN, NOT_FOUND, CONFLICT, RATE_LIMITED, EMAIL_TAKEN, TOKEN_INVALID, ACCOUNT_SUSPENDED, CARD_NOT_FOUND, CARD_PENDING, CARD_EXPIRED, CARD_SUSPENDED, CARD_REVOKED, PHOTO_NOT_APPROVED, NO_ACTIVE_SUBSCRIPTION, QR_EXPIRED, QR_INVALID, VERIFICATION_EXPIRED, VERIFICATION_NOT_MATCHED, VERIFICATION_REJECTED, AWAITING_USER_CONFIRMATION, ALREADY_REDEEMED_TODAY, STORE_UNAVAILABLE, BRANCH_NOT_ASSIGNED, NO_ACTIVE_OFFER, INVALID_AMOUNT, AMOUNT_TOO_LARGE, ELIGIBLE_EXCEEDS_GROSS, ELIGIBLE_REASON_REQUIRED, BELOW_MINIMUM, INVALID_RATE, QUOTE_EXPIRED, QUOTE_CHANGED, QUOTE_ALREADY_USED, APPROVAL_REQUIRED, APPROVAL_REJECTED, APPROVAL_MISMATCH, IDEMPOTENCY_KEY_REQUIRED, IDEMPOTENCY_KEY_REUSED, REQUEST_IN_PROGRESS, ALREADY_VOIDED, UPLOAD_INVALID, REAUTH_REQUIRED, SERVICE_UNAVAILABLE, INTERNAL_ERROR` — Arabic/English messages in `packages/shared/src/errors.ts`.
