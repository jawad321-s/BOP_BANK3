# App Review notes (template — fill real values before submitting)

**English (paste into App Store Connect → App Review Information → Notes):**

Bitaqati is a digital membership card that gives members a percentage discount on purchases at real partner stores.
The app does not process or transfer any invoice payment: the customer pays the store as usual. The app only verifies
the member, calculates the discount on our server, asks the member to approve the amount, and records the transaction.
Each membership can be used once per store per calendar day (Asia/Hebron time) and at different stores on the same day.

Memberships are activated by our staff in v1 (no purchase inside the app). <<Update this paragraph to match the final payment decision.>>

To test the full flow without visiting a store, we created an isolated test store "Test Store (App Review)" and two accounts:

- Member: `<<review.member@…>>` / `<<password>>` (active membership, approved photo)
- Store cashier: `<<review.merchant@…>>` / `<<password>>` (owner of the test store)

Steps (two devices recommended, or one device plus the screenshots in the attached video):
1. Device A: sign in as Member → tab "My card" (بطاقتي) shows a QR code that refreshes every 60 s.
2. Device B: sign in as Cashier → Account/Settings → switch to "Store workspace" if needed → tab "Scan" → scan the QR on Device A.
   (Single device: on Device B choose "Manual entry" and type the member's serial shown on the card; Device A then shows a verification request → "I'm at the store".)
3. Device B: compare the photo → "Matches" → enter invoice 200 → "Calculate discount".
4. Device A: an approval sheet shows 200 ₪, discount 40 ₪ (20%), pay 160 ₪ → "Approve".
5. Device B: "Confirm discount use" → result with reference number. Trying again at the same store today shows "already used today".
6. Account deletion: Member → Account (الحساب) → "Delete account".

The app's primary language is Arabic (right-to-left). To review in English: Account → Language → English (the app restarts).
Camera is used only to scan cards and take the card photo. Location is used only when "Near me" is tapped.

**Arabic summary (for internal reference):** التطبيق بطاقة خصومات على مشتريات في محلات فعلية، لا ينقل مال الفاتورة؛
الحد: مرة لكل محل في اليوم المحلي؛ التحقق بصورة معتمدة + رمز QR قصير العمر + موافقة العضو داخل التطبيق.

## Checklist
- [ ] `SEED_MODE=review` run against production with `SEED_REVIEW_*_PASSWORD` from the secret manager
- [ ] Review accounts verified to work end-to-end on the production build (TestFlight)
- [ ] Test store is visible only as "(App Review)", in its own category, with no real customers affected
- [ ] Backend monitored during review; membership won't expire during review
- [ ] Optional demo video attached (help only — reviewers must still have real access)
