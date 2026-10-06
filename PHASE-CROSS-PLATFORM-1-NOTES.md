# Cross-platform Phase 1 — UI/UX consistency & app structure

One product, two clients: the **office web console** (Vercel, desktop-first) and the **driver app**
(Expo / Android APK, phone-first), both talking to the one NestJS API on Render and its Supabase
PostgreSQL database. This phase aligns how the two look, read and navigate. It adds no backend
code, no migration and no dependency.

## After pulling

Nothing to install or migrate. Two configuration points to check once:

- **Office console (Vercel).** Production builds now take the API from the committed
  [`.env.production`](.env.production): `https://gtransport-7vgf.onrender.com`. A `VITE_API_URL`
  set in the Vercel project overrides it — make sure it is that URL, or remove it. The console no
  longer falls back to the prototype's sample data in a production build; only
  `npm run build:demo` builds the sample-data demo. The Render service's `CORS_ORIGINS` must list
  the console's origin (`https://gtransportt.vercel.app` today, the official domain later).
- **Driver app.** Every build — including a development build served by Metro — now defaults to
  the same production API; `EXPO_PUBLIC_API_URL` can still override it. There is no `localhost`,
  `10.0.2.2` or LAN fallback any more. If your local `mobile/.env` or `mobile/.env.local` sets
  `EXPO_PUBLIC_API_URL` to an emulator or LAN address, delete that line: Expo loads those files for
  Metro and local builds, and they would override the production default. (Metro itself may still
  need `REACT_NATIVE_PACKAGER_HOSTNAME` on a physical phone — that is the bundle server, not the API.)

## What changed

### Office web console

- **Fuel**: authorized roles (admin, manager, accounting — the same roles the API allows) can now
  **edit** a fuel entry (`PATCH /fuel/:id`) from the row menu, alongside archive/restore. The page
  no longer says fuel comes "from the driver app" only.
- **Settings** (real mode) is a working hub instead of a "not connected yet" placeholder: the
  signed-in account and role, password change, theme and language, and links to where logins/roles
  (Employees) and the company mailbox (Inbox) are managed. It says plainly that company details
  and reminder rules are not stored on the server yet.
- **Notifications** (real mode): the header bell is back, with a live count, and the Notifications
  page lists what needs attention now — expired / soon-expiring documents, payments awaiting
  approval or a status check (payroll roles only), drivers stopped too long, and mail the inbox
  flags. Every entry is a live count that opens the right screen; "nothing needs attention" is
  only claimed when every source answered. The sidebar badges and the bell share one set of
  requests (the inbox badge is now live too).
- **Global search** (real mode) shows *Searching…* and a retryable error instead of "Nothing found"
  while a search is in flight or has failed.
- **One address per screen**: `/admin/payments`, `/admin/expenses` and `/admin/employees/drivers…`
  redirect to their canonical addresses (keeping the query string), so the sidebar always highlights
  the right section; in-app links use the canonical addresses.
- Fuel, expense, receipt and policy **records and totals** show exact amounts (`₹980.50`, not
  `₹981`), with paise always as two digits (`₹23,999.70`) — the same rule as the driver app, so an
  office correction of a few paise is visible. Headline KPI cards keep whole rupees so large
  financial-year figures fit their cards.
- Dialogs and sheets announce "Close" in the console language.

### Driver app (APK)

- **Home**: "Received" shows the money actually paid to the driver today (from their payments);
  the Payments and Documents cards describe what is inside instead of "Coming soon". Each figure
  loads on its own and shows a dash, never a guess, when it cannot be loaded.
- **Profile**: drivers can change their own password, with the same card office staff use.
- Money, litres and dates follow the console's rules everywhere (Indian grouping, Latin digits in
  every language — Marathi dates no longer switch to Devanagari digits).
- Log-out wording is the same everywhere ("Log out"), and the confirmation no longer assumes the
  person signs in with a mobile number and passcode.

### Office screens inside the APK

- **Settings** was rewritten: fully translated, shows the real app version and the API host (it
  showed a fixed "v0.1.0 (Build 57)" and "Default Localhost"), the role in words, and points to the
  web console for administration.
- **Live Fleet** and **Inbox** are translated into all six languages with the console's own
  vocabulary (*Reporting*, *Falling behind*, *Not reporting*, *Stopped too long*; the mailbox's
  category and attachment wording), use the product's status colours, and meet the touch-target
  size. The Inbox now says when marking a message read/unread/archived failed (it used to fail
  silently) and offers a retry when a message cannot be opened.
