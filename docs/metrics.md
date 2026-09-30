# Metric definitions

All metrics are computed from real data at query time. Business dates are in the platform time zone.

| Metric | Definition |
|---|---|
| Registered users | Accounts with status ≠ DELETED (all time). |
| New users (period) | Accounts created within [from 00:00, to 24:00) local time. |
| Active memberships ("اشتراك فعال") | Current card ACTIVE **and** user ACTIVE **and** approved photo **and** a subscription with `starts_at ≤ now < ends_at`. This is **not** "activity in the last 30 days". |
| Customers who redeemed ("عميل مختلف") | `COUNT(DISTINCT user_id)` of CONFIRMED redemptions with business_date in the period. A customer is not a transaction. |
| Confirmed transactions | Count of CONFIRMED (non-voided) redemptions by business_date. |
| Voided transactions | Count of redemptions whose `voided_at` falls in the period. |
| Savings | Sum of `discount_minor` over CONFIRMED redemptions. |
| Merchant "recorded discount transaction amounts" | Sums of gross/discount/net over CONFIRMED redemptions in the merchant's scope. These are **not** collected payments or merchant revenue. |
| Merchant periods | today; week = last 7 business days including today; month = calendar month to date; year = calendar year to date; custom (max 3 years). |
| Active stores / branches | Store ACTIVE with an ACTIVE merchant and an active offer; branch ACTIVE under such a store. |
| Top stores | Stores ranked by confirmed transactions in the period (also shows distinct customers and savings). |
| Downloads | **Not available** until an authorized App Store Connect Analytics integration exists. Shown as "غير متوفر" — never estimated from account counts. |

Privacy: admin charts are aggregates. Merchant views show only their own scope and customers' first names; no contact details or photos in lists or exports.
