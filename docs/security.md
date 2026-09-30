# Security & privacy

## Authentication
- Passwords: **Argon2id** (m = 19 MiB, t = 2, p = 1; OWASP baseline). Min 10 chars, letters + digits. Constant-time dummy verification for unknown accounts.
- Login requires a verified email. Registration responds identically whether or not the email exists (the existing owner is notified instead).
- Access tokens: HS256, 15 min, contain only `sub`, `sid`, `typ`. **Each request re-checks the session row**, so logout, suspension, deletion or a password reset take effect immediately.
- Refresh tokens: 32 random bytes, stored as SHA-256, rotated on every use. Re-presenting a rotated token revokes the whole session (theft detection).
- Mobile: the refresh token is kept in the iOS Keychain via SecureStore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`); the access token stays in memory only.
- Admin: separate `/auth/admin/login`, mandatory **TOTP MFA** (enrollment on first login). The secret is encrypted with AES-256-GCM using `MFA_ENCRYPTION_KEY`. There are 10 single-use recovery codes (stored hashed). Another admin with `ADMINS_MANAGE` can reset MFA, which is audited and revokes that admin's sessions. Non-MFA sessions can't call admin endpoints.
- Admin web: tokens live only in HttpOnly, Secure (in production), SameSite=Strict cookies behind a server-side BFF that only forwards `/v1/admin/*`. State-changing requests need a same-origin `Origin` and a custom header (CSRF). Security headers include a CSP, `frame-ancestors 'none'`, nosniff and no-referrer leakage.
- Recovery: reset links are single-use, expire after 1 h, and only the newest one works. A reset revokes all sessions. An email change needs the password plus confirmation from the new address, and notifies the old address.
- Merchant/admin roles come only through **invitations** (a hashed token, 7 days, single use). An existing account must re-enter its password to accept. Role, store or branch values from clients are never trusted: scope is resolved from memberships on every request.

## Authorization
- RBAC: admin permissions (`USERS_MANAGE`, `PHOTOS_REVIEW`, `MERCHANTS_MANAGE`, `OFFERS_MANAGE`, `SUBSCRIPTIONS_MANAGE`, `REDEMPTIONS_VIEW`, `REDEMPTIONS_VOID`, `NOTIFICATIONS_SEND`, `REPORTS_VIEW`, `SETTINGS_MANAGE`, `ADMINS_MANAGE`, `AUDIT_VIEW`) are checked by the global guard.
- Record ownership is checked server-side for every merchant object (verification, quote, redemption, staff) through `MerchantAccessService`. Records in another scope return 404 or 403 without revealing existence. IDOR tests are in `apps/api/test/redemption.test.ts`.

## Anti-sharing (limits stated honestly)
Short-lived QR codes, a visual photo check by staff, and explicit in-app approval by the member **reduce** card sharing. They **don't prevent** collusion, a member handing over their unlocked phone, or a staff member approving a mismatch. MISMATCH decisions are audited, and every confirmation records the staff member and branch. The optional Face ID lock only protects the device display and is not proof of identity to the store.

## Data protection
- No government ID, no biometric templates, no bank cards, no contacts, no continuous location, no advertising ID, no tracking.
- Profile photos: validated by decoding (not by extension), re-encoded to JPEG (drops EXIF/GPS and embedded payloads), max 8 MB, min 200×200. Stored privately (S3 with SSE in production). Served only through authorized API routes with `Cache-Control: private, no-store`: to the member, to reviewing admins, and to the verifying staff while a verification is live. No bulk photo export exists for merchants.
- QR tokens, refresh tokens, reset/verification/invitation tokens: only SHA-256 hashes are stored.
- Logs: structured JSON (pino) with a request id. Authorization, cookies, passwords, tokens, QR payloads and MFA codes are redacted. Request logs contain method, route, status, latency and user id — never bodies or query strings.
- Push text contains no photos, serials or amounts other than the member's own savings (lock-screen safe).
- CSV export neutralizes formula injection (`= + - @` prefixes) and is audited.
- Rate limits (Redis in production): login (per email / per IP), registration, password reset, verification resend, MFA, re-authentication, QR issuance, scans, manual serial lookups (per staff / per branch), photo uploads, invitations.
- Input validation: Zod on every body/query; UUID path params; JSON body limit 100 kB; Prisma parameterized queries (raw SQL only via tagged templates).

## Audit log
Append-only (DB trigger). It covers: photo submitted/approved/rejected, card issue/activate/suspend/reactivate/replace/revoke, subscription grant/cancel, user suspend/reactivate, name/email/password changes, offer publish/deactivate, merchant/store/branch create/update/status, staff invite/branch change/deactivate, invitations, admin permission changes, MFA events, settings changes, redemption void, CSV export, verification mismatch, account deletion.

## Account deletion {#deletion}
`POST /v1/me/deletion-request` with password + "DELETE", from inside the app. In one transaction it:
- revokes all sessions and refresh tokens; deletes push tokens, QR tokens, email tokens, notifications and preferences
- revokes admin grants and deactivates memberships
- revokes the card, cancels subscriptions, and cancels open verifications and quotes
- replaces the profile name with "Deleted user", clears the photo keys, turns the email into `deleted+<id>@deleted.invalid`, and removes the password and MFA secret
- deletes photo files immediately (and retries through the outbox if that fails)

**Retained:** confirmed/voided redemption rows (merchant accounting records) without personal data. Merchants see "Deleted" as the name. Append-only audit entries reference the user id only. Backups age out after 35 days (backup-restore.md). The retention periods for these records are a **legal decision** (see launch-decisions.md).

## Secrets & environments
- Secrets come only from environment variables or a secret manager. `.env*` files are git-ignored, and CI runs gitleaks.
- Development, staging and production use separate databases, buckets, push credentials and Apple/Expo projects. Staging uses production-strict config validation. Development email goes to Mailpit, so it never reaches real customers.
- TLS is terminated at the load balancer (HTTPS only, HSTS). Set `TRUST_PROXY=true` so rate limits see client IPs.

## Known limitations / follow-ups
- Expo push "SENT" means Expo accepted the ticket; receipt polling (delivery to APNs) is not implemented yet.
- The admin session has no idle timeout beyond the 15-min access token and the refresh expiry. Consider a shorter refresh TTL for admins (config).
- Run a professional penetration test before launch (release-blockers.md).
