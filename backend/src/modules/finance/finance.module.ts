import { Module } from '@nestjs/common';

/**
 * Finance ledger domain: what is owed and recorded (salaries, advances, recoveries,
 * reimbursements). Execution of money movement belongs to PaymentsModule — the two are
 * kept separate so a failed payout never rewrites financial history.
 * Ledger tables and workflows are a later phase; Phase 0 fixes the vocabulary.
 */
@Module({})
export class FinanceModule {}
