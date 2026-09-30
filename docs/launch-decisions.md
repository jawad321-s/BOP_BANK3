# Launch decisions needed from the owner | قرارات مطلوبة من صاحب المشروع

Everything below is **open**. The code uses the default in the "Current default" column. Don't share secrets in chat or in Git.

| # | Decision | Current default in code | Impact |
|---|---|---|---|
| 1 | Final app name & trademark check (بطاقتي \| Bitaqati is a working name) | configurable (`APP_DISPLAY_NAME`, admin settings) | store listing, icon |
| 2 | Owning legal entity (seller in App Store Connect), address, registration | — | legal pages, copyright, App Store |
| 3 | **How memberships are sold** (IAP vs. offline sale vs. external provider) and Guideline 3.1 analysis per storefront; ask Apple if unclear | manual admin activation only | **blocks public sale** |
| 4 | Plan(s): price, duration, renewal, cancellation, refunds | `ANNUAL` plan, 365 days, price informational | terms, UI copy |
| 5 | Target countries / storefronts | — | legal, export compliance, currency |
| 6 | Daily limit scope: per store (all branches) vs. per branch | per **store** | DB index + migration if changed |
| 7 | Business-day time zone | `Asia/Hebron` (admin-configurable) | eligibility dates |
| 8 | Discount terms: exclusions, caps, minimums per store | percentage with optional cap/minimum | merchant contracts |
| 9 | Card-holder verification policy (photo rules, who approves, SLA, rejection reasons) | admin photo approval, no ID documents | onboarding UX |
| 10 | Customer support channel & hours (email/phone/WhatsApp) | configurable in admin | App Store support URL |
| 11 | Data retention periods for transactions, logs, backups; minimum age | backups 35 days; transactions retained anonymized | privacy policy |
| 12 | Sub-processors (hosting region, email, storage, push) | Expo push, any S3, any SMTP | privacy policy, DPA |
| 13 | Admin void policy (who may void, time window, dual control?) | any admin with `REDEMPTIONS_VOID`, reason required | fraud risk |
| 14 | Dark mode and iPad support | not claimed (light, iPhone only) | QA scope |
| 15 | Downloads metric source (App Store Connect API key) | "Not available" | admin dashboard |
| 16 | Operational invoice ceiling | 50,000 ₪ | fraud control |
| 17 | Bundle identifier, Apple team, EAS project | placeholders | build/signing |

Record each decision with date, owner, and source (e.g. Apple reply) here.
