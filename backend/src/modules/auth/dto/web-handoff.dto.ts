import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** A one-time code from POST /auth/web-handoff (base64url, 43 characters). */
export class WebHandoffExchangeDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  code!: string;
}
