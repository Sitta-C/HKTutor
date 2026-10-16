BEGIN;

CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "bookingId" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Notification_event_key_check" CHECK (
        "eventKey" = BTRIM("eventKey") AND "eventKey" ~ '[^[:space:]]'
    ),
    CONSTRAINT "Notification_event_type_check" CHECK (
        "eventType" = BTRIM("eventType") AND "eventType" ~ '[^[:space:]]'
    ),
    CONSTRAINT "Notification_title_check" CHECK ("title" ~ '[^[:space:]]'),
    CONSTRAINT "Notification_body_check" CHECK ("body" ~ '[^[:space:]]'),
    CONSTRAINT "Notification_read_time_check" CHECK (
        "readAt" IS NULL OR "readAt" >= "createdAt"
    )
);

-- De-duplicate the same domain event per recipient, including concurrent retries.
CREATE UNIQUE INDEX "Notification_userId_eventKey_key"
ON "Notification"("userId", "eventKey");

-- All/read-filtered inboxes need separate indexes to retain createdAt/id cursor order.
CREATE INDEX "Notification_userId_createdAt_id_idx"
ON "Notification"("userId", "createdAt", "id");
CREATE INDEX "Notification_userId_readAt_createdAt_id_idx"
ON "Notification"("userId", "readAt", "createdAt", "id");
CREATE INDEX "Notification_bookingId_idx" ON "Notification"("bookingId");

ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "Notification_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Application-owned JWTs do not authorize direct Supabase table access.
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Notification" FROM PUBLIC;
DO $$
DECLARE
    client_role TEXT;
BEGIN
    FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
        EXECUTE format('REVOKE ALL ON TABLE "Notification" FROM %I', client_role);
    END LOOP;
END
$$;

COMMIT;
