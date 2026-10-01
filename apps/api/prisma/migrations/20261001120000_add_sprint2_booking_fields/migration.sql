CREATE TYPE "PaymentStatus" AS ENUM ('unpaid', 'paid');

CREATE TYPE "AttendanceStatus" AS ENUM ('attended', 'absent');

ALTER TABLE "Booking"
ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'unpaid',
ADD COLUMN "mockReference" TEXT,
ADD COLUMN "paidAt" TIMESTAMPTZ(3),
ADD COLUMN "meetingUrl" TEXT,
ADD COLUMN "attendance" "AttendanceStatus",
ADD COLUMN "attendanceMarkedAt" TIMESTAMPTZ(3),
ADD COLUMN "canceledById" UUID,
ADD COLUMN "cancellationReason" TEXT,
ADD COLUMN "canceledAt" TIMESTAMPTZ(3);

ALTER TABLE "Booking"
ADD CONSTRAINT "Booking_canceledById_fkey"
FOREIGN KEY ("canceledById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Booking_mockReference_key"
ON "Booking"("mockReference");

ALTER TABLE "Booking"
ADD CONSTRAINT "Booking_payment_fields_check" CHECK (
    (
        "paymentStatus" = 'unpaid'
        AND "mockReference" IS NULL
        AND "paidAt" IS NULL
    )
    OR
    (
        "paymentStatus" = 'paid'
        AND "mockReference" IS NOT NULL
        AND "mockReference" = BTRIM("mockReference")
        AND "mockReference" <> ''
        AND "paidAt" IS NOT NULL
    )
),
ADD CONSTRAINT "Booking_paid_status_check" CHECK (
    "paymentStatus" <> 'paid'
    OR "status" IN ('confirmed', 'completed')
),
ADD CONSTRAINT "Booking_cancellation_fields_check" CHECK (
    (
        "status" = 'canceled'
        AND "canceledById" IS NOT NULL
        AND "cancellationReason" IS NOT NULL
        AND "cancellationReason" = BTRIM("cancellationReason")
        AND "cancellationReason" <> ''
        AND "canceledAt" IS NOT NULL
    )
    OR
    (
        "status" <> 'canceled'
        AND "canceledById" IS NULL
        AND "cancellationReason" IS NULL
        AND "canceledAt" IS NULL
    )
),
ADD CONSTRAINT "Booking_meeting_url_https_check" CHECK (
    "meetingUrl" IS NULL
    OR (
        "meetingUrl" = BTRIM("meetingUrl")
        AND "meetingUrl" ~* '^https://[^[:space:]/?#]+([/?#].*)?$'
    )
),
ADD CONSTRAINT "Booking_attendance_fields_check" CHECK (
    (
        "attendance" IS NULL
        AND "attendanceMarkedAt" IS NULL
    )
    OR
    (
        "attendance" IS NOT NULL
        AND "attendanceMarkedAt" IS NOT NULL
        AND "status" = 'completed'
    )
);