- The old `/admin/*` duplicate routes (office screens without the tab bar) now redirect to `/office/*`.

## Navigation audit

| Where | Item | Destination | State |
|---|---|---|---|
| Console sidebar | Dashboard, Live Fleet, Vehicles, Fuel, Documents & Compliance, Reports, Inbox | live screens | connected |
| Console sidebar | Employees → All / Drivers / Office staff | `/admin/employees`, `/admin/drivers`, `/admin/employees/staff` | connected |
| Console sidebar | Finance → Ledger / Salaries & Advances / Payments / Expenses | `/admin/finance/*` (role-filtered) | connected |
| Console sidebar | Settings (admins) | live settings hub | **fixed** (was a placeholder) |
| Console header | Calculator / Search / Notifications | sheet / live search / live attention list | **search states and notifications fixed** |
| Console dashboard | every card | Fuel, Finance → Expenses / Payments (filtered) / Ledger, Documents | connected |
| Driver tabs | Home, Updates, Payments, Documents, Profile | live screens | connected |
| Driver Home | Add fuel, Other updates, Documents, Payments | `/fuel/new`, Updates, Documents, Payments tabs | connected (copy fixed) |
| Driver Updates | Petrol/Diesel, RTO, Tyre, Tyre insurance, Maintenance, Fuel history | live forms / history | connected |
| Office app (APK) | role tabs + More (Live Fleet, Employees, Documents, Reports, Inbox, Settings, Profile) | `/office/*` | connected |

Role handling is unchanged and still navigation-only (the API decides): drivers are refused by the
web console and kept out of `/office` in the app; office roles never see driver-only screens.

## Recorded for Phase 2

These need backend work or a product decision, so this phase keeps the navigation clean rather
than inventing behaviour:

1. **Office "Add fuel"** — the API only lets a driver create fuel (`POST /fuel/mine`). The console
   can view, edit, archive and restore; adding needs an office create endpoint (driver + vehicle
   chosen by the office, audited like other office writes).
2. **Office "Add / edit expense"** (RTO, tyre, maintenance, tyre insurance) — the API supports it
   (`POST /operations`, `PATCH /operations/:id`, `POST /operations/tyre-insurance`); the console has
   no create/edit dialog yet.
3. **Notification records** — a persisted feed with read state and push delivery to the APK (the
   API has only a channel abstraction; no feed or device-token endpoint).
4. **Company settings** — company details and document-reminder rules are not stored server-side.
5. **Console languages** — the office console is English + Hindi (driver and shared strings are in
   all six). Kannada, Marathi, Tamil and Telugu for the console need ~1,600 admin strings each.
6. **Live dashboard counts** — vehicles, drivers and fleet status cards (the demo dashboard has
   them); list endpoints return no totals.
7. **Filtered deep links** — Documents does not read a status filter from the URL, so "documents
   expired" opens the full list; Payments filters one status, so "failed or needs a check" opens
   the status-check filter.
8. **Shared screen header in the APK** — sub-screens each build the same navy header; a shared
   component was left for after the Phase 9 merge (see below) to avoid conflicts.

## Merging with the Phase 9 (production hardening) work

The uncommitted Phase 9 changes were set aside during this phase and restored afterwards on
`phase-9-production-hardening`, untouched. They overlap these files:

- `mobile/app.config.ts` — Phase 9 adds the release-build guard directly below the `API_URL` line
  this phase changed: one small conflict; keep the new production default *and* the guard. The
  guard checks the raw `EXPO_PUBLIC_API_URL`, so release profiles must still set it explicitly —
  consider checking the resolved `API_URL` instead.
- `mobile/src/app/(tabs)/updates.tsx`, `mobile/src/app/fuel/history.tsx` — Phase 9 rewrites the
  pending/rejected entry cards, which this phase deliberately left alone; when merging, format their
  amounts with `rupees()` from `lib/format` like the rest of the app.
- Locale files (`mobile/src/i18n/locales/*.json`, `src/i18n/en.json`, `src/i18n/hi.json`) — edited
  in different regions; they should merge cleanly.
- The backend root message that mentions `localhost` is removed by Phase 9 (`health.controller.ts`).
