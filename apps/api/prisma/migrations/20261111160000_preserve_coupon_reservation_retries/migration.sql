BEGIN;

-- The original DB03 migration is already applied. Preserve its checksum and correct the function
-- in a forward migration. DB02's earlier guard keeps the booking -> coupon lock order intact.
CREATE OR REPLACE FUNCTION "guard_reservation_price_snapshot"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  b "Booking"%ROWTYPE;
  a "PaymentAttempt"%ROWTYPE;
  existing_reservation "CouponReservation"%ROWTYPE;
BEGIN
  -- A released operation can outlive the booking price/coupon it originally reserved.
  -- Validate against that canonical operation before applying current-price rules to new claims.
  SELECT * INTO existing_reservation FROM "CouponReservation" WHERE "id" = NEW."id";
  IF FOUND THEN
    IF (to_jsonb(NEW) - ARRAY['status', 'createdAt', 'releasedAt', 'consumedAt']) IS DISTINCT FROM
       (to_jsonb(existing_reservation) - ARRAY['status', 'createdAt', 'releasedAt', 'consumedAt']) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reservation operation ID has different input';
    END IF;
    RETURN NEW;
  END IF;

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

COMMIT;
