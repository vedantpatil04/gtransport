/** Reporting vocabulary. Exports themselves (PDF/Excel) already exist in the admin UI. */
export interface ReportPeriod {
  /** Inclusive start, exclusive end — avoids the off-by-one that inclusive end dates invite. */
  from: Date;
  toExclusive: Date;
}

export type ReportGrouping = 'day' | 'month' | 'vehicle' | 'driver';

export interface ReportRequest {
  companyId: string;
  period: ReportPeriod;
  grouping: ReportGrouping;
}
