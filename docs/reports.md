# Reports & Management (Phase 8)

Management reporting over the records Gangamata already keeps. Every figure is computed by the
API from its source records when it is asked for — there are no snapshot tables, no sample data
and no figures totalled in the browser.

## Where things live

| Layer | Path |
|---|---|
| API module | `backend/src/modules/reports/` |
| Period resolution (presets, FY, IST) | `report-range.ts` |
| Who may see what | `report-access.ts` |
| Shared arithmetic (weighted rate, payment groups, document health) | `report-maths.ts` |
| One service per report | `services/*-report.service.ts` |
| PDF / Excel / CSV writers and the export orchestrator | `export/` |
| Embedded fonts (Noto, SIL OFL) | `backend/assets/fonts/` |
| Admin web | `src/features/reports/` (opened from **Reports** in the sidebar) |
| Indexes for report scans | migration `20261005000000_phase8_reporting_indexes` |

## Reports and their sources of truth

| Report | Source of truth | Notes |
|---|---|---|
| Overview | the reports below | Owns no arithmetic: spend comes from the expense report, document health from compliance, tracking from the fleet service. |
| Fuel | active fuel entries | Average rate = total amount ÷ total litres (weighted). Breakdowns by fuel type, vehicle, driver, station; daily/monthly trend. |
| Vehicles | fuel entries, vehicle expenses, tyre-insurance premiums, EMI instalments, current documents | Operating cost excludes EMI. EMI shown only for FINANCED vehicles with loan terms. |
| Drivers | fuel entries, vehicle expenses, document uploads, payments, fleet state | Counts and totals only — no performance score. |
| Finance | finance ledger, salary records, advances, payment records, vehicle-finance instalments | Labelled *Financial Summary*: an operational view, not statutory accounts. |
| Expenses | fuel entries; RTO/tyre/maintenance expense records; tyre-insurance premiums | Production categories only (parking/food/repair do not exist in production data). |
| Maintenance & Service | maintenance expense records | AI status is information about the receipt; only VERIFIED is a person's confirmation. Service type/invoice shown only on verified records. |
| Tyres | tyre expense records; tyre-insurance policies | Brand/size/serial/position/warranty are not captured by the data model and are never shown or estimated. |
| Documents & Compliance | current documents of active vehicles and drivers | As of today. Missing = required document with no current record; never counted as expired. Window 7/30/60/90 days. |
| Location / Fleet | driver location state, fleet alerts, raw GPS fixes | Live status re-derived as of now. Fix counts only within raw-GPS retention (7 days); aggregated in SQL. |

Archived records are excluded everywhere. Tyre-insurance premiums are dated by the policy start
date, or the day recorded when there is none — the same rule the ledger posts them with.

## Periods

`preset` = `today`, `yesterday`, `this_week` (Monday start), `this_month`, `previous_month`,
`this_quarter` (financial quarters Apr–Jun …), `this_fy`, `previous_fy`, `fy` (with `fy=2025-26`)
or `custom` (with `from`/`to`). Default: the current financial year to date.

- Financial year: **1 April → 31 March**. `FY 2026–27` = 1 Apr 2026 → 31 Mar 2027.
- Days are India calendar days (IST). Timestamp columns (payments paid, alerts) are converted with
  a half-open window from 00:00 IST on the first day.
- "To date" presets end today, so future days never appear as zeros.
- Validation: dates must exist, `from ≤ to`, at most ~3 years (1,100 days), nothing before 2000,
  no financial year that has not started. Mixing a relative preset with explicit dates is refused.
- Trends are daily up to 62 days, monthly beyond; empty buckets inside a successful query are real zeros.

## API

All routes are under `/api/v1/reports`, authenticated, company-scoped and role-checked.

| Route | Purpose |
|---|---|
| `GET /meta` | Reports this role may open, presets, financial years, categories, expiry windows |
| `GET /{report}` | Summary: totals, breakdowns, trend |
| `GET /{report}/records` | One page of records: `page`, `pageSize` (≤ 100), `sort` (whitelisted per report), `dir`, `q`; `section` for tyres (`expenses`/`policies`) and location (`drivers`/`alerts`) |
| `GET /{report}/export?format=pdf\|xlsx\|csv` | Server-built file with the same filters |

`{report}` is one of `overview`, `fuel`, `vehicles`, `drivers`, `finance`, `expenses`,
`maintenance`, `tyres`, `compliance`, `location`. Each report has its own query class, so unknown
parameters are rejected (400) and no client string ever reaches a query as a column name.

## Access

| Report | SUPER_ADMIN | ADMIN | MANAGER | ACCOUNTING | DRIVER |
|---|---|---|---|---|---|
| Overview | ✓ | ✓ | ✓ (no payment figures) | ✓ (no compliance/location figures) | ✗ |
| Fuel, Vehicles, Expenses, Maintenance, Tyres | ✓ | ✓ | ✓ | ✓ | ✗ |
| Drivers | ✓ | ✓ | ✓ (no payment columns) | ✓ (no location columns) | ✗ |
| Finance | ✓ | ✓ | ✗ | ✓ | ✗ |
| Documents & Compliance, Location | ✓ | ✓ | ✓ | ✗ | ✗ |

The table is `REPORT_ROLES` in `report-access.ts`; every route's `@Roles` comes from it and the
export service checks it again. Sections a role may not see are omitted from the response, not
returned as zero. Payroll visibility follows the existing `PAYROLL_ROLES`.

## Exports

- **PDF** (pdfkit): company, title, period, financial year(s), applied filters, generator and time,
  key figures, every table with repeated headers, definitions, "Page n of m". ₹ and Indian digit
  grouping (₹1,25,450.00); names in Devanagari, Kannada, Tamil or Telugu print in the matching
  Noto font. Record tables are capped at 1,000 rows with a stated "first N of M" note.
- **Excel** (exceljs): *Report* sheet (metadata, key figures, definitions), *Summary* sheet
  (breakdowns), one data sheet per record table. Real numbers and dates; rupees formatted with
  lakh/crore grouping. Up to 50,000 rows — beyond that the export is refused with
  `EXPORT_TOO_LARGE` rather than silently shortened.
- **CSV**: the primary record table; UTF-8 with BOM, RFC 4180 quoting, ISO dates, IST times,
  plain numbers, and formula-looking text neutralised. Up to 100,000 rows.

Export labels are English (for accounting review); data values keep their original script.
Every export writes an audit entry `report.exported` (who, report, format, period, filters, row
count, size). The file itself is streamed and never stored.

## Performance

Aggregation happens in PostgreSQL (`groupBy`/`aggregate`, one parameterised `UNION ALL` for the
expense register) and record lists are one page at a time. Per-vehicle/driver reports aggregate
by key and join in memory, bounded by fleet size rather than transaction count. Measured in the
volume e2e test (6,000 fuel entries, 6,000 expenses, 20,000 GPS fixes, 50 vehicles): summaries
25–180 ms, record pages under 60 ms, a full-year Excel + 12,000-row CSV + PDF in about 1.6 s.

If volumes ever require it, daily or monthly aggregate tables can sit behind the same services
without changing a screen or a route.

## Known limitations

- Ledger reversals are dated on the day of the correction (the ledger's design), so a period's
  Financial Summary reflects corrections made in that period; source-record reports (fuel,
  expenses) always show the record's current values on its business date.
- Raw GPS fixes are retained 7 days, so activity counts exist only for that window; stationary
  alerts are permanent.
- Tyre-level details (brand, size, serial, position, warranty) are not recorded anywhere.
- Admin web text is English and Hindi (the console's existing languages); the mobile office
  Reports screen is translated into all six languages.
