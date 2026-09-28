import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { getRequestId } from '../../common/http/request-context';
import type { AccountProfile } from '../users/users.service';
import { AuthService, type LoginResult, type RequestContext } from './auth.service';
import type { AuthenticatedUser } from './authenticated-user';
import { AllowPendingPasswordChange, CurrentUser, Public } from './decorators';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

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
}

function context(request: Request): RequestContext {
  return { ipAddress: request.ip ?? null, userAgent: request.header('user-agent') ?? null, requestId: getRequestId(request) };
}
