# Business rules (implemented defaults)

Defaults below are **implemented and tested**. Items marked *(decision)* need the owner's confirmation before launch — see `launch-decisions.md`.

## Daily limit
- **One confirmed, non-voided redemption per user × store × business date.** All branches of a store share the limit;
  `branch_id` is stored for reporting. Enforced by a partial unique index, not by read-then-write.
- Different stores on the same day are allowed.
- The limit is keyed on the **user**, not the card: card replacement, a new serial, renewal or reactivation never restores a use already consumed today.
- Scanning, verifying, quoting, approving or abandoning never consumes the entitlement. Only the confirmation does.
- Switching to "once per branch" *(decision)* would require changing the unique index to `(user_id, branch_id, business_date)` plus a data migration and new tests.

## Business day and time
- Business date = the calendar date in the platform time zone (default `Asia/Hebron`, configurable in admin settings with an audited reason), computed **on the server at confirmation time**. It's a day from local midnight to local midnight, not a rolling 24-hour window. DST days are 23 or 25 hours long, and this is tested.
- The phone's clock is never used. QR expiry is displayed using server time (`serverTime` in the response).
- If a session spans midnight, the redemption is dated on the confirmation day and eligibility is re-checked for that day.
- `confirmed_at`/`created_at` are stored in UTC, and `business_date` + `timezone` are stored on each redemption.
- Changing the time zone affects only future business dates.
- Consumption is never cleared by a cron job. "Available today" is computed from confirmed rows for the current business date.

## Money
- ILS stored as integer agorot (100 = 1 ₪). Rates stored as basis points (2000 = 20%).
- `discount = round_half_up(eligible × rate_bps / 10000)`; optional `maxDiscountMinor` cap and `minEligibleMinor` floor from the offer version.
- `net = gross − discount`, never negative. `eligible ≤ gross`. Zero/negative amounts, out-of-range rates and amounts above the operational ceiling (`maxInvoiceMinor`, default 50,000 ₪) are rejected.
- If the eligible amount differs from the gross amount, a reason is required and stored.
- Acceptance example: 200.00 ₪, 20%, eligible 200.00 → discount 40.00, pay 160.00 (unit + integration + E2E tests).
- The merchant never sends a rate or a final amount. The server computes the quote and snapshots the offer terms.

## Offers
- Percentage discount only. The data model stores a version snapshot. Other discount types aren't exposed because they aren't implemented.
- Publishing a new offer version supersedes the previous one and invalidates every open quote/approval for that store
  in the same transaction (`QUOTE_CHANGED` → re-quote → new approval). Confirmed redemptions keep their snapshot, and the DB forbids rewriting it.

## Verification and approval
- QR token: 32 random bytes, 60 s TTL (configurable 20–300 s), bound to card + session, stored as SHA-256 only, single-use, revoked on logout/suspension/replacement/new photo approval, never issued for inactive memberships.
- A scan creates a verification session (15 min) tied to staff, branch, store and card. A new scan for the same card at the same branch cancels the previous one.
- The staff member sees the approved photo and name only during the live session, and records MATCH/MISMATCH (mismatches are audited).
- Manual serial entry: the member must accept in their app before any name or photo is shown. It's rate-limited (10 per 10 min per staff member, 40 per hour per branch). Knowing a serial is never enough.
- The member approves the exact quote (fingerprint over amounts, rate, offer version, store, branch and expiry). Any change makes a new quote that needs approval again.
- Confirmation re-checks the quote, approval, membership, card, subscription, offer, store/branch status and staff scope inside one transaction.

## Card and membership
- States: PENDING, ACTIVE, SUSPENDED, EXPIRED, REVOKED. The derived membership state combines the card, the current subscription window, the approved photo and user status.
- Registration creates a PENDING card with a random serial `BT-XXXX-XXXX-XXXX` (60 bits, Crockford base32). The serial is not secret.
- v1 subscriptions are **granted manually by an admin** with a reason and an optional payment reference, never from a client claim. Renewals stack; a period ends at local midnight. Granting activates a PENDING card. *(decision: how memberships are sold — see launch decisions / App Store 3.1)*
- A new photo upload goes to review. Merchants keep seeing the previously approved photo until the new one is approved, so the holder can't be swapped silently.

## Void (cancellation)
- Only admins with `REDEMPTIONS_VOID`, with a mandatory reason. The original row, amounts and events are kept. A `VOIDED` event and an audit entry are appended.
- Voided redemptions are excluded from savings and merchant totals and shown as voided in history.
- Voiding today's redemption re-opens today's entitlement at that store; voiding an older one doesn't affect today.
- Cashiers and owners can't void. Abuse risk: admins could void and re-use. Mitigated by the audit log (who, when, why) and the admin audit screen; review regularly (operations.md).

## Roles
- USER (default on registration), MERCHANT_OWNER, MERCHANT_STAFF (via invitation only), ADMIN (granular permissions, invitation by `ADMINS_MANAGE`, MFA required).
- Owners can invite **staff only**, to their own merchant's branches, and deactivate staff. Staff can't change rates, subscriptions or roles.
