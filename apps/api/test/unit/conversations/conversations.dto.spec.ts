import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  CreateConversationDto,
  GetMessagesQueryDto,
  GetMyConversationsQueryDto,
  MarkMessagesReadDto,
  MESSAGE_TEXT_MAX_LENGTH,
  SendMessageDto,
} from '@modules/conversations/conversations.dto';

const TUTOR_ID = 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc';
const STUDENT_ID = '2c9d7e1f-4a3b-4c5d-8e6f-7a8b9c0d1e2f';
const MESSAGE_ID = 'b7e4c1a2-5f6d-4e8b-9a0c-3d2f1e4b5a69';

// One character stored as two UTF-16 units.
const GRINNING_FACE = '\u{1F600}';
// Two characters: a heart and the variation selector that makes it an emoji.
const RED_HEART = '❤️';

const validateMessage = async (input: Record<string, unknown>) => {
  const dto = plainToInstance(SendMessageDto, input);
  return { dto, errors: await validate(dto) };
};

describe('SendMessageDto', () => {
  it('accepts the US2-1 example message', async () => {
    const { dto, errors } = await validateMessage({ text: 'Do you teach quadratic equations?' });

    expect(errors).toHaveLength(0);
    expect(dto.text).toBe('Do you teach quadratic equations?');
    expect(dto.text).toHaveLength(33);
  });

  it('trims surrounding whitespace before validating', async () => {
    const { dto, errors } = await validateMessage({ text: '  \n Hello \t ' });

    expect(errors).toHaveLength(0);
    expect(dto.text).toBe('Hello');
  });

  it.each([
    ['', 'an empty text'],
    ['   \n\t ', 'a whitespace-only text'],
    [123, 'a non-string text'],
    [undefined, 'a missing text'],
  ])('rejects %p (%s)', async (text) => {
    const { errors } = await validateMessage({ text });

    expect(errors.map((error) => error.property)).toEqual(['text']);
  });

  it('accepts a one-character message', async () => {
    const { errors } = await validateMessage({ text: 'a' });

    expect(errors).toHaveLength(0);
  });

  it('accepts exactly 2000 characters and rejects 2001', async () => {
    const atLimit = await validateMessage({ text: 'a'.repeat(MESSAGE_TEXT_MAX_LENGTH) });
    const overLimit = await validateMessage({ text: 'a'.repeat(MESSAGE_TEXT_MAX_LENGTH + 1) });

    expect(atLimit.errors).toHaveLength(0);
    expect(overLimit.errors.map((error) => error.property)).toEqual(['text']);
    expect(overLimit.errors[0]?.constraints).toHaveProperty('matches');
  });

  it('applies the limit after trimming', async () => {
    const { errors } = await validateMessage({ text: ` ${'a'.repeat(MESSAGE_TEXT_MAX_LENGTH)} ` });

    expect(errors).toHaveLength(0);
  });

  it('counts characters the way the database check does', async () => {
    const astral = await validateMessage({ text: GRINNING_FACE.repeat(MESSAGE_TEXT_MAX_LENGTH) });
    const withSelectors = await validateMessage({
      text: RED_HEART.repeat(MESSAGE_TEXT_MAX_LENGTH / 2 + 1),
    });

    expect(astral.errors).toHaveLength(0);
    expect(withSelectors.errors.map((error) => error.property)).toEqual(['text']);
  });
});

describe('CreateConversationDto', () => {
  it.each([
    [{ tutorId: TUTOR_ID }, 'a student'],
    [{ participantId: STUDENT_ID }, 'a tutor'],
    [{}, 'the service, which knows the role'],
  ])('accepts %p, leaving the key check to %s', async (input) => {
    const dto = plainToInstance(CreateConversationDto, input);

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    [{ tutorId: 'not-a-uuid' }, 'tutorId'],
    [{ participantId: 'not-a-uuid' }, 'participantId'],
  ])('rejects %p as a malformed %s', async (input, property) => {
    const dto = plainToInstance(CreateConversationDto, input);

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual([property]);
  });
});

describe('GetMyConversationsQueryDto', () => {
  it('accepts an empty query', async () => {
    const query = plainToInstance(GetMyConversationsQueryDto, {});

    await expect(validate(query)).resolves.toHaveLength(0);
  });

  it('accepts a cursor and transforms the limit', async () => {
    const query = plainToInstance(GetMyConversationsQueryDto, {
      cursor: 'eyJhY3Rpdml0eUF0Ijoi',
      limit: '25',
    });

    await expect(validate(query)).resolves.toHaveLength(0);
    expect(query).toMatchObject({ cursor: 'eyJhY3Rpdml0eUF0Ijoi', limit: 25 });
  });

  it.each([
    ['a limit of 0', { limit: '0' }, 'limit'],
    ['a limit over 50', { limit: '51' }, 'limit'],
    ['a fractional limit', { limit: '1.5' }, 'limit'],
    ['an empty cursor', { cursor: '' }, 'cursor'],
    ['a cursor over 512 characters', { cursor: 'a'.repeat(513) }, 'cursor'],
  ])('rejects %s', async (_label, input, property) => {
    const errors = await validate(plainToInstance(GetMyConversationsQueryDto, input));

    expect(errors.map((error) => error.property)).toEqual([property]);
  });
});

describe('GetMessagesQueryDto', () => {
  it('accepts an empty query', async () => {
    const query = plainToInstance(GetMessagesQueryDto, {});

    await expect(validate(query)).resolves.toHaveLength(0);
  });

  it('accepts a message cursor and transforms the page size', async () => {
    const query = plainToInstance(GetMessagesQueryDto, {
      afterMessageId: MESSAGE_ID,
      pageSize: '50',
    });

    await expect(validate(query)).resolves.toHaveLength(0);
    expect(query).toMatchObject({ afterMessageId: MESSAGE_ID, pageSize: 50 });
  });

  it.each([
    [{ pageSize: '0' }, 'pageSize'],
    [{ pageSize: '51' }, 'pageSize'],
    [{ pageSize: '1.5' }, 'pageSize'],
    [{ afterMessageId: 'm-20' }, 'afterMessageId'],
  ])('rejects %p', async (input, property) => {
    const errors = await validate(plainToInstance(GetMessagesQueryDto, input));

    expect(errors.map((error) => error.property)).toEqual([property]);
  });
});

describe('MarkMessagesReadDto', () => {
  it.each([
    [{}, 'an empty body'],
    [{ upToMessageId: MESSAGE_ID }, 'an upToMessageId'],
  ])('accepts %p (%s)', async (input) => {
    await expect(validate(plainToInstance(MarkMessagesReadDto, input))).resolves.toHaveLength(0);
  });

  it('rejects an upToMessageId that is not a UUID', async () => {
    const errors = await validate(plainToInstance(MarkMessagesReadDto, { upToMessageId: 'm-77' }));

    expect(errors.map((error) => error.property)).toEqual(['upToMessageId']);
  });
});
