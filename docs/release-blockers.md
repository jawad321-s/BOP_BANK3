# Release blockers & remaining work

Status legend: ⛔ blocked by business decision · 🔑 needs external account/credentials · 🧪 needs physical device · 🛠 engineering work

| # | Blocker | Type | Notes |
|---|---|---|---|
| 1 | Membership sales model & App Store 3.1 compliance decision | ⛔ | Until decided: no in-app sale, and don't market the app as ready for public sale. |
| 2 | Legal entity, final name, privacy policy & terms reviewed by counsel and hosted on public HTTPS | ⛔ | Drafts in `docs/legal/`. |
| 3 | Apple Developer account, bundle id, App Store Connect record, signing, APNs key | 🔑 | See app-store-release.md §A. |
| 4 | EAS project + production build + TestFlight | 🔑 | Not performed here (no macOS/Apple credentials). |
| 5 | Physical iPhone test pass (checklist §E) incl. VoiceOver/Dynamic Type/RTL | 🧪 | Not performed here. |
| 6 | Production-like staging (S3, SMTP provider with SPF/DKIM, Redis, TLS, 2+ API replicas) + load test + restore drill | 🔑🛠 | Local driver and SMTP sink were tested only. |
| 7 | Universal Links / email landing pages on the public domain | 🛠🔑 | Links currently target `PUBLIC_APP_LINK_BASE`; the app accepts pasted tokens as a fallback. |
| 8 | Final brand assets (icon, splash, screenshots) and a licensed Arabic font (e.g. IBM Plex Sans Arabic, OFL) bundled via expo-font | 🛠 | Placeholder icon; system Arabic font used now. |
| 9 | External penetration test | 🔑 | Recommended before launch. |
| 10 | Expo push receipts polling (delivery confirmation beyond ticket acceptance) | 🛠 | Documented limitation. |
| 11 | Scheduled cleanup jobs (idempotency/QR/old sessions) | 🛠 | SQL in operations.md; wire into worker scheduler. |
| 12 | Error monitoring (Sentry or similar) with PII scrubbing | 🛠🔑 | Hook point: global exception filter + mobile ErrorBoundary. |
| 13 | App Privacy answers, age rating, export compliance confirmation | 🔑 | Inventory in app-store-release.md. |

A build can be called a **release candidate** only after 1–6 and 13 are closed. Apple approval is a separate, later step.
