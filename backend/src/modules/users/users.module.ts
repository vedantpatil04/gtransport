import { Module } from '@nestjs/common';
import { PasswordHasher } from '../auth/password-hasher';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { UsersService } from './users.service';

/** Sign-in identities: lookups for authentication, and account management for administrators. */
@Module({
  controllers: [AccountsController],
  providers: [UsersService, AccountsService, PasswordHasher],
  exports: [UsersService, AccountsService, PasswordHasher],
})
export class UsersModule {}
