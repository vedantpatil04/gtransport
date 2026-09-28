import { IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../users/credentials';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword!: string;

  /** Strength rules live in credentials.ts so every client gets the same messages. */
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword!: string;
}
