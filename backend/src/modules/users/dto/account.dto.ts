import { UserRole } from '@prisma/client';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** A login for an employee: a role, and exactly one of a mobile number or an email to sign in with. */
export class CreateAccountDto {
  @IsEnum(UserRole)
  role!: UserRole;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(254)
  email?: string;
}

/** The same, for a driver profile being created: the role is always DRIVER. */
export class DriverAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(254)
  email?: string;
}

export class ChangeRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;
}

export class AccountReasonDto {
  @IsString()
  @IsNotEmpty({ message: 'a reason is required' })
  @MaxLength(300)
  reason!: string;
}
