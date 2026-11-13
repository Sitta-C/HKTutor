import { ApiProperty } from '@nestjs/swagger';

export const REPORT_CURRENCY = 'THB' as const;

/** Binds unused query/body inputs so the global whitelist rejects caller-supplied authority or filters. */
export class ReportEmptyInputDto {}

export class TutorReportStatusCountsDto {
  @ApiProperty({ example: 3, minimum: 0, type: 'integer' })
  PENDING!: number;

  @ApiProperty({ example: 1, minimum: 0, type: 'integer' })
  CONFIRMED!: number;

  @ApiProperty({ example: 6, minimum: 0, type: 'integer' })
  COMPLETED!: number;

  @ApiProperty({ example: 2, minimum: 0, type: 'integer' })
  CANCELED!: number;

  @ApiProperty({ example: 0, minimum: 0, type: 'integer' })
  EXPIRED!: number;
}

export class TutorReportRevenueDto {
  @ApiProperty({
    description:
      'Total netAmount in THB across PAID and COMPLETED bookings owned by the tutor, formatted as a fixed-decimal string.',
    example: '905.00',
  })
  amount!: string;

  @ApiProperty({ enum: [REPORT_CURRENCY], example: REPORT_CURRENCY })
  currency!: typeof REPORT_CURRENCY;
}

export class TutorReportCompletionRateDto {
  @ApiProperty({ example: 6, minimum: 0, type: 'integer' })
  completed!: number;

  @ApiProperty({
    description: 'Finalized booking count (COMPLETED + CANCELED); EXPIRED is excluded.',
    example: 8,
    minimum: 0,
    type: 'integer',
  })
  finalized!: number;

  @ApiProperty({
    description:
      'completed / finalized * 100 rounded HALF_UP to 2 decimal places, or null when finalized is 0.',
    example: 75,
    nullable: true,
    type: Number,
  })
  percent!: number | null;
}

export class TutorReportResponseDto {
  @ApiProperty({ example: 12, minimum: 0, type: 'integer' })
  totalBookings!: number;

  @ApiProperty({ type: TutorReportStatusCountsDto })
  statusCounts!: TutorReportStatusCountsDto;

  @ApiProperty({ type: TutorReportRevenueDto })
  revenue!: TutorReportRevenueDto;

  @ApiProperty({ type: TutorReportCompletionRateDto })
  completionRate!: TutorReportCompletionRateDto;
}
