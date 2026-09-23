import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from './common/audit/audit.module';
import { RequestLoggingMiddleware } from './common/http/request-logging.middleware';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { RolesGuard } from './modules/auth/roles.guard';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { FilesModule } from './modules/files/files.module';
import { FinanceModule } from './modules/finance/finance.module';
import { FuelModule } from './modules/fuel/fuel.module';
import { HealthModule } from './modules/health/health.module';
import { InboxModule } from './modules/inbox/inbox.module';
import { LocationsModule } from './modules/locations/locations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReportsModule } from './modules/reports/reports.module';
import { UsersModule } from './modules/users/users.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { AssignmentsModule } from './modules/assignments/assignments.module';

/**
 * Modular monolith: one deployable, clear module boundaries.
 *
 * Authentication and role checks are global guards, so a new route is protected by default
 * and must opt out explicitly with @Public() — the safe direction for a mistake.
 */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    AuditModule,

    // Identity
    AuthModule,
    UsersModule,

    // Core domains
    EmployeesModule,
    DriversModule,
    VehiclesModule,
    AssignmentsModule,
    DocumentsModule,
    FilesModule,

    // Boundary modules (contracts in Phase 0)
    FuelModule,
    ExpensesModule,
    FinanceModule,
    PaymentsModule,
    ComplianceModule,
    LocationsModule,
    NotificationsModule,
    ReportsModule,
    InboxModule,

    // Receipt AI (Ollama by default, Dify optional)
    AiModule,

    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes('{*path}');
  }
}
