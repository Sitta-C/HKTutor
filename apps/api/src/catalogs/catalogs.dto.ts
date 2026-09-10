import { ApiProperty } from '@nestjs/swagger';

export class SubjectOptionDto {
  @ApiProperty({ example: '<uuid>' })
  id!: string;

  @ApiProperty({ example: 'mathematics' })
  code!: string;

  @ApiProperty({ example: 'Mathematics' })
  name!: string;

  @ApiProperty({ example: true })
  active!: boolean;
}

export class GradeLevelOptionDto extends SubjectOptionDto {
  @ApiProperty({ example: 10 })
  sortOrder!: number;
}

export class SubjectCatalogResponseDto {
  @ApiProperty({ type: [SubjectOptionDto] })
  items!: SubjectOptionDto[];
}

export class GradeLevelCatalogResponseDto {
  @ApiProperty({ type: [GradeLevelOptionDto] })
  items!: GradeLevelOptionDto[];
}
