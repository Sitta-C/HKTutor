import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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

import { JWT_BEARER_AUTH } from '@modules/auth/auth.swagger';
import {
  ConversationSummaryDto,
  CreateConversationDto,
  GetMyConversationsQueryDto,
  MessageResponseDto,
  MyConversationsResponseDto,
  SendMessageDto,
} from '@modules/conversations/conversations.dto';

const CONVERSATION_ID_EXAMPLE = '6f1c2b8e-3d4a-4f5b-9c7d-2e8a1b0c9d3f';
const STUDENT_ID_EXAMPLE = '2c9d7e1f-4a3b-4c5d-8e6f-7a8b9c0d1e2f';
const TUTOR_ID_EXAMPLE = 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc';
const MESSAGE_ID_EXAMPLE = 'b7e4c1a2-5f6d-4e8b-9a0c-3d2f1e4b5a69';

const lastMessageExample = {
  body: 'Do you teach quadratic equations?',
  createdAt: '2026-09-30T08:05:00.000Z',
  id: MESSAGE_ID_EXAMPLE,
  senderUserId: STUDENT_ID_EXAMPLE,
};

const conversationSummaryExample = {
  createdAt: '2026-09-30T08:00:00.000Z',
  id: CONVERSATION_ID_EXAMPLE,
  lastMessage: lastMessageExample,
  otherParticipant: { displayName: 'Anan Suksawat', id: TUTOR_ID_EXAMPLE },
};

function errorSchema(error: string, message: string | string[], statusCode: number) {
  return { example: { error, message, statusCode }, type: 'object' };
}

function apiUnauthorizedResponse(): MethodDecorator {
  return ApiUnauthorizedResponse({
    description: 'The access token or its backing session is missing, invalid, expired, or revoked',
    schema: errorSchema('Unauthorized', 'Invalid or expired authentication token', 401),
  });
}

export function ConversationsControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('conversations'));
}

export function OpenConversationDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(CreateConversationDto, ConversationSummaryDto),
    ApiOperation({ summary: 'Open a conversation with a tutor' }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiCreatedResponse({
      description: 'A new conversation was created between the student and the tutor',
      schema: {
        allOf: [{ $ref: getSchemaPath(ConversationSummaryDto) }],
        example: { ...conversationSummaryExample, lastMessage: null },
        type: 'object',
      },
    }),
    ApiOkResponse({
      description:
        'The student already has a conversation with this tutor, so it is returned with its latest message',
      schema: {
        allOf: [{ $ref: getSchemaPath(ConversationSummaryDto) }],
        example: conversationSummaryExample,
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description: 'tutorId failed validation or the body contained an unknown field',
      schema: errorSchema('Bad Request', ['tutorId must be a UUID'], 400),
    }),
    apiUnauthorizedResponse(),
    ApiForbiddenResponse({
      description:
        'The caller is not an active student, or has not completed their student profile',
      schema: errorSchema(
        'Forbidden',
        'Students must complete their profile before starting a conversation.',
        403,
      ),
    }),
    ApiNotFoundResponse({
      description: 'The tutor does not exist or is not verified, active, and undeleted',
      schema: errorSchema('Not Found', 'Tutor not found', 404),
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
      schema: errorSchema('Bad Request', ['pageSize must not be greater than 100'], 400),
    }),
    apiUnauthorizedResponse(),
    ApiForbiddenResponse({
      description: 'The caller is not a student or a tutor',
      schema: errorSchema('Forbidden', 'You do not have permission to access this resource', 403),
    }),
  );
}

export function SendMessageDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(SendMessageDto, MessageResponseDto),
    ApiOperation({ summary: 'Send a message in a conversation' }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiCreatedResponse({
      description:
        'The message was stored; resending the same clientMessageId returns the original message',
      schema: {
        allOf: [{ $ref: getSchemaPath(MessageResponseDto) }],
        example: {
          ...lastMessageExample,
          clientMessageId: '0f8fad5b-d9cb-469f-a165-70867728950e',
          conversationId: CONVERSATION_ID_EXAMPLE,
          readAt: null,
        },
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description:
        'The body is blank or longer than 2000 characters, clientMessageId or conversationId is not a UUID, or the body contained an unknown field',
      schema: errorSchema('Bad Request', ['body should not be empty'], 400),
    }),
    apiUnauthorizedResponse(),
    ApiForbiddenResponse({
      description: 'The caller is not a participant in the conversation',
      schema: errorSchema(
        'Forbidden',
        'Only participants can send messages in this conversation.',
        403,
      ),
    }),
    ApiNotFoundResponse({
      description: 'The conversation does not exist',
      schema: errorSchema('Not Found', 'Conversation not found', 404),
    }),
    ApiConflictResponse({
      description: 'clientMessageId was already used for a message in another conversation',
      schema: errorSchema(
        'Conflict',
        'clientMessageId was already used in another conversation.',
        409,
      ),
    }),
  );
}
