import { Role } from '@generated/prisma/enums';
import { OWNERSHIP_KEY } from '@modules/auth/ownership.decorator';
import {
  BookingRescheduleRequestsController,
  RescheduleRequestsController,
} from '@modules/reschedule-requests/reschedule-requests.controller';
import { RESCHEDULE_BOOKING_OWNERSHIP_ERRORS } from '@modules/reschedule-requests/reschedule-requests.service';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';
import type { OwnershipRule } from '@modules/auth/ownership.decorator';
import type {
  ApproveRescheduleResponseDto,
  CreateRescheduleRequestDto,
  CreateRescheduleRequestResponseDto,
  CurrentRescheduleRequestResponseDto,
  RejectRescheduleRequestDto,
  RejectRescheduleResponseDto,
  WithdrawRescheduleResponseDto,
} from '@modules/reschedule-requests/reschedule-requests.dto';
import type { RescheduleRequestsService } from '@modules/reschedule-requests/reschedule-requests.service';

const STUDENT_USER: AuthenticatedUser = {
  email: 'student@example.test',
  id: '70e1232d-3c06-4d5d-b3d2-6026df5ff315',
  role: Role.STUDENT,
  sessionId: 'session-1',
};

const TUTOR_USER: AuthenticatedUser = {
  email: 'tutor@example.test',
  id: 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc',
  role: Role.TUTOR,
  sessionId: 'session-2',
};

const BOOKING_ID = '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae';
const REQUEST_ID = '8f0a20bf-7ff8-41ec-bbf5-59b5cfa33020';
const TARGET_SLOT_ID = '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5';

describe('BookingRescheduleRequestsController', () => {
  it('delegates create to service with authenticated user details', async () => {
    const create = jest.fn();
    const service = { create } as unknown as RescheduleRequestsService;
    const controller = new BookingRescheduleRequestsController(service);

    const dto: CreateRescheduleRequestDto = {
      reason: 'Exam conflict',
      targetSlotId: TARGET_SLOT_ID,
    };
    const expected = {} as CreateRescheduleRequestResponseDto;
    create.mockResolvedValue(expected);

    const result = await controller.create(BOOKING_ID, dto, STUDENT_USER);

    expect(create).toHaveBeenCalledWith(STUDENT_USER.id, STUDENT_USER.role, BOOKING_ID, dto);
    expect(result).toBe(expected);
  });

  it('declares participant ownership for create', () => {
    const handler = Object.getOwnPropertyDescriptor(
      BookingRescheduleRequestsController.prototype,
      'create',
    )?.value as object | undefined;
    const ownership = handler
      ? (Reflect.getMetadata(OWNERSHIP_KEY, handler) as OwnershipRule | undefined)
      : undefined;

    expect(ownership).toEqual({
      errors: RESCHEDULE_BOOKING_OWNERSHIP_ERRORS,
      idParam: 'bookingId',
      resource: 'booking',
    });
  });

  it('delegates getCurrent to service with authenticated user details', async () => {
    const getCurrent = jest.fn();
    const service = { getCurrent } as unknown as RescheduleRequestsService;
    const controller = new BookingRescheduleRequestsController(service);

    const expected = {} as CurrentRescheduleRequestResponseDto;
    getCurrent.mockResolvedValue(expected);

    const result = await controller.getCurrent(BOOKING_ID, TUTOR_USER);

    expect(getCurrent).toHaveBeenCalledWith(TUTOR_USER.id, BOOKING_ID);
    expect(result).toBe(expected);
  });

  it('declares participant ownership for getCurrent', () => {
    const handler = Object.getOwnPropertyDescriptor(
      BookingRescheduleRequestsController.prototype,
      'getCurrent',
    )?.value as object | undefined;
    const ownership = handler
      ? (Reflect.getMetadata(OWNERSHIP_KEY, handler) as OwnershipRule | undefined)
      : undefined;

    expect(ownership).toEqual({
      errors: RESCHEDULE_BOOKING_OWNERSHIP_ERRORS,
      idParam: 'bookingId',
      resource: 'booking',
    });
  });
});

describe('RescheduleRequestsController', () => {
  it('delegates approve to service with authenticated user details', async () => {
    const approve = jest.fn();
    const service = { approve } as unknown as RescheduleRequestsService;
    const controller = new RescheduleRequestsController(service);

    const expected = {} as ApproveRescheduleResponseDto;
    approve.mockResolvedValue(expected);

    const result = await controller.approve(REQUEST_ID, TUTOR_USER);

    expect(approve).toHaveBeenCalledWith(TUTOR_USER.id, REQUEST_ID);
    expect(result).toBe(expected);
  });

  it('delegates reject to service with authenticated user details', async () => {
    const reject = jest.fn();
    const service = { reject } as unknown as RescheduleRequestsService;
    const controller = new RescheduleRequestsController(service);

    const dto: RejectRescheduleRequestDto = { reason: 'Cannot make that time' };
    const expected = {} as RejectRescheduleResponseDto;
    reject.mockResolvedValue(expected);

    const result = await controller.reject(REQUEST_ID, dto, TUTOR_USER);

    expect(reject).toHaveBeenCalledWith(TUTOR_USER.id, REQUEST_ID, dto);
    expect(result).toBe(expected);
  });

  it('delegates withdraw to service with authenticated user details', async () => {
    const withdraw = jest.fn();
    const service = { withdraw } as unknown as RescheduleRequestsService;
    const controller = new RescheduleRequestsController(service);

    const expected = {} as WithdrawRescheduleResponseDto;
    withdraw.mockResolvedValue(expected);

    const result = await controller.withdraw(REQUEST_ID, STUDENT_USER);

    expect(withdraw).toHaveBeenCalledWith(STUDENT_USER.id, REQUEST_ID);
    expect(result).toBe(expected);
  });
});
