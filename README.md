# Gangamata Transport — Fleet Management

One product with two clients on one backend:

| Client | Who | Where |
|---|---|---|
| **Office console** (this folder, React + Vite) | Super admin, admin, manager, accounting | Vercel — https://gtransportt.vercel.app (official domain later) |
| **Driver app** ([`mobile/`](mobile), Expo / React Native) | Drivers (Android APK); office roles get a phone-sized office view | Android |
| **API** ([`backend/`](backend), NestJS) | Both clients — one auth/RBAC system | Render — https://gtransport-7vgf.onrender.com, data in Supabase PostgreSQL, files in Cloudinary |

Production builds of both clients talk to the Render API: the console through the committed
[`.env.production`](.env.production), the driver app through its default in
[`mobile/app.config.ts`](mobile/app.config.ts). `VITE_API_URL` / `EXPO_PUBLIC_API_URL` override them;
there is no localhost, emulator or LAN fallback. See
[`PHASE-CROSS-PLATFORM-1-NOTES.md`](PHASE-CROSS-PLATFORM-1-NOTES.md) for how the two clients are kept consistent.

The sections below describe the original browser-only prototype, which still runs as a
self-contained demo with sample data (`npm run build:demo`).

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173 — real mode when VITE_API_URL is set (see .env.example), else the demo
npm run build        # type-check + production build (dist/), always against the API in .env.production
npm run build:demo   # dist-demo/index.html, plus one MapLibre worker file for the Fleet map (serve both over HTTP; set VITE_MAP_STYLE_URL at build time)
npm run i18n:check   # every t('key') exists; all locales complete
npm test             # unit and component tests (Vitest)
```

Node 18+ (built and verified on Node 22).

## Demo walkthrough

Use **View as: Driver / Admin** in the dark strip at the top. The ⚙ button there switches the driver profile, simulates the phone going offline and resets demo data.

1. **Driver → + ADD FUEL** → Petrol, ₹2450, 25.3 L, pick *IndianOil – NH4*, take receipt photo → **SAVE FUEL**. Home shows Fuel ₹2,450.
2. **Admin → Dashboard**: the entry tops *Recent fuel updates*. **Fuel** → open the row → receipt preview → driver link.
3. On **Ramesh Kumar** → **Create payment** (Fuel Advance ₹3,000) → row menu → **Mark Processing**. Driver → Payments shows *Processing*. Admin → **Mark Paid**. Driver sees *Received*.
4. **Documents** → *Expiring* → KA 22 AB 1234 insurance → **Notify Driver / Insurer**. Driver bell shows the reminder.
5. **Live Fleet** → click Ramesh → location card (speed, last update, today's fuel/expenses/payments).
6. Driver → Profile → Language → **ಕನ್ನಡ**, then **हिंदी**. Admin header → language button → हिंदी.
7. **Reports** → Export PDF / Excel. Calculator button in the header (420 km · 6 km/L · ₹95 → 70 L · ₹6,650).
8. ⚙ → *Simulate offline* → add fuel (saved on phone, *Pending sync*) → turn it off → *Synced successfully*.

## Structure

```
src/
  components/      shared UI (shadcn-style primitives in ui/, Plate, status chips, media viewers, demo bar)
  layouts/         DriverLayout (phone column, bottom nav) · AdminLayout (sidebar / rail / mobile nav)
  features/
    driver/        driver app pages + components (home, add fuel, updates, payments, documents, profile)
    admin/         admin pages, filters, global search, dashboard data hooks
    fuel/ payments/ expenses/ documents/ drivers/ vehicles/   sheets & dialogs shared across screens
    map/           MapLibre fleet map (style from VITE_MAP_STYLE_URL, no built-in fallback) + position hook
    calculator/    fuel · trip · salary · expense calculators
  store/           zustand store (persisted to localStorage) — the single source of truth
  data/            seed data, constants, geography (real city coordinates)
  lib/             formatting (INR, Indian dates), exporters (PDF/XLSX), file store (IndexedDB), selectors
  i18n/            en, hi, kn, mr, ta, te (driver + shared) · admin in en + hi
  types/           domain types
scripts/           i18n tooling (check-i18n.mjs, merge-i18n.mjs)
```

## How the simulations work

| Real system | Prototype |
|---|---|
| Backend / database | `src/store` (zustand + `persist`), seeded from `src/data/seed.ts`; receipts/documents in IndexedDB (`src/lib/fileStore.ts`) |
| GPS | `positionFor()` in `src/data/geo.ts` moves each vehicle along its real highway route (sped up 40× so movement is visible) |
| Payment gateway | Status flow Pending → Processing → Paid/Failed with generated `RZP-…` references |
| Network loss | Demo toggle; entries are saved with `sync: 'pending'` and hidden from admin until synced |
| Push / SMS | In-app notifications per audience (driver id or `admin`), expiry reminders at 30/15/7/3 days |

Seed data is generated relative to *today*, so the dashboard always shows a working day. Figures are computed live from the data, not hard-coded. **Reset demo data** restores the seed.

## Production foundation (Phase 0)

The prototype above is unchanged and still runs entirely in the browser. Alongside it, `backend/` now holds the production API — NestJS, Prisma and PostgreSQL — established as a foundation only: no business workflow has been migrated, and the frontend does not consume it yet.

```bash
docker compose up -d      # local PostgreSQL
cd backend && npm install && npm run db:migrate && npm run dev
```

What exists: company/employee/driver/vehicle/document/file/audit/location data model, JWT auth with roles and driver self-scoping, validated configuration, a file-storage abstraction, an append-only audit trail, `/health`, and the receipt AI boundary (Ollama by default, Dify optional) wired into dependency injection.

See [`docs/backend/architecture.md`](docs/backend/architecture.md) for the design and [`docs/ai-receipt-processing.md`](docs/ai-receipt-processing.md) for the AI contract.

## Notes

- Fonts (Archivo, Noto Sans Indic) load from Google Fonts; offline, the system fallback is used.
- Demo-mode PDF reports print in English with "Rs" — jsPDF's built-in fonts have no ₹ or Indic glyphs. Excel exports follow the admin language.
- With the API connected, **Reports** is the live management reporting area (fuel, vehicles, drivers, finance, expenses, maintenance, tyres, compliance, fleet location); its PDF/Excel/CSV exports are built and audited by the server, with ₹ and Indian digit grouping. See [`docs/reports.md`](docs/reports.md).
- Driver app is always light (outdoor readability); admin has light/dark.
