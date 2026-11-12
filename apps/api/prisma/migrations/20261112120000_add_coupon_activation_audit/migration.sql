BEGIN;

-- Preserve the original evidence contract; allow repeatable activation events keyed by audit ID.
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_operation_check";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_operation_check" CHECK (
  (
    "operationKey" = "action" || ':' || "entityId"::text
    AND (("action" = 'coupon.create' AND "entityType" = 'Coupon')
      OR ("action" IN ('coupon.reserve', 'coupon.consume', 'coupon.release') AND "entityType" = 'CouponReservation')))
  OR ("action" = 'coupon.active_change' AND "entityType" = 'Coupon'
    AND "actorUserId" IS NOT NULL AND "operationKey" = 'coupon.active_change:' || "id"::text)
);

ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_safe_json_check";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_safe_json_check" CHECK (
  ("action" <> 'coupon.active_change' AND (
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
    END IS TRUE))
  OR ("action" = 'coupon.active_change'
    AND "beforeData" IS NOT NULL AND "afterData" IS NOT NULL
    AND jsonb_typeof("beforeData") = 'object' AND jsonb_typeof("afterData") = 'object'
    AND "beforeData" ? 'active' AND "afterData" ? 'active'
    AND "beforeData" - 'active' = '{}'::jsonb AND "afterData" - 'active' = '{}'::jsonb
    AND jsonb_typeof("beforeData"->'active') = 'boolean'
    AND jsonb_typeof("afterData"->'active') = 'boolean'
    AND "beforeData"->'active' IS DISTINCT FROM "afterData"->'active')
);

COMMIT;
