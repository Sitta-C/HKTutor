CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATING', 'PENDING', 'SUCCESSFUL', 'FAILED', 'EXPIRED');

ALTER TABLE "Booking"
ADD COLUMN "paymentReference" TEXT,
ADD COLUMN "paymentPending" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Booking_paymentReference_key" ON "Booking"("paymentReference");

ALTER TABLE "Booking" DROP CONSTRAINT "Booking_payment_fields_check";
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_payment_fields_check" CHECK (
  ("paymentStatus" = 'unpaid' AND "mockReference" IS NULL
    AND "paymentReference" IS NULL AND "paidAt" IS NULL)
  OR
  ("paymentStatus" = 'paid' AND "paidAt" IS NOT NULL AND (
    ("mockReference" IS NOT NULL AND "mockReference" = BTRIM("mockReference")
      AND "mockReference" <> '' AND "paymentReference" IS NULL)
    OR
    ("mockReference" IS NULL AND "paymentReference" IS NOT NULL
      AND "paymentReference" ~ '^chrg_test_[A-Za-z0-9]+$')
  ))
);
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_payment_pending_check" CHECK (
  NOT "paymentPending" OR ("paymentStatus" = 'unpaid' AND "status" = 'confirmed')
);

CREATE TABLE "PaymentAttempt" (
  "id" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATING',
  "chargeId" TEXT,
  "qrCodeUrl" TEXT,
  "expiresAt" TIMESTAMPTZ(3),
  "paidAt" TIMESTAMPTZ(3),
  "failureCode" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentAttempt_bookingId_fkey" FOREIGN KEY ("bookingId")
    REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentAttempt_amount_check" CHECK ("amount" >= 20 AND "amount" <= 150000 AND "currency" = 'THB'),
  CONSTRAINT "PaymentAttempt_charge_check" CHECK (
    ("status" = 'CREATING' AND "chargeId" IS NULL)
    OR ("status" <> 'CREATING' AND "chargeId" IS NOT NULL AND "chargeId" ~ '^chrg_test_[A-Za-z0-9]+$')
    OR ("status" = 'FAILED' AND "chargeId" IS NULL)
  ),
  CONSTRAINT "PaymentAttempt_paid_check" CHECK (("status" = 'SUCCESSFUL') = ("paidAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "PaymentAttempt_chargeId_key" ON "PaymentAttempt"("chargeId");
CREATE INDEX "PaymentAttempt_bookingId_createdAt_idx" ON "PaymentAttempt"("bookingId", "createdAt");
CREATE UNIQUE INDEX "PaymentAttempt_one_active_per_booking" ON "PaymentAttempt"("bookingId")
  WHERE "status" IN ('CREATING', 'PENDING');
CREATE UNIQUE INDEX "PaymentAttempt_one_success_per_booking" ON "PaymentAttempt"("bookingId")
  WHERE "status" = 'SUCCESSFUL';
