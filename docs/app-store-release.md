# App Store release plan & checklist

> "Technically ready" ≠ "Approved by Apple". Approval is an external step that can't be guaranteed.
> Requirements referenced here were checked on 2026‑09‑30 against Apple's published pages. **Re-verify them when you submit:**
> [Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) ·
> [Account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/) ·
> [SDK requirement since 2026‑04‑28](https://developer.apple.com/news/upcoming-requirements/?id=04282026a) ·
> [Submitting](https://developer.apple.com/app-store/submitting/) ·
> [App privacy details](https://developer.apple.com/app-store/app-privacy-details/)

## Status legend
✅ implemented & tested · 🧪 implemented, needs a physical device · 🔑 needs owner's external account · ⛔ blocked by a business decision

## A. Build & account
| Item | Status |
|---|---|
| Build toolchain: Xcode 26+ / iOS 26 SDK (Expo SDK 57 builds with Xcode 26 on EAS `image: latest`) | 🔑 build not run here (no macOS) |
| Bundle identifier owned by the owner (`IOS_BUNDLE_ID`; placeholder `com.example.bitaqati.dev` must be replaced) | ⛔/🔑 |
| Display name, version `1.0.0`, build number auto-increment (EAS), icon 1024², splash | ✅ placeholder artwork — replace with final brand |
| Apple Developer Program membership, App Store Connect app record, team roles | 🔑 |
| Signing: let EAS manage certificates/profiles, or supply your own via EAS credentials (never commit `.p12`/`.p8`) | 🔑 |
| Push: APNs key (.p8) uploaded to EAS/Expo; Push capability enabled for the bundle id | 🔑 |
| `eas build --profile production --platform ios` → IPA; `eas submit` → TestFlight | 🔑 not performed |
| Deployment target: SDK default (confirm minimum iOS in Expo SDK 57 docs); iPhone only (`supportsTablet: false`) | ✅ config |

## B. Privacy & account
| Item | Status |
|---|---|
| In-app account deletion (not just an email link), with re-authentication and a clear explanation | ✅ API + mobile screen (`app/me/delete.tsx`), tested |
| Public HTTPS privacy policy & support URL that match actual data handling | ⛔ drafts in `docs/legal/`; host them and set the URLs in admin settings |
| App Privacy "nutrition label" — see the inventory below | 🔑 answer in App Store Connect |
| Privacy manifest: app-level `privacyManifests` in `app.config.ts` (UserDefaults CA92.1, FileTimestamp C617.1, SystemBootTime 35F9.1, DiskSpace E174.1). Verify the generated `PrivacyInfo.xcprivacy` and each SDK's manifest in the Xcode archive | 🧪 |
| Purpose strings: camera, photo library, location (only for "Near me"), Face ID — Arabic + English | ✅ |
| Notification permission requested in context (Account → Notifications), never required for the card | ✅ |
| Marketing notifications opt-in only | ✅ |
| No third-party login. If Google or other social login is added later → Guideline 4.8 (Sign in with Apple or an equivalent) with full revoke/delete | n/a |

### Data inventory for App Privacy answers (verify before submitting)
| Data type | Collected | Linked to user | Tracking | Purpose |
|---|---|---|---|---|
| Name, email | yes | yes | no | App functionality, account |
| Photo (user content) | yes | yes | no | App functionality (card holder verification) |
| Purchase history — discount transactions (store, amounts, date) | yes | yes | no | App functionality, analytics (aggregate) |
| Coarse location | used transiently for "Near me" (rounded, not stored) | no | no | App functionality — confirm how this should be declared |
| Device ID / push token | Expo push token | yes | no | App functionality (notifications) |
| Diagnostics | none by default (add if Sentry etc. is added) | — | — | — |
No advertising SDKs, no tracking, no contacts, no bank data.

## C. Subscription & payments — **launch decision (⛔ blocker for selling memberships)**
- The in-store invoice is paid outside the app and is not handled by the app. That fact alone **does not** settle how selling the membership itself must be classified.
- v1 implements **manual activation by admins** (time is granted only after the admin verifies payment out-of-band, with an audited reason). This is an implementation assumption. It is **not** a compliance position and not a way to avoid Apple's rules.
- Before any membership is sold in or through the app: review Guideline 3.1 (3.1.1 IAP, 3.1.3 exceptions, 3.1.5 for physical goods/services consumed outside the app) against the real benefits and target markets, and write the decision and its source in `launch-decisions.md`. If it's unclear, **ask Apple (App Review contact) before launch**.
- Don't add an external payment link, a paid activation code, or copy steering users to buy elsewhere unless that is explicitly allowed for this app category and storefront.
- If IAP applies: StoreKit 2 + App Store Server API validation, App Store Server Notifications v2 → subscription entitlement table, restore purchases, refunds/revocation. Not implemented.
- If an external provider is allowed: provider checkout with signed, idempotent webhooks → subscription grant. Never store card data. Not implemented.
- **Until decided, the app must not be described as ready for public sale.**

## D. Store listing & review
- Metadata AR/EN: `app-store-metadata-ar-en.md` (check current character limits in App Store Connect).
- Category suggestion: Lifestyle (alt. Shopping). Age rating: answer the questionnaire truthfully (no objectionable content; likely 4+).
- Screenshots: only from the final build, on a real device/simulator with review data, for the required iPhone sizes (6.9" and any others App Store Connect requires). No mock-ups of features that don't exist.
- Review notes & accounts: `app-review-notes.md` (isolated test merchant, member + cashier accounts, two-device or single-device path).
- The review server must be up for the whole review. Review accounts must not expire (the seed grants 365 days).
- Export compliance: `ITSAppUsesNonExemptEncryption=false` (HTTPS/TLS only). **Owner must confirm** the answer for their distribution countries.
- Regional/legal: seller name and trader status (EU DSA if distributing in the EU), agreements, tax and banking in App Store Connect — owner's responsibility.

## E. Device test checklist (🧪 must be done on a physical iPhone before calling it a release candidate)
1. Fresh install → Arabic RTL layout, then switch to English (app restarts, LTR). Serials/references render correctly in both.
2. Register → verify email link opens the app (or paste the token) → login.
3. Photo: take with camera and choose from library; deny permission → Settings link works.
4. Admin approves photo + grants plan → card becomes ACTIVE; QR refreshes before expiry; airplane mode → QR hidden with the offline message.
5. Face ID card lock on/off.
6. Second iPhone (staff account): choose branch → scan QR → photo shown → MATCH → invoice 200 → member sees the approval sheet → approve → staff confirms → both see the result; repeat → "used today".
7. Kill the network right after tapping confirm → the app retries with the same key and shows a single result.
8. Manual serial entry → member's app shows the verification request → accept.
9. Deny camera on the staff phone → manual entry is offered.
10. Push: enable → receive "discount recorded" on the lock screen with no sensitive info. Deny → the in-app center still shows it.
11. Dynamic Type (largest sizes), VoiceOver on the main paths, iPhone SE-size and Pro Max-size screens, number pad, safe areas/notch.
12. Account deletion end-to-end, then login fails.
13. Midnight: an entitlement used before 00:00 local is available after 00:00 (can be simulated in staging by changing the platform time zone setting).

## F. Submission flow
1. Staging green (CI, E2E, device checklist).
2. Production infra up, legal pages live, review accounts seeded (`SEED_MODE=review`).
3. `eas build --profile production -p ios` → `eas submit -p ios` → TestFlight internal testing → external beta (optional).
4. Complete App Privacy, age rating, pricing (free app), export compliance, review notes, and screenshots.
5. Submit for review.
6. If rejected: read the guideline cited, reply in Resolution Center with facts (not arguments), fix, bump the build number, and resubmit. Keep a log in `release-blockers.md`.
7. After approval, choose manual or automatic release, then monitor crash reports and API error rates.
