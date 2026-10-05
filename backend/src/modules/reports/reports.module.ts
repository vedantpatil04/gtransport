import { Module } from '@nestjs/common';
import { LocationsModule } from '../locations/locations.module';
import { ReportExportService } from './export/report-export.service';
import { ReportsController } from './reports.controller';
import { ComplianceReportService } from './services/compliance-report.service';
import { DriverReportService } from './services/driver-report.service';
import { ExpenseReportService } from './services/expense-report.service';
import { FinanceReportService } from './services/finance-report.service';
import { FuelReportService } from './services/fuel-report.service';
import { LocationReportService } from './services/location-report.service';
import { MaintenanceReportService } from './services/maintenance-report.service';
import { OverviewReportService } from './services/overview-report.service';
import { ReportLookups } from './services/report-lookups';
import { TyreReportService } from './services/tyre-report.service';
import { VehicleReportService } from './services/vehicle-report.service';

/**
 * Reports & Management (Phase 8). Live reports over the source records — fuel, vehicle
 * expenses, documents, the finance ledger, salaries, advances, payments, vehicle finance and
 * fleet location — aggregated in PostgreSQL, never by shipping raw rows to the browser.
 *
 * There are no snapshot or warehouse tables: every figure is computed from the records it
 * describes when it is asked for. If volume ever demands it, daily/monthly aggregates can sit
 * behind these same services without changing a screen.
 */
@Module({
  imports: [LocationsModule],
  controllers: [ReportsController],
  providers: [
    ReportLookups,
    OverviewReportService,
    FuelReportService,
    VehicleReportService,
    DriverReportService,
    FinanceReportService,
    ExpenseReportService,
    MaintenanceReportService,
    TyreReportService,
    ComplianceReportService,
    LocationReportService,
    ReportExportService,
  ],
})
export class ReportsModule {}
