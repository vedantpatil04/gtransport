import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  /** Email address or phone number, depending on how the account was created. */
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  identifier!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password!: string;
}
