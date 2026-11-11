BEGIN;

-- No UPDATE/backfill: historical discounts cannot be attributed to today's live coupon/listing.
ALTER TABLE "Booking"
  ADD COLUMN "appliedCouponId" UUID,
  ADD COLUMN "appliedCouponCode" VARCHAR(32),
  ADD COLUMN "appliedCouponPercent" INTEGER,
  ADD CONSTRAINT "Booking_appliedCouponId_fkey" FOREIGN KEY ("appliedCouponId")
    REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Booking_coupon_snapshot_check" CHECK (
    ("appliedCouponId" IS NULL AND "appliedCouponCode" IS NULL AND "appliedCouponPercent" IS NULL)
    OR ("appliedCouponId" IS NOT NULL AND "appliedCouponCode" IS NOT NULL
      AND "appliedCouponCode" COLLATE "C" ~ '^[A-Z0-9_-]{3,32}$'
      AND "appliedCouponPercent" IS NOT NULL AND "appliedCouponPercent" BETWEEN 1 AND 100
      AND "discountAmount" = round("subtotalAmount" * "appliedCouponPercent" / 100, 2))
  );

ALTER TABLE "PaymentAttempt"
  ADD COLUMN "appliedCouponId" UUID,
  ADD COLUMN "appliedCouponCode" VARCHAR(32),
  ADD COLUMN "appliedCouponPercent" INTEGER,
  ADD CONSTRAINT "PaymentAttempt_appliedCouponId_fkey" FOREIGN KEY ("appliedCouponId")
    REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "PaymentAttempt_coupon_snapshot_check" CHECK (
    ("appliedCouponId" IS NULL AND "appliedCouponCode" IS NULL AND "appliedCouponPercent" IS NULL)
    OR ("appliedCouponId" IS NOT NULL AND "appliedCouponCode" IS NOT NULL
      AND "appliedCouponCode" COLLATE "C" ~ '^[A-Z0-9_-]{3,32}$'
      AND "appliedCouponPercent" IS NOT NULL AND "appliedCouponPercent" BETWEEN 1 AND 100)
  );

-- Existing nonnegative + balance checks already imply discount <= subtotal and reject NaN.
-- Retain those checks and the existing provider range (20..150000 THB) and partial indexes.
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_payment_fields_check";
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_payment_fields_check" CHECK (
  ("paymentStatus" = 'unpaid' AND "mockReference" IS NULL
    AND "paymentReference" IS NULL AND "paidAt" IS NULL)
  OR ("paymentStatus" = 'paid' AND "paidAt" IS NOT NULL AND (
    ("mockReference" IS NOT NULL AND "mockReference" = BTRIM("mockReference")
      AND "mockReference" <> '' AND "paymentReference" IS NULL)
    OR ("mockReference" IS NULL AND "paymentReference" IS NOT NULL AND (
      "paymentReference" ~ '^chrg_test_[A-Za-z0-9]+$'
      OR ("paymentReference" ~ '^coupon:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND "netAmount" = 0 AND "appliedCouponId" IS NOT NULL AND "appliedCouponPercent" = 100)
    ))
  ))
);

CREATE FUNCTION "guard_booking_price_snapshot"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  price_changed BOOLEAN := true;
  coupon_changed BOOLEAN := true;
  source_code TEXT;
  source_percent INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    price_changed := ROW(NEW."subtotalAmount", NEW."discountAmount", NEW."netAmount", NEW."currency",
      NEW."appliedCouponId", NEW."appliedCouponCode", NEW."appliedCouponPercent") IS DISTINCT FROM
      ROW(OLD."subtotalAmount", OLD."discountAmount", OLD."netAmount", OLD."currency",
      OLD."appliedCouponId", OLD."appliedCouponCode", OLD."appliedCouponPercent");
    coupon_changed := ROW(NEW."appliedCouponId", NEW."appliedCouponCode", NEW."appliedCouponPercent")
      IS DISTINCT FROM ROW(OLD."appliedCouponId", OLD."appliedCouponCode", OLD."appliedCouponPercent");
    IF price_changed AND (OLD."paymentPending" OR OLD."paymentStatus" = 'paid'
      OR EXISTS (SELECT 1 FROM "PaymentAttempt" WHERE "bookingId" = OLD."id" AND "status" IN ('CREATING', 'PENDING'))
      OR EXISTS (SELECT 1 FROM "CouponReservation" WHERE "bookingId" = OLD."id" AND "status" = 'RESERVED')
      OR EXISTS (SELECT 1 FROM "CouponUse" WHERE "bookingId" = OLD."id")) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Payment pricing and coupon snapshot are frozen';
    END IF;
  END IF;
  -- Existing zero/discounted history remains readable and may change non-pricing fields.
  IF price_changed AND NEW."netAmount" = 0 AND
    (NEW."appliedCouponId" IS NULL OR NEW."appliedCouponPercent" IS DISTINCT FROM 100) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'New zero pricing requires a full coupon snapshot';
  END IF;
  IF coupon_changed AND NEW."appliedCouponId" IS NOT NULL THEN
    SELECT "code"::text, "percent" INTO source_code, source_percent FROM "Coupon"
      WHERE "id" = NEW."appliedCouponId" FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Applied coupon missing';
    END IF;
    IF NEW."appliedCouponCode" IS DISTINCT FROM source_code
      OR NEW."appliedCouponPercent" IS DISTINCT FROM source_percent THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Coupon snapshot must match at application';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "Booking_price_snapshot_guard" BEFORE INSERT OR UPDATE ON "Booking"
