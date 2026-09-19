# Gangamata Roadlines — Fleet Management Prototype

A working, client-facing prototype for an Indian transport company: a **driver app** (mobile-first, six Indian languages) and an **office admin console** (desktop-first, responsive). Everything runs in the browser — no backend, payment gateway or GPS — with realistic simulations behind clean, swappable modules.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173  → opens the driver app
npm run build        # type-check + production build (dist/)
npm run build:demo   # one self-contained file: dist-demo/index.html (works from disk / any static host)
npm run i18n:check   # every t('key') exists; all locales complete
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
    map/           SVG fleet map + position hook (no map API)
    calculator/    fuel · trip · salary · expense calculators
  store/           zustand store (persisted to localStorage) — the single source of truth
  data/            seed data, constants, geography (real city coordinates, highways)
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

## Notes

- Fonts (Archivo, Noto Sans Indic) load from Google Fonts; offline, the system fallback is used.
- PDF reports print in English with "Rs" — jsPDF's built-in fonts have no ₹ or Indic glyphs. Excel exports follow the admin language.
- Driver app is always light (outdoor readability); admin has light/dark.
