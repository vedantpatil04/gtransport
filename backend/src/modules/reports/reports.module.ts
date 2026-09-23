import { Module } from '@nestjs/common';

/**
 * Reporting domain. Aggregation queries arrive once the fuel/expense/finance tables exist;
 * they will read from indexed, date-partitioned data rather than scanning history.
 */
@Module({})
export class ReportsModule {}