FOR EACH ROW EXECUTE FUNCTION "guard_booking_price_snapshot"();

CREATE FUNCTION "guard_attempt_price_snapshot"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  b "Booking"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW."bookingId", NEW."amount", NEW."currency", NEW."appliedCouponId",
      NEW."appliedCouponCode", NEW."appliedCouponPercent") IS DISTINCT FROM
      ROW(OLD."bookingId", OLD."amount", OLD."currency", OLD."appliedCouponId",
      OLD."appliedCouponCode", OLD."appliedCouponPercent") THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Provider attempt pricing is immutable';
    END IF;
  ELSE
    -- Forced write also makes stale repeatable-read writers fail instead of using old pricing.
    UPDATE "Booking" SET "id" = "id" WHERE "id" = NEW."bookingId" RETURNING * INTO b;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Booking missing';
    END IF;
    IF ROW(NEW."amount", NEW."currency", NEW."appliedCouponId", NEW."appliedCouponCode", NEW."appliedCouponPercent")
      IS DISTINCT FROM ROW(b."netAmount", b."currency", b."appliedCouponId", b."appliedCouponCode", b."appliedCouponPercent") THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Attempt must snapshot the booking price and coupon';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "PaymentAttempt_price_snapshot_guard" BEFORE INSERT OR UPDATE ON "PaymentAttempt"
FOR EACH ROW EXECUTE FUNCTION "guard_attempt_price_snapshot"();

-- DB02 already makes reservation identity/discount immutable and copies its amount into CouponUse.
-- Validate new snapshot-bearing claims; all-null legacy associations retain their DB02 contract.
CREATE FUNCTION "guard_reservation_price_snapshot"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  b "Booking"%ROWTYPE;
  a "PaymentAttempt"%ROWTYPE;
BEGIN
  SELECT * INTO b FROM "Booking" WHERE "id" = NEW."bookingId";
  IF b."appliedCouponId" IS NOT NULL THEN
    IF NEW."couponId" IS DISTINCT FROM b."appliedCouponId"
      OR NEW."discountAmount" IS DISTINCT FROM b."discountAmount" THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reservation must match the booking coupon discount';
    END IF;
    IF NEW."paymentAttemptId" IS NOT NULL THEN
      SELECT * INTO a FROM "PaymentAttempt" WHERE "id" = NEW."paymentAttemptId";
      IF ROW(a."bookingId", a."amount", a."currency", a."appliedCouponId", a."appliedCouponCode", a."appliedCouponPercent")
        IS DISTINCT FROM ROW(b."id", b."netAmount", b."currency", b."appliedCouponId", b."appliedCouponCode", b."appliedCouponPercent") THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reservation attempt snapshot does not match';
      END IF;
    ELSIF b."netAmount" <> 0 OR b."appliedCouponPercent" <> 100 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a full coupon can settle without an attempt';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "CouponReservation_price_snapshot_guard" BEFORE INSERT ON "CouponReservation"
FOR EACH ROW EXECUTE FUNCTION "guard_reservation_price_snapshot"();

-- Deferred so zero settlement may write Booking and DB02 consumption in either order, atomically.
CREATE FUNCTION "check_booking_coupon_receipt"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  b "Booking"%ROWTYPE;
BEGIN
  SELECT * INTO b FROM "Booking" WHERE "id" = NEW."id";
  IF b."paymentStatus" = 'paid' AND b."appliedCouponId" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "CouponUse" u WHERE u."bookingId" = b."id"
      AND u."studentUserId" = b."studentUserId" AND u."couponId" = b."appliedCouponId"
      AND u."discountAmount" = b."discountAmount"
      AND ((b."netAmount" = 0 AND b."paymentReference" = 'coupon:' || u."id"::text)
        OR (b."netAmount" > 0 AND EXISTS (SELECT 1 FROM "PaymentAttempt" a
          WHERE a."bookingId" = b."id" AND a."status" = 'SUCCESSFUL'
          AND a."chargeId" = b."paymentReference" AND a."amount" = b."netAmount"
          AND ROW(a."appliedCouponId", a."appliedCouponCode", a."appliedCouponPercent") =
            ROW(b."appliedCouponId", b."appliedCouponCode", b."appliedCouponPercent"))))) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Coupon payment requires matching consumption and receipt';
    END IF;
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER "Booking_coupon_receipt_check" AFTER INSERT OR UPDATE ON "Booking"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_booking_coupon_receipt"();

COMMIT;
