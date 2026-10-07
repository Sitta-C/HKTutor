import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { Role } from '@generated/prisma/enums';
import { JWT_BEARER_AUTH } from '@modules/auth/auth.swagger';
import {
  CreateConversationDto,
  GetMyConversationsQueryDto,
  MessageResponseDto,
  MyConversationsResponseDto,
  OpenConversationResponseDto,
  SendMessageDto,
} from '@modules/conversations/conversations.dto';

const CONVERSATION_ID_EXAMPLE = '6f1c2b8e-3d4a-4f5b-9c7d-2e8a1b0c9d3f';
const STUDENT_ID_EXAMPLE = '2c9d7e1f-4a3b-4c5d-8e6f-7a8b9c0d1e2f';
const TUTOR_ID_EXAMPLE = 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc';
const MESSAGE_ID_EXAMPLE = 'b7e4c1a2-5f6d-4e8b-9a0c-3d2f1e4b5a69';

const lastMessageExample = {
  messageId: MESSAGE_ID_EXAMPLE,
  senderId: STUDENT_ID_EXAMPLE,
  sentAt: '2026-09-30T08:05:00.000Z',
  text: 'Do you teach quadratic equations?',
};

const openConversationExample = {
  conversationId: CONVERSATION_ID_EXAMPLE,
  createdAt: '2026-09-30T08:00:00.000Z',
  participants: [
    { role: Role.STUDENT, userId: STUDENT_ID_EXAMPLE },
    { role: Role.TUTOR, userId: TUTOR_ID_EXAMPLE },
  ],
};

const conversationSummaryExample = {
  conversationId: CONVERSATION_ID_EXAMPLE,
  createdAt: '2026-09-30T08:00:00.000Z',
  lastMessage: lastMessageExample,
  otherParticipant: { displayName: 'Anan Suksawat', userId: TUTOR_ID_EXAMPLE },
};

/** The body ApiExceptionFilter sends for an HTTP error. */
interface ErrorExample {
  code: string;
  error: string;
  message: string | string[];
  statusCode: number;
}

function errorSchema(example: ErrorExample) {
  return { example, type: 'object' };
}

function apiUnauthorizedResponse(): MethodDecorator {
  return ApiUnauthorizedResponse({
    description: 'The access token or its backing session is missing, invalid, expired, or revoked',
    schema: errorSchema({
      code: 'UNAUTHENTICATED',
      error: 'Unauthorized',
      message: 'Invalid or expired authentication token',
      statusCode: 401,
    }),
  });
}

export function ConversationsControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('conversations'));
}

export function OpenConversationDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(CreateConversationDto, OpenConversationResponseDto),
    ApiOperation({
      description:
        "A student sends tutorId and a tutor sends participantId with the student's user ID. The caller comes from the access token.",
      summary: 'Open a conversation between a student and a tutor',
    }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiCreatedResponse({
      description: 'A new conversation was created between the student and the tutor',
      schema: {
        allOf: [{ $ref: getSchemaPath(OpenConversationResponseDto) }],
        example: openConversationExample,
        type: 'object',
      },
    }),
    ApiOkResponse({
      description: 'The student and the tutor already have a conversation, so it is returned',
      schema: {
        allOf: [{ $ref: getSchemaPath(OpenConversationResponseDto) }],
        example: openConversationExample,
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description:
        "The body does not have exactly the caller's key (tutorId for a student, participantId for a tutor), an ID is not a UUID, the target is the caller, or the body contained an unknown field",
      schema: errorSchema({
        code: 'VALIDATION_FAILED',
        error: 'Bad Request',
        message: 'You cannot start a conversation with yourself.',
        statusCode: 400,
      }),
    }),
    apiUnauthorizedResponse(),
    ApiForbiddenResponse({
      description:
        'The caller is an admin, a student who is not active or has no profile, or a tutor who is not verified',
      schema: errorSchema({
        code: 'FORBIDDEN',
        error: 'Forbidden',
        message: 'Only verified tutors can start conversations.',
        statusCode: 403,
      }),
    }),
    ApiNotFoundResponse({
      description:
        'The tutor is not verified, active, and undeleted, or the student is not an active student with a profile',
      schema: errorSchema({
        code: 'NOT_FOUND',
        error: 'Not Found',
        message: 'Tutor not found',
        statusCode: 404,
      }),
    }),
  );
}

export function GetMyConversationsDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(GetMyConversationsQueryDto, MyConversationsResponseDto),
    ApiOperation({ summary: 'List my conversations' }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiOkResponse({
      description:
        "The caller's conversations, most recent activity first, with the other participant and the latest message",
      schema: {
        allOf: [{ $ref: getSchemaPath(MyConversationsResponseDto) }],
        example: { items: [conversationSummaryExample], total: 1 },
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description: 'page or pageSize failed validation',
      schema: errorSchema({
        code: 'VALIDATION_FAILED',
        error: 'Bad Request',
        message: ['pageSize must not be greater than 100'],
        statusCode: 400,
      }),
    }),
    apiUnauthorizedResponse(),
    ApiForbiddenResponse({
      description: 'The caller is not a student or a tutor',
      schema: errorSchema({
        code: 'FORBIDDEN',
        error: 'Forbidden',
        message: 'You do not have permission to access this resource',
        statusCode: 403,
      }),
    }),
  );
}

export function SendMessageDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(SendMessageDto, MessageResponseDto),
    ApiOperation({ summary: 'Send a message in a conversation' }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiCreatedResponse({
      description: 'The message was stored',
      schema: {
        allOf: [{ $ref: getSchemaPath(MessageResponseDto) }],
        example: { ...lastMessageExample, conversationId: CONVERSATION_ID_EXAMPLE, readAt: null },
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description:
        'The text is blank or longer than 2000 characters, conversationId is not a UUID, or the request body contained an unknown field',
      schema: errorSchema({
        code: 'VALIDATION_FAILED',
        error: 'Bad Request',
        message: ['text should not be empty'],
        statusCode: 400,
      }),
    }),
    apiUnauthorizedResponse(),
    ApiForbiddenResponse({
      description: 'The caller is not a participant in the conversation',
      schema: errorSchema({
        code: 'FORBIDDEN',
        error: 'Forbidden',
        message: 'Only participants can send messages in this conversation.',
        statusCode: 403,
      }),
    }),
    ApiNotFoundResponse({
      description: 'The conversation does not exist',
      schema: errorSchema({
        code: 'NOT_FOUND',
        error: 'Not Found',
        message: 'Conversation not found',
        statusCode: 404,
      }),
    }),
  );
}
