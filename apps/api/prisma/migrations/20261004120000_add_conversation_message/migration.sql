CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "studentUserId" UUID NOT NULL,
    "tutorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Conversation_distinct_participants_check" CHECK (
        "studentUserId" <> "tutorUserId"
    )
);

CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderUserId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "clientMessageId" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Message_text_check" CHECK (
        "text" = BTRIM("text")
        AND CHAR_LENGTH("text") BETWEEN 1 AND 2000
    ),
    CONSTRAINT "Message_client_message_id_check" CHECK (
        "clientMessageId" = BTRIM("clientMessageId")
        AND "clientMessageId" <> ''
    ),
    CONSTRAINT "Message_read_time_check" CHECK (
        "readAt" IS NULL OR "readAt" >= "sentAt"
    )
);

CREATE UNIQUE INDEX "Conversation_studentUserId_tutorUserId_key"
ON "Conversation"("studentUserId", "tutorUserId");

CREATE INDEX "Conversation_studentUserId_createdAt_id_idx"
ON "Conversation"("studentUserId", "createdAt", "id");

CREATE INDEX "Conversation_tutorUserId_createdAt_id_idx"
ON "Conversation"("tutorUserId", "createdAt", "id");

CREATE UNIQUE INDEX "Message_senderUserId_clientMessageId_key"
ON "Message"("senderUserId", "clientMessageId");

CREATE INDEX "Message_conversationId_id_idx"
ON "Message"("conversationId", "id");

CREATE INDEX "Message_conversationId_sentAt_id_idx"
ON "Message"("conversationId", "sentAt", "id");

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_studentUserId_fkey"
FOREIGN KEY ("studentUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "Conversation_tutorUserId_fkey"
FOREIGN KEY ("tutorUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Message"
ADD CONSTRAINT "Message_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "Message_senderUserId_fkey"
FOREIGN KEY ("senderUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_conversation_participants"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    student_role "Role";
    tutor_role "Role";
BEGIN
    IF TG_OP = 'UPDATE'
        AND (
            NEW."studentUserId" IS DISTINCT FROM OLD."studentUserId"
            OR NEW."tutorUserId" IS DISTINCT FROM OLD."tutorUserId"
        ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Conversation participants are immutable',
            CONSTRAINT = 'Conversation_participants_immutable_check';
    END IF;

    SELECT "role"
    INTO student_role
    FROM "User"
    WHERE "id" = NEW."studentUserId";

    IF student_role IS DISTINCT FROM 'student' THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Conversation studentUserId must belong to a student',
            CONSTRAINT = 'Conversation_student_role_check';
    END IF;

    SELECT "role"
    INTO tutor_role
    FROM "User"
    WHERE "id" = NEW."tutorUserId";

    IF tutor_role IS DISTINCT FROM 'tutor' THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Conversation tutorUserId must belong to a tutor',
            CONSTRAINT = 'Conversation_tutor_role_check';
    END IF;

    RETURN NEW;
END
$$;

CREATE TRIGGER "Conversation_validate_participants"
BEFORE INSERT OR UPDATE ON "Conversation"
FOR EACH ROW
EXECUTE FUNCTION "validate_conversation_participants"();

CREATE FUNCTION "validate_message_sender"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    conversation_student_user_id UUID;
    conversation_tutor_user_id UUID;
BEGIN
    SELECT "studentUserId", "tutorUserId"
    INTO conversation_student_user_id, conversation_tutor_user_id
    FROM "Conversation"
    WHERE "id" = NEW."conversationId";

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF NEW."senderUserId" <> conversation_student_user_id
        AND NEW."senderUserId" <> conversation_tutor_user_id THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Message senderUserId must be a conversation participant',
            CONSTRAINT = 'Message_sender_participant_check';
    END IF;

    IF TG_OP = 'UPDATE'
        AND (
            NEW."conversationId" IS DISTINCT FROM OLD."conversationId"
            OR NEW."senderUserId" IS DISTINCT FROM OLD."senderUserId"
            OR NEW."clientMessageId" IS DISTINCT FROM OLD."clientMessageId"
            OR NEW."sentAt" IS DISTINCT FROM OLD."sentAt"
        ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Message identity fields are immutable',
            CONSTRAINT = 'Message_identity_immutable_check';
    END IF;

    RETURN NEW;
END
$$;

CREATE TRIGGER "Message_validate_sender"
BEFORE INSERT OR UPDATE ON "Message"
FOR EACH ROW
EXECUTE FUNCTION "validate_message_sender"();
