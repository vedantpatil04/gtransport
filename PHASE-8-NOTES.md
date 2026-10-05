# Phase 8 — Reports & Management

Design, sources of truth, definitions, access rules and limits: [`docs/reports.md`](docs/reports.md).

## After pulling

```bash
cd backend
npm install            # adds pdfkit and exceljs (server-side PDF/Excel exports)
npm run db:deploy      # applies 20261005000000_phase8_reporting_indexes (indexes only)
npm run db:generate
```

The migration only adds five indexes (expense and payment date ranges, per-driver expenses,
stationary alerts by time). No table, column or row changes. On a large production table, run it
at a quiet time: `CREATE INDEX` holds a write lock on that table while it builds.

There are no new environment variables. The PDF fonts are committed under
`backend/assets/fonts/` (Noto Sans and its Devanagari, Kannada, Tamil and Telugu families, SIL Open
Font License — see `OFL.txt` there), so the deploy needs nothing else.

## What changed for users

- **Admin web → Reports** now shows live reports in real mode: Overview, Fuel, Vehicles, Drivers,
  Finance, Expenses, Maintenance & Service, Tyres, Documents & Compliance, Location / Fleet.
  Filters live in the URL (shareable, back-button friendly). Exports are built by the server.
  Demo mode (no `VITE_API_URL`) keeps the approved prototype Reports page unchanged.
- **Mobile office → Reports** no longer pretends to generate PDF/Excel files (the Phase 7 screen
  showed a "report generation request submitted" alert with no file behind it). It now says that
  exports are produced from the web console, requests payroll figures only for payroll roles
  (managers previously got a refusal banner), and is translated into all six languages.
- The API exposes `Content-Disposition` to the browser (CORS `exposedHeaders`) so downloads keep
  their server-given file names.
