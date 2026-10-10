import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfigService } from '../../config/app-config.service';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginAttemptLimiter } from './login-attempt.limiter';
import { WebHandoffStore } from './web-handoff.store';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.jwt.secret,
        signOptions: { expiresIn: config.jwt.expiresIn },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, WebHandoffStore, LoginAttemptLimiter],
  // PasswordHasher now comes from UsersModule, which account management also needs.
  exports: [JwtModule, UsersModule],
})
export class AuthModule {}
