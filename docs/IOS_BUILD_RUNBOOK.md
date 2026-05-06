# iOS Build Runbook

Reference for cutting iOS builds. Last updated when bumping `capacitor.config.ts` `ios.build` from 17 → 18 (workflow run #17, commit f3a520b).

## CFBundleVersion strategy

### Why we hard-force build numbers

App Store Connect rejects any upload whose `CFBundleVersion` is not strictly greater than every prior upload within the same `CFBundleShortVersionString` (`1.0.4`). When TestFlight uploads stack up during development, it is easy for the `ios.build` value in `capacitor.config.ts` to fall behind ASC's high-water mark.

The `ios-beta.yml` workflow accepts an optional `force_build_number` input that overrides whatever is in `capacitor.config.ts` for that specific archive. Use it any time the source-of-truth value is at or below ASC's latest accepted build.

### High-water mark today

| Run | Source build (`capacitor.config.ts`) | Forced override | CFBundleVersion in archive |
|-----|--------------------------------------|-----------------|----------------------------|
| #14 | 14 | 18 | 18 |
| #15 | 15 | 19 | 19 |
| #16 | 16 | 2029 | 2029 |
| #17 | 18 | 2030 | 2030 |

Next upload must use a number > 2030.

### Going forward — two options

**Option A: keep manual + bump source-of-truth in lockstep.** Bump `capacitor.config.ts` `ios.build` to `'19'`, `'20'`, etc. as releases ship. When the override is no longer needed (source value clears ASC's high-water mark on its own), stop passing the workflow input. Pro: source-of-truth file tells you what's running. Con: requires discipline; one missed bump and the next upload silently rejects.

**Option B: CI-injected `${{ github.run_number }}`.** In `.github/workflows/ios-beta.yml`, replace the build-number step with something like:

```yaml
- name: Set CFBundleVersion to GH run number
  run: |
      /usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${{ github.run_number }}" ios/App/App/Info.plist
      ```

      GitHub run numbers are monotonic and global to the workflow file, so they always go up. Pro: zero human input, no rejection risk. Con: build numbers will look like `25465418978` on TestFlight; not human-pretty.

      **Recommended:** Option B for staging/TestFlight, Option A for App Store releases (so the numbers in the public release notes look reasonable).

      ## Triggering a TestFlight build

      1. Visit https://github.com/louisianahelpr/louisianahelpr/actions/workflows/ios-beta.yml
      2. "Run workflow" → branch `main` → optionally fill `force_build_number` (must be > current ASC max)
      3. Watch CI: typical archive + upload runs ~6–7 minutes
      4. ASC processes the upload for another ~10–15 minutes before the build appears in TestFlight
      5. Internal testers can install once processing completes; external testers require Apple review

      ## When CI fails

      - **"Redundant Binary Upload"** → CFBundleVersion already exists in ASC. Force a higher number via workflow input.
      - **"No matching profiles found"** → Distribution cert or provisioning profile drift. See `docs/APPLE_CERT_RUNBOOK.md`.
      - **"Code signing identity not found"** → The .p12 base64 secret in repo settings has rotated or expired. Regenerate from Apple Developer → Certificates.

      ## Bumping `version` (CFBundleShortVersionString)

      Edit `capacitor.config.ts` `ios.version`. App Store-visible version. Bump on every public release. When `version` increments, ASC's CFBundleVersion monotonic check resets within the new version namespace, so build numbers can drop back to a low value if desired.
      
