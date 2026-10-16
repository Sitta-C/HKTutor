import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  CreateRescheduleRequestDto,
  MAX_RESCHEDULE_TEXT_LENGTH,
  RejectRescheduleRequestDto,
} from '@modules/reschedule-requests/reschedule-requests.dto';

const VALID_SLOT_ID = '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5';

describe('CreateRescheduleRequestDto', () => {
  it('accepts a valid targetSlotId and omitted reason', async () => {
    const dto = plainToInstance(CreateRescheduleRequestDto, {
      targetSlotId: VALID_SLOT_ID,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid targetSlotId and valid reason', async () => {
    const dto = plainToInstance(CreateRescheduleRequestDto, {
      reason: 'Need to reschedule due to an exam.',
      targetSlotId: VALID_SLOT_ID,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('validates 499 and 500 characters, rejecting 501 characters', async () => {
    const dto499 = plainToInstance(CreateRescheduleRequestDto, {
      reason: 'a'.repeat(499),
      targetSlotId: VALID_SLOT_ID,
    });
    expect(await validate(dto499)).toHaveLength(0);

    const dto500 = plainToInstance(CreateRescheduleRequestDto, {
      reason: 'a'.repeat(MAX_RESCHEDULE_TEXT_LENGTH),
      targetSlotId: VALID_SLOT_ID,
    });
    expect(await validate(dto500)).toHaveLength(0);

    const dto501 = plainToInstance(CreateRescheduleRequestDto, {
      reason: 'a'.repeat(MAX_RESCHEDULE_TEXT_LENGTH + 1),
      targetSlotId: VALID_SLOT_ID,
    });
    expect(await validate(dto501)).not.toHaveLength(0);
  });

  it.each(['', '   ', '\n\t'])('rejects blank reason %j', async (reason) => {
    const dto = plainToInstance(CreateRescheduleRequestDto, {
      reason,
      targetSlotId: VALID_SLOT_ID,
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it.each([123, true, [], {}])('rejects non-string reason %j', async (reason) => {
    const dto = plainToInstance(CreateRescheduleRequestDto, {
      reason,
      targetSlotId: VALID_SLOT_ID,
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it.each([
    ['not-a-uuid', 'malformed string'],
    ['', 'empty string'],
    [12345, 'number'],
    [null, 'null'],
    [undefined, 'undefined'],
  ])('rejects targetSlotId %j (%s)', async (targetSlotId) => {
    const dto = plainToInstance(CreateRescheduleRequestDto, {
      targetSlotId,
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});

describe('RejectRescheduleRequestDto', () => {
  it('accepts omitted reason', async () => {
    const dto = plainToInstance(RejectRescheduleRequestDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts valid reason within length limits', async () => {
    const dto = plainToInstance(RejectRescheduleRequestDto, {
      reason: 'I am unavailable at the requested time.',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('validates length boundaries (500 ok, 501 rejected)', async () => {
    const dto500 = plainToInstance(RejectRescheduleRequestDto, {
      reason: 'r'.repeat(MAX_RESCHEDULE_TEXT_LENGTH),
    });
    expect(await validate(dto500)).toHaveLength(0);

    const dto501 = plainToInstance(RejectRescheduleRequestDto, {
      reason: 'r'.repeat(MAX_RESCHEDULE_TEXT_LENGTH + 1),
    });
    expect(await validate(dto501)).not.toHaveLength(0);
  });

  it.each(['', '   ', '\n'])('rejects blank reason %j', async (reason) => {
    const dto = plainToInstance(RejectRescheduleRequestDto, { reason });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it.each([123, false, [], {}])('rejects non-string reason %j', async (reason) => {
    const dto = plainToInstance(RejectRescheduleRequestDto, { reason });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
