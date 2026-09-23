import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { getRequestId } from '../../common/http/request-context';
import { AuthService, type LoginResult } from './auth.service';
import type { AuthenticatedUser } from './authenticated-user';
import { CurrentUser, Public } from './decorators';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginDto, @Req() request: Request): Promise<LoginResult> {
    return this.auth.login(body.identifier, body.password, {
      ipAddress: request.ip ?? null,
      userAgent: request.header('user-agent') ?? null,
      requestId: getRequestId(request),
    });
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
