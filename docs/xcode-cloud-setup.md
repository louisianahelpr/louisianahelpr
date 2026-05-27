# Xcode Cloud setup

Free iOS CI for Apple Developer Program members — replaces the expensive GitHub-Actions `macos-15` workflows that drove the May 2026 Actions overage bill.

## Why this exists

The `ios-beta.yml` and `deploy.yml` workflows shell out to `macos-15` GitHub-hosted runners (~$0.16/min). A daily cron + a heavy iteration burst on 2026-05-19/20 added up to ~$16 of overage on what's supposed to be a Free-plan account. The nightly cron was disabled in PR #347; the workflows remain as a manual fallback.

**Xcode Cloud** is Apple's own CI, included with Developer Program membership (no per-minute billing for the first 25 compute hours/month). It builds the iOS app on Apple-managed macOS workers and pushes to TestFlight without ever touching GitHub-billed minutes.

## What's already in the repo

- `ci_scripts/ci_post_clone.sh` — Xcode Cloud invokes this immediately after cloning. It installs Node, runs `npm ci`, builds the Vite web bundle (`npm run build:ios`), and `cap sync`s the bundle into `ios/App/App/public/` so the Xcode build picks up the latest web assets.
- `ios/App/App.xcworkspace` — the workspace Xcode Cloud will build.
- `fastlane/ios_app_metadata.yml` — the App Store record source-of-truth. Xcode Cloud reads `MARKETING_VERSION` + `CURRENT_PROJECT_VERSION` from the Xcode project, which `bundle exec fastlane ios sync_xcode_metadata` keeps in sync with this YAML. Run that lane locally any time you bump the version, then commit, before triggering the Xcode Cloud workflow.

## One-time setup (you do this in Xcode)

Xcode Cloud workflows are created interactively in Xcode — there's no YAML to drop into the repo. Roughly 10 minutes:

1. **Open the workspace in Xcode:** `open ios/App/App.xcworkspace`.
2. **Product menu → Xcode Cloud → Create Workflow.**
3. **Choose the product:** select `App` (the iOS scheme), not `App (extension)` or any other variant.
4. **Authorize GitHub access:** Xcode prompts to connect a GitHub account. Pick your `louisianahelpr` account. Apple's GitHub App requests `Read` access to the repo (it does NOT need write).
5. **Workflow trigger** — pick one:
   - **Push to `main`** (recommended for ongoing TestFlight delivery): every merge to main fires a build.
   - **Manual** (recommended if you'd rather control timing yourself): no auto-trigger; you press a button in Xcode or App Store Connect when you're ready.
   - **Tag pattern `v*`** if you want releases coupled to git tags (matches the `deploy.yml` `release` lane behavior).
6. **Workflow actions** — add at least:
   - `Build` (Archive variant) → required.
   - `TestFlight Internal Distribution` → uploads the build to TestFlight automatically once `Build` succeeds.
7. **Save.** Xcode runs the first build immediately to validate.

## Environment variables

`ci_post_clone.sh` references no secrets — it only needs Node + the repo contents. The signing certs and TestFlight upload are managed by Xcode Cloud directly via App Store Connect (no `ASC_KEY_ID` etc. to set, unlike the GitHub Actions workflow).

If a future custom script needs an env var, add it via App Store Connect → Xcode Cloud → Workflows → \<your workflow\> → Environment.

## Migrating away from GitHub Actions

Both pipelines can run in parallel during the transition. When Xcode Cloud has shipped a few TestFlight builds successfully:

1. Delete `.github/workflows/ios-beta.yml` (the schedule is already commented out from PR #347; full removal is safe once you're not relying on the `workflow_dispatch` fallback).
2. Delete `.github/workflows/deploy.yml` if you're also using Xcode Cloud for App Store release submissions. Keep it if you still use the `release` lane locally via `bundle exec fastlane ios release`.
3. The `fastlane/` directory itself can stay — the `metadata`, `release`, and `sync_xcode_metadata` lanes are still useful for managing App Store listing content from CLI without needing Xcode open.

## Cost ceiling

Apple's Developer Program includes 25 Xcode Cloud compute hours per month. Beyond that, Apple bills $0.10/hour (~$0.0017/min) — over **50× cheaper** than GitHub's `macos-15` rate. A typical 8-minute build burns 0.13 hours of the included allowance.

If a workflow loop ever runs away, App Store Connect → Xcode Cloud → Workflows lets you pause it instantly.

## Troubleshooting

**"Cannot find ci_post_clone.sh"** — Xcode Cloud looks for `ci_scripts/` at:
1. The repo root (where we placed it).
2. Alongside `.xcworkspace` (`ios/App/ci_scripts/`).
3. Alongside `.xcodeproj` (`ios/App/App.xcodeproj/../ci_scripts/`).

If Xcode Cloud reports the script is missing, double-check the location matches one of the above. We use the repo-root location because it's the most discoverable.

**"node: command not found" mid-build** — `ci_post_clone.sh` installs Node via Homebrew. If Xcode Cloud's image silently drops Homebrew in a future update, fall back to downloading Node from nodejs.org/dist directly. The script is structured to fail loudly (`set -e`) so the build aborts before Xcode wastes time on a stale `dist/`.

**"App is locked / waiting for upload"** — when both GitHub Actions and Xcode Cloud build the same `CURRENT_PROJECT_VERSION`, App Store Connect rejects the second with `Redundant Binary Upload`. Disable one pipeline before letting them race.
