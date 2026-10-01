import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

class PersonalNameDto {
  @ApiProperty({ example: 'Suda', maxLength: 100, minLength: 1 })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Dee', maxLength: 100, minLength: 1 })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({ example: 'Da', maxLength: 60, minLength: 1 })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  nickname!: string;
}

export class SaveStudentProfileDto extends PersonalNameDto {
  @ApiProperty({ example: 'Demo School', maxLength: 160, minLength: 1 })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  school!: string;

  @ApiProperty({ example: 'Grade 10', maxLength: 80, minLength: 1 })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  gradeLevel!: string;

  @ApiProperty({
    description: 'Private emergency contact number containing 8-32 phone-number characters',
    example: '0812345678',
    maxLength: 32,
    minLength: 8,
    pattern: '^[+0-9][0-9 ()-]{7,31}$',
  })
  @Transform(trimString)
  @IsString()
  @Matches(/^[+0-9][0-9 ()-]{7,31}$/, {
    message: 'phone must contain 8-32 phone-number characters',
  })
  phone!: string;
}

export class SaveTutorProfileDto extends PersonalNameDto {
  @ApiProperty({ example: 'Kru Anan', maxLength: 100, minLength: 1 })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName!: string;

  @ApiProperty({ example: 'Mathematics tutor', maxLength: 2000, minLength: 1 })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  bio!: string;

  @ApiProperty({ example: 5, minimum: 0, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  experienceYears!: number;
}
