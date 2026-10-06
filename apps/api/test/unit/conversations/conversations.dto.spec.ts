import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  CreateConversationDto,
  GetMyConversationsQueryDto,
  MESSAGE_BODY_MAX_LENGTH,
  SendMessageDto,
} from '@modules/conversations/conversations.dto';

const TUTOR_ID = 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc';
const CLIENT_MESSAGE_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

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
    const { dto, errors } = await validateMessage({ body: 'Do you teach quadratic equations?' });

    expect(errors).toHaveLength(0);
    expect(dto.body).toBe('Do you teach quadratic equations?');
    expect(dto.body).toHaveLength(33);
  });

  it('trims surrounding whitespace before validating', async () => {
    const { dto, errors } = await validateMessage({ body: '  \n Hello \t ' });

    expect(errors).toHaveLength(0);
    expect(dto.body).toBe('Hello');
  });

  it.each([
    ['', 'an empty body'],
    ['   \n\t ', 'a whitespace-only body'],
    [123, 'a non-string body'],
    [undefined, 'a missing body'],
  ])('rejects %p (%s)', async (body) => {
    const { errors } = await validateMessage({ body });

    expect(errors.map((error) => error.property)).toEqual(['body']);
  });

  it('accepts exactly 2000 characters and rejects 2001', async () => {
    const atLimit = await validateMessage({ body: 'a'.repeat(MESSAGE_BODY_MAX_LENGTH) });
    const overLimit = await validateMessage({ body: 'a'.repeat(MESSAGE_BODY_MAX_LENGTH + 1) });

    expect(atLimit.errors).toHaveLength(0);
    expect(overLimit.errors.map((error) => error.property)).toEqual(['body']);
    expect(overLimit.errors[0]?.constraints).toHaveProperty('matches');
  });

  it('applies the limit after trimming', async () => {
    const { errors } = await validateMessage({ body: ` ${'a'.repeat(MESSAGE_BODY_MAX_LENGTH)} ` });

    expect(errors).toHaveLength(0);
  });

  it('counts characters the way the database check does', async () => {
    const astral = await validateMessage({ body: GRINNING_FACE.repeat(MESSAGE_BODY_MAX_LENGTH) });
    const withSelectors = await validateMessage({
      body: RED_HEART.repeat(MESSAGE_BODY_MAX_LENGTH / 2 + 1),
    });

    expect(astral.errors).toHaveLength(0);
    expect(withSelectors.errors.map((error) => error.property)).toEqual(['body']);
  });

  it('accepts a UUID clientMessageId', async () => {
    const { errors } = await validateMessage({ body: 'Hello', clientMessageId: CLIENT_MESSAGE_ID });

    expect(errors).toHaveLength(0);
  });

  it('rejects a malformed clientMessageId', async () => {
    const { errors } = await validateMessage({ body: 'Hello', clientMessageId: 'retry-1' });

    expect(errors.map((error) => error.property)).toEqual(['clientMessageId']);
  });
});

describe('CreateConversationDto', () => {
  it('accepts a tutor UUID', async () => {
    const dto = plainToInstance(CreateConversationDto, { tutorId: TUTOR_ID });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    [{}, 'a missing tutorId'],
    [{ tutorId: 'not-a-uuid' }, 'a malformed tutorId'],
  ])('rejects %p (%s)', async (input) => {
    const dto = plainToInstance(CreateConversationDto, input);

    expect(await validate(dto)).not.toHaveLength(0);
  });
});

describe('GetMyConversationsQueryDto', () => {
  it('accepts an empty query', async () => {
    const query = plainToInstance(GetMyConversationsQueryDto, {});

    await expect(validate(query)).resolves.toHaveLength(0);
  });

  it('transforms valid page parameters', async () => {
    const query = plainToInstance(GetMyConversationsQueryDto, { page: '2', pageSize: '25' });

    await expect(validate(query)).resolves.toHaveLength(0);
    expect(query).toMatchObject({ page: 2, pageSize: 25 });
  });

  it.each([
    [{ page: '0' }, 'page below one'],
    [{ page: '1.5' }, 'non-integer page'],
    [{ pageSize: '0' }, 'page size below one'],
    [{ pageSize: '101' }, 'page size above the maximum'],
  ])('rejects %s (%s)', async (input) => {
    const query = plainToInstance(GetMyConversationsQueryDto, input);

    expect(await validate(query)).not.toHaveLength(0);
  });
});
