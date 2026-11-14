BEGIN;

-- Extend the audit allow-list without changing existing coupon or payment evidence.
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_operation_check";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_operation_check" CHECK (
  (
    "operationKey" = "action" || ':' || "entityId"::text
    AND (("action" = 'coupon.create' AND "entityType" = 'Coupon')
      OR ("action" IN ('coupon.reserve', 'coupon.consume', 'coupon.release') AND "entityType" = 'CouponReservation')))
  OR ("action" IN ('coupon.active_change', 'coupon.capacity_increase') AND "entityType" = 'Coupon'
    AND "actorUserId" IS NOT NULL AND "operationKey" = "action" || ':' || "id"::text)
);

ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_safe_json_check";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_safe_json_check" CHECK (
  ("action" NOT IN ('coupon.active_change', 'coupon.capacity_increase') AND (
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
  OR ("action" = 'coupon.capacity_increase'
    AND "beforeData" IS NOT NULL AND "afterData" IS NOT NULL
    AND jsonb_typeof("beforeData") = 'object' AND jsonb_typeof("afterData") = 'object'
    AND "beforeData" ? 'maxUses' AND "afterData" ? 'maxUses'
    AND "beforeData" - 'maxUses' = '{}'::jsonb AND "afterData" - 'maxUses' = '{}'::jsonb
    AND jsonb_typeof("beforeData"->'maxUses') = 'number'
    AND jsonb_typeof("afterData"->'maxUses') = 'number'
    AND ("beforeData"->>'maxUses')::numeric BETWEEN 1 AND 2147483647
    AND ("afterData"->>'maxUses')::numeric BETWEEN 1 AND 2147483647
    AND ("beforeData"->>'maxUses')::numeric = trunc(("beforeData"->>'maxUses')::numeric)
    AND ("afterData"->>'maxUses')::numeric = trunc(("afterData"->>'maxUses')::numeric)
    AND ("afterData"->>'maxUses')::numeric > ("beforeData"->>'maxUses')::numeric)
);

COMMIT;
