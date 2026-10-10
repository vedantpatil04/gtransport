# Driver app (Android APK): publishing and download

Drivers install the app from the public home page, <https://gtransportt.vercel.app>, whose **Driver? Download Android App** button points at the stable address

```
https://gtransportt.vercel.app/downloads/gangamata-transport.apk
```

That address is a Vercel redirect (`vercel.json`) to a **GitHub Release asset** on the public repository `vedantpatil04/gtransport`. The file itself is stored there rather than on Vercel because it is 139.7 MB: Vercel's limit is 100 MB per upload, and GitHub refuses any file over 100 MB in git. Release assets allow up to 2 GB. Nothing else (no server, no storage account) is involved.

The file is **not** in git (`mobile/.gitignore` ignores `*.apk`).

## What is published now (version 0.1.0)

| | |
|---|---|
| File | `gangamata-transport.apk` — 146,532,684 bytes (139.7 MB) |
| SHA-256 | `4def6f4d0b460c1fcc2cae7b0ce518324f587ed087f7194d0b1a366fed794107` |
| Package / version | `in.gangamatatransport.driver` · 0.1.0 · versionCode 1 |
| Android | 7.0 (API 24) and newer; arm64-v8a, armeabi-v7a, x86, x86_64 |
| Build | EAS cloud build with production settings: release, not debuggable, no dev launcher (the EAS project id is embedded; which profile produced it is not recorded in the file) |
| Signed with | EAS-managed (remote) credentials, v2 signature, SHA-256 `3f87695033cbe24babf3f91e9178f0921967f1fc76831277ecb08fe0a70d54e1` |
| Embedded config | `appEnv: production`, API `https://gtransport-7vgf.onrender.com`, console `https://gtransportt.vercel.app`; no localhost, emulator or LAN address |

These are recorded in `src/features/landing/driverApp.ts`, which the home page shows (version, size, SHA-256).

## Publish a release

1. On GitHub, open `vedantpatil04/gtransport` → **Releases** → **Draft a new release**.
2. Tag **`driver-v0.1.0`** (create it on publish), title *Gangamata Transport Driver app 0.1.0*.
3. Attach the file **named exactly `gangamata-transport.apk`** (the name is part of the address).
4. Publish (a pre-release is fine; the address uses the tag, not "latest").
5. Check it from your own computer:

   ```bash
   npm run verify:apk
   ```

   It follows the redirect, then confirms HTTP 200, a binary content type (never HTML), the exact size, the APK/ZIP signature and the SHA-256. It exits non-zero if anything differs.

## Publish a new version

1. Raise `version` **and `android.versionCode`** in `mobile/app.config.ts`. Android only updates an installed app when the versionCode is higher; the first release used 1.
2. Build with the same signing credentials — use the `client-apk` profile in `mobile/eas.json`, which uses the remote (EAS-held) credentials: `eas build --platform android --profile client-apk`. Never switch signing keys — an app signed with a different key cannot be updated in place and drivers would have to uninstall first (losing anything still waiting to sync).
3. Compute the size and `sha256sum` of the new file; update `src/features/landing/driverApp.ts` (version, size, checksum) and the tag in the `vercel.json` redirect (`driver-vX.Y.Z`).
4. Publish the release as above, then deploy, then `npm run verify:apk`.

## Notes

- Until the release asset exists, the redirect leads to a GitHub "not found" page. The rewrite in `vercel.json` deliberately excludes `/downloads/`, so a missing file is a 404 and never the app's `index.html` saved as an `.apk`.
- The build signed with the machine's *debug* keystore (`mobile/android/app/build/outputs/apk/release/app-release.apk`) is a different signature from the EAS one and is not the official download.
- An app installed from an APK signed with a different key — for example the builds made on this PC with the debug keystore — cannot be updated by this one: Android refuses with "App not installed". Make sure the old app has nothing waiting to sync, uninstall it, then install this one.
