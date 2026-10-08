import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { getRequestId } from '../../common/http/request-context';
import type { AccountProfile } from '../users/users.service';
import { AuthService, type LoginResult, type RequestContext } from './auth.service';
import type { AuthenticatedUser } from './authenticated-user';
import { AllowPendingPasswordChange, CurrentUser, Public } from './decorators';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { WebHandoffExchangeDto } from './dto/web-handoff.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginDto, @Req() request: Request): Promise<LoginResult> {
    return this.auth.login(body.identifier, body.password, context(request));
  }

  @Get('me')
  @AllowPendingPasswordChange()
  me(@CurrentUser() user: AuthenticatedUser): Promise<AccountProfile> {
    return this.auth.me(user);
  }

  /** Returns a fresh session: changing the password ends every other one. */
  @Post('change-password')
  @AllowPendingPasswordChange()
  @HttpCode(HttpStatus.OK)
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() body: ChangePasswordDto, @Req() request: Request): Promise<LoginResult> {
    return this.auth.changePassword(user, body.currentPassword, body.newPassword, context(request));
  }

  /** A one-time, minute-long code the phone app uses to open the office console signed in. */
  @Post('web-handoff')
  @HttpCode(HttpStatus.OK)
  createWebHandoff(@CurrentUser() user: AuthenticatedUser, @Req() request: Request): Promise<{ code: string; expiresAt: string }> {
    return this.auth.createWebHandoff(user, context(request));
  }

  /** Spends a handoff code for an ordinary console session (the same response as sign-in). */
  @Public()
  @Post('web-handoff/exchange')
  @HttpCode(HttpStatus.OK)
  exchangeWebHandoff(@Body() body: WebHandoffExchangeDto, @Req() request: Request): Promise<LoginResult> {
    return this.auth.exchangeWebHandoff(body.code, context(request));
  }
}

function context(request: Request): RequestContext {
  return { ipAddress: request.ip ?? null, userAgent: request.header('user-agent') ?? null, requestId: getRequestId(request) };
}
