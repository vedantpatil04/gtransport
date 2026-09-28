# Phase 6 — Live Fleet & Location Intelligence

Unzip over the project root. Every path below is relative to the repository root,
so the archive merges directly into the existing tree.

## One file is REMOVED by this phase

    backend/src/modules/drivers/dto/location-state.dto.ts

Delete it after unzipping. Its single DTO moved into the locations module and
grew the tracking fields; `ReportTrackingStateDto` in
`backend/src/modules/locations/dto/location.dto.ts` replaces it, and
`drivers.controller.ts` already imports from there. Leaving the old file in place
does no harm (nothing imports it), but it is dead code.

## After unzipping

    # Backend — one new migration, then regenerate the client
    cd backend
    npm install
    npx prisma migrate deploy        # applies 20260928000000_phase6_live_fleet_location
    npx prisma generate
    npm run typecheck && npm test
    npm run test:e2e                 # needs a PostgreSQL database whose name ends in _test

    # Driver app — expo-task-manager is new, so a fresh development build is required
    cd ../mobile
    npm install
    npm run typecheck && npm test
    npm run android                  # background location needs native modules, not Expo Go

    # Admin console
    cd ..
    npm install
    npm run typecheck && npm run i18n:check && npm run build

## Configuration

No new variable is required: every threshold has a working default. See the
"Fleet location tracking (Phase 6)" block appended to `backend/.env.example` for
the ones worth tuning — the stationary radius and duration above all, which
default to 150 m over 4 hours.

The map needs no API key. Live Fleet reuses the project's existing vector map of
the operating region, so there is no map secret to configure or to leak; see the
note appended to the root `.env.example`.

The driver app needs no new variable at all. Reporting intervals, the offline
buffer size and the batch size are served by the API
(`GET /locations/tracking-policy`), so tracking can be tuned from the server
without shipping a build to every driver's phone.

## Repository note

This archive contains only the files Phase 6 touched. The working tree it was
built from already carried uncommitted Phase 3–5 work; a few files below (for
example `backend/src/config/env.schema.ts`, `backend/prisma/schema.prisma` and
the i18n bundles) therefore contain those earlier edits as well as the Phase 6
ones, because the two cannot be separated within a single file. Nothing from
Phases 3–5 has been altered or removed.
