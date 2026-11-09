BEGIN;

CREATE TYPE "CouponReservationStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');

CREATE TABLE "Coupon" (
  "id" UUID NOT NULL PRIMARY KEY,
  "code" extensions.CITEXT NOT NULL UNIQUE,
  "percent" INTEGER NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "maxUses" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Coupon_code_check" CHECK (
    CHAR_LENGTH("code"::text) >= 1
  ),
  CONSTRAINT "Coupon_percent_check" CHECK ("percent" BETWEEN 1 AND 100),
  CONSTRAINT "Coupon_maxUses_check" CHECK ("maxUses" >= 1)
);
CREATE INDEX "Coupon_createdAt_id_idx" ON "Coupon"("createdAt" DESC, "id" DESC);

CREATE UNIQUE INDEX "Booking_coupon_identity_key" ON "Booking"("id", "studentUserId");
CREATE UNIQUE INDEX "PaymentAttempt_coupon_identity_key" ON "PaymentAttempt"("id", "bookingId");

CREATE TABLE "CouponUse" (
  "id" UUID NOT NULL PRIMARY KEY,
  "couponId" UUID NOT NULL REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "bookingId" UUID NOT NULL UNIQUE,
  "studentUserId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "discountAmount" DECIMAL(10,2) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CouponUse_booking_identity_fkey" FOREIGN KEY ("bookingId", "studentUserId")
    REFERENCES "Booking"("id", "studentUserId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CouponUse_discountAmount_check" CHECK (
    "discountAmount" <> 'NaN'::numeric AND "discountAmount" >= 0
  ),
  CONSTRAINT "CouponUse_couponId_studentUserId_key" UNIQUE ("couponId", "studentUserId"),
  CONSTRAINT "CouponUse_booking_identity_key" UNIQUE ("bookingId", "studentUserId")
);
CREATE INDEX "CouponUse_studentUserId_idx" ON "CouponUse"("studentUserId");

CREATE TABLE "CouponReservation" (
  "id" UUID NOT NULL PRIMARY KEY,
  "couponId" UUID NOT NULL REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "bookingId" UUID NOT NULL,
  "studentUserId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "paymentAttemptId" UUID UNIQUE,
  "discountAmount" DECIMAL(10,2) NOT NULL,
  "status" "CouponReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMPTZ(3),
  "consumedAt" TIMESTAMPTZ(3),
  CONSTRAINT "CouponReservation_booking_identity_fkey" FOREIGN KEY ("bookingId", "studentUserId")
    REFERENCES "Booking"("id", "studentUserId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CouponReservation_attempt_identity_fkey" FOREIGN KEY ("paymentAttemptId", "bookingId")
    REFERENCES "PaymentAttempt"("id", "bookingId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CouponReservation_discountAmount_check" CHECK (
    "discountAmount" <> 'NaN'::numeric AND "discountAmount" >= 0
  ),
  CONSTRAINT "CouponReservation_state_check" CHECK (
    ("status" = 'RESERVED' AND "paymentAttemptId" IS NOT NULL AND "releasedAt" IS NULL AND "consumedAt" IS NULL)
    OR ("status" = 'CONSUMED' AND "releasedAt" IS NULL AND "consumedAt" >= "createdAt" AND "consumedAt" IS NOT NULL)
    OR ("status" = 'RELEASED' AND "paymentAttemptId" IS NOT NULL AND "consumedAt" IS NULL AND "releasedAt" >= "createdAt" AND "releasedAt" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "CouponReservation_attempt_identity_key" ON "CouponReservation"("paymentAttemptId", "bookingId");
CREATE UNIQUE INDEX "CouponReservation_student_claim_key"
  ON "CouponReservation"("couponId", "studentUserId") WHERE "status" IN ('RESERVED', 'CONSUMED');
CREATE UNIQUE INDEX "CouponReservation_active_booking_key"
  ON "CouponReservation"("bookingId") WHERE "status" = 'RESERVED';
CREATE INDEX "CouponReservation_couponId_status_idx" ON "CouponReservation"("couponId", "status");
CREATE INDEX "CouponReservation_bookingId_idx" ON "CouponReservation"("bookingId");
CREATE INDEX "CouponReservation_studentUserId_idx" ON "CouponReservation"("studentUserId");

CREATE TABLE "AuditLog" (
  "id" UUID NOT NULL PRIMARY KEY,
  "actorUserId" UUID REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "action" VARCHAR(40) NOT NULL,
  "entityType" VARCHAR(40) NOT NULL,
  "entityId" UUID NOT NULL,
  "beforeData" JSONB,
  "afterData" JSONB,
  "requestId" VARCHAR(100),
  "operationKey" VARCHAR(100) NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_operation_check" CHECK (
    "operationKey" = "action" || ':' || "entityId"::text
    AND (("action" = 'coupon.create' AND "entityType" = 'Coupon')
      OR ("action" IN ('coupon.reserve', 'coupon.consume', 'coupon.release') AND "entityType" = 'CouponReservation'))
  ),
  CONSTRAINT "AuditLog_requestId_check" CHECK (
    "requestId" IS NULL OR "requestId" COLLATE "C" ~ '^[A-Za-z0-9._:-]{1,100}$'
  ),
  -- Exact JSON shapes prevent callers from smuggling provider payloads, URLs or contact data.
  CONSTRAINT "AuditLog_safe_json_check" CHECK (
    "afterData" IS NOT NULL AND jsonb_typeof("afterData") = 'object' AND
    CASE WHEN "action" = 'coupon.create' THEN
      "beforeData" IS NULL
      AND "afterData" ?& ARRAY['percent', 'maxUses', 'active']
      AND "afterData" - ARRAY['percent', 'maxUses', 'active'] = '{}'::jsonb
      AND jsonb_typeof("afterData"->'percent') = 'number'
      AND ("afterData"->>'percent')::numeric BETWEEN 1 AND 100
      AND ("afterData"->>'percent')::numeric = trunc(("afterData"->>'percent')::numeric)
      AND jsonb_typeof("afterData"->'maxUses') = 'number'
      AND ("afterData"->>'maxUses')::numeric BETWEEN 1 AND 2147483647
      AND ("afterData"->>'maxUses')::numeric = trunc(("afterData"->>'maxUses')::numeric)
      AND jsonb_typeof("afterData"->'active') = 'boolean'
    ELSE
      "afterData" ?& ARRAY['status', 'discountAmount']
      AND "afterData" - ARRAY['status', 'discountAmount'] = '{}'::jsonb
      AND "afterData"->>'status' = CASE "action"
        WHEN 'coupon.reserve' THEN 'RESERVED' WHEN 'coupon.consume' THEN 'CONSUMED' ELSE 'RELEASED' END
      AND jsonb_typeof("afterData"->'discountAmount') = 'number'
      AND ("afterData"->>'discountAmount')::numeric BETWEEN 0 AND 99999999.99
      AND ("afterData"->>'discountAmount')::numeric = round(("afterData"->>'discountAmount')::numeric, 2)
      AND ("beforeData" IS NULL OR "beforeData" = '{"status":"RESERVED"}'::jsonb)
    END IS TRUE
  )
);
CREATE INDEX "AuditLog_entity_time_idx" ON "AuditLog"("entityType", "entityId", "createdAt", "id");
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- One canonical spelling even for direct SQL writers. CITEXT also enforces case-insensitive uniqueness.
CREATE FUNCTION "normalize_coupon_code"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW."code" := upper(btrim(NEW."code"::text, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'));
  RETURN NEW;
END
$$;
CREATE TRIGGER "Coupon_normalize_code" BEFORE INSERT OR UPDATE OF "code" ON "Coupon"
FOR EACH ROW EXECUTE FUNCTION "normalize_coupon_code"();

CREATE FUNCTION "prevent_coupon_evidence_mutation"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Coupon evidence is append-only';
END
$$;
CREATE TRIGGER "CouponUse_append_only" BEFORE UPDATE OR DELETE ON "CouponUse"
FOR EACH ROW EXECUTE FUNCTION "prevent_coupon_evidence_mutation"();
CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION "prevent_coupon_evidence_mutation"();
CREATE TRIGGER "CouponReservation_no_delete" BEFORE DELETE ON "CouponReservation"
FOR EACH ROW EXECUTE FUNCTION "prevent_coupon_evidence_mutation"();
CREATE TRIGGER "Coupon_no_delete" BEFORE DELETE ON "Coupon"
FOR EACH ROW EXECUTE FUNCTION "prevent_coupon_evidence_mutation"();

-- A no-op UPDATE, rather than only SELECT FOR UPDATE, invalidates stale repeatable-read snapshots.
-- Every reservation writer uses booking -> coupon order. Batch callers must order booking IDs.
CREATE FUNCTION "guard_coupon_reservation"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  capacity INTEGER;
  used_count BIGINT;
  reserved_count BIGINT;
  booking_net NUMERIC;
  attempt_status "PaymentAttemptStatus";
  existing_reservation "CouponReservation"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['status', 'releasedAt', 'consumedAt']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status', 'releasedAt', 'consumedAt']) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reservation identity and snapshot are immutable';
    END IF;
    IF NEW."status" = OLD."status" THEN
      IF NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reservation retry must preserve timestamps';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD."status" <> 'RESERVED' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Terminal reservation cannot transition';
    END IF;
  ELSIF NEW."status" = 'RELEASED' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reservation cannot start released';
  END IF;

  UPDATE "Booking" SET "id" = "id" WHERE "id" = NEW."bookingId" RETURNING "netAmount" INTO booking_net;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Booking missing';
  END IF;
  UPDATE "Coupon" SET "id" = "id" WHERE "id" = NEW."couponId" RETURNING "maxUses" INTO capacity;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Coupon missing';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    UPDATE "PaymentAttempt" SET "id" = "id" WHERE "id" = NEW."paymentAttemptId" RETURNING "status" INTO attempt_status;
    IF (NEW."status" = 'CONSUMED' AND attempt_status IS DISTINCT FROM 'SUCCESSFUL'::"PaymentAttemptStatus")
      OR (NEW."status" = 'RELEASED' AND (attempt_status IS NULL OR attempt_status NOT IN ('FAILED', 'EXPIRED'))) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reservation transition requires provider terminal evidence';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Replaying a stable operation ID may use INSERT ... ON CONFLICT(id) DO NOTHING.
    -- Check after locking so a concurrent replay sees the winner at READ COMMITTED.
    SELECT * INTO existing_reservation FROM "CouponReservation" WHERE "id" = NEW."id";
    IF FOUND THEN
      IF (to_jsonb(NEW) - ARRAY['status', 'createdAt', 'releasedAt', 'consumedAt']) IS DISTINCT FROM
         (to_jsonb(existing_reservation) - ARRAY['status', 'createdAt', 'releasedAt', 'consumedAt']) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reservation operation ID has different input';
      END IF;
      RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM "CouponUse" WHERE "bookingId" = NEW."bookingId") THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Booking already consumed a coupon';
    END IF;
    -- The partial booking index covers RESERVED; include a zero settlement racing a reservation.
    IF EXISTS (SELECT 1 FROM "CouponReservation" WHERE "bookingId" = NEW."bookingId" AND "status" = 'RESERVED') THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Booking already reserved a coupon';
    END IF;
    IF NEW."status" = 'CONSUMED' AND (NEW."paymentAttemptId" IS NOT NULL OR booking_net <> 0) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Immediate consumption requires a zero settlement without an attempt';
    END IF;
    SELECT count(*) INTO used_count FROM "CouponUse" WHERE "couponId" = NEW."couponId";
    SELECT count(*) INTO reserved_count FROM "CouponReservation" WHERE "couponId" = NEW."couponId" AND "status" = 'RESERVED';
    IF used_count + reserved_count + 1 > capacity THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'Coupon_capacity_check', MESSAGE = 'Coupon capacity exhausted';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "CouponReservation_guard" BEFORE INSERT OR UPDATE ON "CouponReservation"
FOR EACH ROW EXECUTE FUNCTION "guard_coupon_reservation"();

-- Reducing maxUses is serialized by the same coupon row and cannot invalidate existing claims.
CREATE FUNCTION "guard_coupon_capacity"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  claimed BIGINT;
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Coupon identity is immutable';
  END IF;
  SELECT (SELECT count(*) FROM "CouponUse" WHERE "couponId" = OLD."id") +
    (SELECT count(*) FROM "CouponReservation" WHERE "couponId" = OLD."id" AND "status" = 'RESERVED') INTO claimed;
  IF claimed < 0 OR claimed > NEW."maxUses" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'Coupon_capacity_check', MESSAGE = 'Coupon capacity below claims';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "Coupon_capacity_guard" BEFORE UPDATE ON "Coupon"
FOR EACH ROW EXECUTE FUNCTION "guard_coupon_capacity"();

-- CouponUse must be the exact evidence generated from the canonical CONSUMED reservation.
-- Its id is the reservation id, preventing a second evidence row for the same settlement.
CREATE FUNCTION "guard_coupon_use"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CouponReservation" r WHERE r."id" = NEW."id"
    AND r."status" = 'CONSUMED' AND r."couponId" = NEW."couponId"
    AND r."bookingId" = NEW."bookingId" AND r."studentUserId" = NEW."studentUserId"
    AND r."discountAmount" = NEW."discountAmount" AND r."consumedAt" = NEW."consumedAt") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CouponUse requires canonical consumed reservation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "CouponUse_guard" BEFORE INSERT ON "CouponUse"
FOR EACH ROW EXECUTE FUNCTION "guard_coupon_use"();

CREATE FUNCTION "write_coupon_evidence"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  event_action TEXT;
  before_data JSONB;
  after_data JSONB;
BEGIN
  IF TG_TABLE_NAME = 'Coupon' THEN
    event_action := 'coupon.create';
    after_data := jsonb_build_object('percent', NEW."percent", 'maxUses', NEW."maxUses", 'active', NEW."active");
  ELSE
    IF TG_OP = 'UPDATE' THEN
      IF OLD."status" = NEW."status" THEN
        RETURN NEW;
      END IF;
      before_data := jsonb_build_object('status', OLD."status");
    END IF;
    event_action := CASE NEW."status" WHEN 'RESERVED' THEN 'coupon.reserve'
      WHEN 'CONSUMED' THEN 'coupon.consume' ELSE 'coupon.release' END;
    after_data := jsonb_build_object('status', NEW."status", 'discountAmount', NEW."discountAmount");
    IF NEW."status" = 'CONSUMED' THEN
      INSERT INTO "CouponUse" ("id", "couponId", "bookingId", "studentUserId", "discountAmount", "consumedAt")
      VALUES (NEW."id", NEW."couponId", NEW."bookingId", NEW."studentUserId", NEW."discountAmount", NEW."consumedAt");
    END IF;
  END IF;
  INSERT INTO "AuditLog" ("id", "actorUserId", "action", "entityType", "entityId", "beforeData", "afterData", "requestId", "operationKey")
  VALUES (gen_random_uuid(), nullif(current_setting('hktutor.audit_actor_user_id', true), '')::uuid,
    event_action, TG_TABLE_NAME, NEW."id", before_data, after_data,
    nullif(current_setting('hktutor.audit_request_id', true), ''), event_action || ':' || NEW."id"::text);
  RETURN NEW;
END
$$;
CREATE TRIGGER "Coupon_create_evidence" AFTER INSERT ON "Coupon"
FOR EACH ROW EXECUTE FUNCTION "write_coupon_evidence"();
CREATE TRIGGER "CouponReservation_evidence" AFTER INSERT OR UPDATE ON "CouponReservation"
FOR EACH ROW EXECUTE FUNCTION "write_coupon_evidence"();

-- Truncation must not erase evidence or detach usage from capacity.
DO $$
DECLARE
  table_name TEXT;
  client_role TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Coupon', 'CouponUse', 'CouponReservation', 'AuditLog'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION "prevent_coupon_evidence_mutation"()', table_name || '_no_truncate', table_name);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', table_name);
    FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, client_role);
    END LOOP;
  END LOOP;
END
$$;

COMMIT;
