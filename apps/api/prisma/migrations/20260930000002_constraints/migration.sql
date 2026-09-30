-- Hand-written constraints that Prisma's schema language cannot express.

-- ===== Daily limit: one CONFIRMED redemption per user, per store, per business date =====
CREATE UNIQUE INDEX "redemptions_daily_limit_uq"
  ON "redemptions" ("user_id", "store_id", "business_date")
  WHERE "status" = 'CONFIRMED';

-- ===== Money / rate sanity =====
ALTER TABLE "redemptions"
  ADD CONSTRAINT "redemptions_amounts_chk" CHECK (
    "gross_minor" > 0 AND "eligible_minor" > 0 AND "eligible_minor" <= "gross_minor"
    AND "discount_minor" >= 0 AND "discount_minor" <= "eligible_minor"
    AND "net_minor" = "gross_minor" - "discount_minor"
    AND "rate_bps" > 0 AND "rate_bps" <= 10000
    AND "currency" = 'ILS'
  ),
  ADD CONSTRAINT "redemptions_void_chk" CHECK (
    ("status" = 'CONFIRMED' AND "voided_at" IS NULL)
    OR ("status" = 'VOIDED' AND "voided_at" IS NOT NULL AND "void_reason" IS NOT NULL AND "voided_by_id" IS NOT NULL)
  );

ALTER TABLE "discount_quotes"
  ADD CONSTRAINT "discount_quotes_amounts_chk" CHECK (
    "gross_minor" > 0 AND "eligible_minor" > 0 AND "eligible_minor" <= "gross_minor"
    AND "discount_minor" >= 0 AND "discount_minor" <= "eligible_minor"
    AND "net_minor" = "gross_minor" - "discount_minor"
    AND "rate_bps" > 0 AND "rate_bps" <= 10000
  );

ALTER TABLE "discount_offers"
  ADD CONSTRAINT "discount_offers_rate_chk" CHECK ("rate_bps" > 0 AND "rate_bps" <= 10000),
  ADD CONSTRAINT "discount_offers_limits_chk" CHECK (
    ("min_eligible_minor" IS NULL OR "min_eligible_minor" > 0)
    AND ("max_discount_minor" IS NULL OR "max_discount_minor" > 0)
  );

-- One ACTIVE offer per store at a time.
CREATE UNIQUE INDEX "discount_offers_one_active_uq" ON "discount_offers" ("store_id") WHERE "status" = 'ACTIVE';

ALTER TABLE "plans" ADD CONSTRAINT "plans_values_chk" CHECK ("duration_days" > 0 AND "price_minor" >= 0);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_range_chk" CHECK ("ends_at" > "starts_at");

-- ===== Cards: at most one current card per user; serial format =====
CREATE UNIQUE INDEX "cards_one_current_per_user_uq" ON "cards" ("user_id") WHERE "is_current";
ALTER TABLE "cards" ADD CONSTRAINT "cards_serial_format_chk" CHECK ("serial_number" ~ '^BT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$');

-- ===== Branch coordinates =====
ALTER TABLE "branches" ADD CONSTRAINT "branches_coords_chk" CHECK (
  ("lat" IS NULL AND "lng" IS NULL) OR ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180)
);

-- ===== Approvals: one live approval per quote is enforced by quote_id UNIQUE =====

-- ===== Append-only tables =====
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER redemption_events_append_only BEFORE UPDATE OR DELETE ON "redemption_events"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Redemptions: financial fields are immutable once written; only the CONFIRMED -> VOIDED transition is allowed.
CREATE OR REPLACE FUNCTION redemptions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'redemptions cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.gross_minor IS DISTINCT FROM OLD.gross_minor
     OR NEW.eligible_minor IS DISTINCT FROM OLD.eligible_minor
     OR NEW.discount_minor IS DISTINCT FROM OLD.discount_minor
     OR NEW.net_minor IS DISTINCT FROM OLD.net_minor
     OR NEW.rate_bps IS DISTINCT FROM OLD.rate_bps
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.store_id IS DISTINCT FROM OLD.store_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.business_date IS DISTINCT FROM OLD.business_date
     OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
     OR NEW.offer_id IS DISTINCT FROM OLD.offer_id
     OR NEW.terms_snapshot::text IS DISTINCT FROM OLD.terms_snapshot::text THEN
    RAISE EXCEPTION 'redemption financial fields are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'VOIDED' AND NEW.status <> 'VOIDED' THEN
    RAISE EXCEPTION 'a voided redemption cannot be restored' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER redemptions_guard BEFORE UPDATE OR DELETE ON "redemptions"
  FOR EACH ROW EXECUTE FUNCTION redemptions_guard();

-- ===== Helpful search indexes =====
CREATE INDEX "user_profiles_full_name_lower_idx" ON "user_profiles" (lower("full_name"));
CREATE INDEX "stores_name_lower_idx" ON "stores" (lower("name_en"), lower("name_ar"));
CREATE INDEX "outbox_pending_idx" ON "outbox_events" ("available_at") WHERE "processed_at" IS NULL;
