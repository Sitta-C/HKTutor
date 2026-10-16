import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';

const PUBLIC_ROLES = ['student', 'tutor'] as const;
const POLICY_VERSIONS = [CURRENT_PRIVACY_POLICY_VERSION] as const;

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  @Matches(/[A-Za-z]/, { message: 'Password must contain a letter' })
  @Matches(/\d/, { message: 'Password must contain a number' })
  password!: string;

  @IsIn(PUBLIC_ROLES)
  role!: (typeof PUBLIC_ROLES)[number];

  @IsBoolean()
  consent!: boolean;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsIn([...POLICY_VERSIONS])
  policyVersion!: string;
}

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}

export class VerifyEmailDto {
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  token!: string;
}

export class ForgotPasswordDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class AcceptPrivacyNoticeDto {
  @IsBoolean()
  consent!: boolean;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsIn([...POLICY_VERSIONS])
  policyVersion!: string;
}

export class ResendEmailDto {
  @IsUUID()
  flowId!: string;
}

export class EmailFlowQueryDto {
  @IsIn(['verification', 'password-reset'])
  purpose!: 'verification' | 'password-reset';
}

export class ResetPasswordDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  @Matches(/[A-Za-z]/, { message: 'Password must contain a letter' })
  @Matches(/\d/, { message: 'Password must contain a number' })
  password!: string;
}
