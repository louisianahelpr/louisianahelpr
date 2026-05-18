# iOS Build Runbook

Reference for cutting iOS TestFlight builds. Last verified against
workflow run #26005470509 — build `1.0.4 (2501)`, 2026-05-18.

## TL;DR

Trigger the **iOS Beta (TestFlight)** workflow on `main`. CI archives,
signs, uploads, and waits for App Store Connect processing — there is
nothing to do locally, and you do not manage build numbers.

## Triggering a build

Either:

- **GitHub UI** — Actions tab → "iOS Beta (TestFlight)" → "Run workflow"
  → branch `main`.
- **CLI** — `gh workflow run ios-beta.yml --ref main`.

Then:

1. CI archives + signs + uploads, then blocks on App Store Connect
   processing — typically ~6–7 minutes end to end.
2. When the run goes green the build is **already processed and live in
   TestFlight** — the Fastlane lane waits on processing, so there is no
   separate countdown afterward.
3. Internal testers can install immediately; external testers need
   Apple's review.

## Build numbers — handled automatically

App Store Connect rejects an upload whose `CFBundleVersion` is not
strictly greater than every prior upload within the same
`CFBundleShortVersionString`. The Fastlane `beta` lane handles this: it
uses the **highest** of —

- `ios.build` in `capacitor.config.ts` (a static fallback),
- the latest build already on App Store Connect (queried live via
  `latest_testflight_build_number`),
- a monotonic CI-derived value,
- the optional `build_number_floor` workflow input.

Run #26005470509 logged the decision directly:

```
Using unique build number 2501 for version 1.0.4
  (local 20, remote-for-version 2301, remote-any-version 2301, ci 2501, floor 2302)
```

So in normal operation **you never set a build number** — the CI-derived
value is monotonic and clears ASC's high-water mark on its own.
`capacitor.config.ts` `ios.build` is only a floor and may lag freely
behind reality.

### `build_number_floor` (optional override)

`ios-beta.yml` exposes one optional `workflow_dispatch` input,
**`build_number_floor`** — "force the build number to be at least this
value." It is only needed in the rare case ASC's API lags and reports a
stale latest build; pass a value comfortably above ASC's real maximum.
Leave it blank otherwise.

## When CI fails

- **"Redundant Binary Upload"** — `CFBundleVersion` already exists on
  ASC. Rare now that the lane queries ASC live; if it happens, re-run
  with `build_number_floor` set above ASC's maximum.
- **"No matching profiles found"** — distribution cert / provisioning
  profile drift. See `docs/APPLE_CERT_RUNBOOK.md`.
- **"Code signing identity not found"** — the `.p12` base64 repo secret
  has rotated or expired. Regenerate from Apple Developer → Certificates.

## Bumping the version

`CFBundleShortVersionString` (the App Store-visible version) comes from
`capacitor.config.ts` `ios.version` (currently `1.0.4`). Bump it for
each public release. ASC's monotonic build-number check is scoped per
version string, so build numbers may restart low under a new version.
