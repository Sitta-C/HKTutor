ALTER TYPE "BookingStatus" ADD VALUE 'expired';

CREATE INDEX "Booking_pending_createdAt_idx"
ON "Booking"("createdAt")
WHERE "status" = 'pending';
