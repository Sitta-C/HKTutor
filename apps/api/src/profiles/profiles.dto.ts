import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

class PersonalNameDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  nickname!: string;
}

export class SaveStudentProfileDto extends PersonalNameDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  school!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  gradeLevel!: string;

  @Transform(trimString)
  @IsString()
  @Matches(/^[+0-9][0-9 ()-]{7,31}$/, {
    message: 'phone must contain 8-32 phone-number characters',
  })
  phone!: string;
}

export class SaveTutorProfileDto extends PersonalNameDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  bio!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  experienceYears!: number;
}
