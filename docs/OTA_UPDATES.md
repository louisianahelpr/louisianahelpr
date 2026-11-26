# OTA (live) updates for the iOS app

Owner decision 2026-11-25: "Yes set up the free self hosted version".

The iOS app is Capacitor: React/TypeScript built to `dist/` and bundled into the `.ipa`.
Without OTA every web change needs a new App Store build. With OTA, a web-layer change is
published on our own website and installed apps pick it up by themselves.

Free and self-hosted: the plugin is the open-source
[`@capgo/capacitor-updater`](https://github.com/Cap-go/capacitor-updater) (MPL-2.0) in
**manual mode**. There is no Capgo account and no Capgo cloud. Its update, channel and
stats URLs are blanked in `capacitor.config.ts`, so it never contacts Capgo.

## How it works

1. **On every cold start** (and on resume, at most every 6 hours), the app
   (`src/lib/ota/otaUpdater.ts`, iOS only, loaded lazily so the website never fetches it):
   - calls `notifyAppReady()`, which tells the plugin this bundle booted;
   - fetches `https://www.louisianahelpr.com/ota/ios/manifest.json` (HTTPS, our domain, no cache).
2. **Checks** (`src/lib/ota/otaManifest.ts`). All are mandatory and all fail closed:
   - shape: every file url is `https://www.louisianahelpr.com/...` (no other host is ever
     accepted), every file path is a safe relative path, and `index.html` is present;
   - **signature**: the file list hashes to `filesSha256`, and the ECDSA P-256 signature over
     the bundle fields verifies against the public key baked into the app;
   - `minNativeBuild` is at most the binary's build number (`App.getInfo().build`), so a
     bundle that needs newer native code is never applied to an old binary;
   - the bundle number (UTC build time) is higher than the running bundle's, so a fresh store
     build is never replaced by an older OTA bundle.
3. **Downloads in the background**, file by file. The plugin's native code hashes every file
   against its signed sha256 and refuses a mismatch. Files identical to the store build's own
   copy are reused, not downloaded, so an update only fetches what changed.
4. **Applies on the NEXT cold start** (`next()`), never mid-session.
5. **Automatic rollback**: if the new bundle does not call `notifyAppReady()` within 10 s
   (`appReadyTimeout`), the plugin marks it failed, deletes it and goes back to the last good
   bundle. A failed version is never retried.
6. **A new store binary** drops every OTA bundle (`resetWhenUpdate`) and runs its own.

## Shipping an update

From a worktree on current `origin/main`, with the change already merged:

```bash
OTA_SIGNING_KEY_FILE=~/.lh-ota/ota-signing-key.pem \
  node scripts/ota/build-ota.mjs --min-native-build <N>
```

- `<N>` is the lowest App Store build number (CFBundleVersion, e.g. the build shown in
  TestFlight) that has every native plugin and permission this bundle uses. Use the build
  number of the newest store build when unsure; older binaries then simply skip the update.
- The script runs `npm run build:ios`, hashes every file in `dist/` (sourcemaps excluded),
  points files that are byte-identical to `public/<same path>` at their website path, copies
  every other file to `public/ota/ios/files/<sha256>`, prunes files no longer used, signs,
  checks the signature against the app's baked-in key, and writes `public/ota/ios/manifest.json`.
- Commit `public/ota/ios/` and land it with the normal train (`scripts/land.sh`). The next prod
  deploy (prod-deploy.yml, within ~20 min, or `gh workflow run prod-deploy.yml`) serves it.
  Apps download it on their next start and run it on the start after that.
- Verify: `curl -s https://www.louisianahelpr.com/ota/ios/manifest.json | head` shows the new
  `bundle`.

The website never loads anything under `/ota/`: page speed is untouched. `vercel.json` gives
`/ota/` a CORS header (the app's origin is `capacitor://localhost`) and `no-cache`. The iOS
build drops `dist/ota` (vite plugin `ios-drop-ota-release`) so the app never carries a
release inside itself.

## Rolling back

- **Automatic**: a bundle that fails to boot is rolled back by the plugin (above).
- **By hand** (a bundle that boots but is wrong): revert the `public/ota/ios/` commit and
  re-run the script on the reverted main, so the corrected bundle gets a NEWER bundle number.
  (Re-publishing an older manifest does nothing: apps never install a bundle number lower
  than the one they run.) Land and deploy as above.
- **Stop all OTA**: delete `public/ota/ios/manifest.json` and deploy. Apps then keep what
  they run; a new store build resets them to the store bundle.

## What still needs a store build

Native changes: adding, removing or upgrading a Capacitor plugin, `Info.plist` or
entitlements changes, permission strings, app icon or splash, `capacitor.config.ts` changes,
anything in `ios/`, and changes to the OTA public key. Also any web change that calls a
native plugin method the installed binary does not have: set `--min-native-build` so older
binaries skip it.

## App Store compliance

Apple Developer Program License Agreement 3.3.1(B) (formerly 3.3.2) and App Review
Guideline 4.7 allow interpreted code (our HTML/CSS/JS run by WebKit) to be downloaded as long
as it does not change the app's primary purpose, does not create a store or storefront for
other code, and does not bypass signing, sandbox or OS security. We use OTA for fixes and
features of the same app only. Anything that changes what the app is goes through review.

## Key

- Private key: `~/.lh-ota/ota-signing-key.pem` on the release Mac (outside every repo and
  worktree, chmod 600). Backup: macOS Keychain item "LH OTA signing key (base64 PEM)",
  account `lh-ota` (`security find-generic-password -a lh-ota -s "LH OTA signing key (base64 PEM)" -w | base64 -d`).
- Public key: `OTA_PUBLIC_KEY_SPKI_B64` in `src/lib/ota/otaManifest.ts` (also in
  `~/.lh-ota/ota-signing-public.pem`).
- CI secret (optional, for publishing from Actions): `gh secret set OTA_SIGNING_KEY < ~/.lh-ota/ota-signing-key.pem`.
- If the private key is lost, OTA publishing stops until a store build ships a new public
  key. If it leaks, ship a store build with a new key at once (a leaked key lets someone who
  can also serve files on www.louisianahelpr.com sign a bundle).

## Files

- `src/lib/ota/otaManifest.ts`: validation, signature, decision (pure, tested)
- `src/lib/ota/otaUpdater.ts`: wiring to the plugin
- `src/lib/ota/otaCanonical.mjs`: the signed bytes, shared with the release script
- `scripts/ota/build-ota.mjs`: release script
- `src/test/otaUpdates.test.ts`: script-to-app end-to-end, integrity and decision tests
- `capacitor.config.ts` (`plugins.CapacitorUpdater`), `vercel.json` (`/ota/` headers)
