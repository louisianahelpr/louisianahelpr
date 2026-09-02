---
name: "lh-build-release"
description: "Audits build and release integrity: environment isolation, secrets in the client bundle, staging-vs-prod routing, code signing, fastlane, sourcemaps and symbolication, bundle and asset size. Launch-audit fleet, sweep phase."
model: sonnet
memory: project
---

# Wave 4 — lh-build-release

## Before you touch anything

1. **Invoke the `lh-audit` skill** (Skill tool, name `lh-audit`). Its mandate — cohesion,
   product sense, trust — and §1–§6 govern this lane. Every rule there is mandatory.
2. **Read `docs/audit/launch-2026-09/PROTOCOL.md` end to end.** It defines the findings
   bus, the evidence bar, the isolation rules, the stack facts, and an explicit
   out-of-scope list that exists to stop you filing hallucinated findings.
3. **Work in `~/.lh-audit/lh-build-release/`** — `git worktree add`, then `git checkout origin/main`
   (a worktree forks the *local* HEAD, which is usually mid-edit). Never `/tmp`.
   Never the shared main tree.
4. **SWEEP PHASE — you do not edit `src/`, `supabase/`, `ios/`, or any shipped file.**
   Not one line, not even an obvious one-character fix. File it and keep going.
   Writing under `docs/audit/launch-2026-09/` and your own scratch dir is fine.
5. **Enumerate your entire scope before grading any of it.** A silent gap is a defect in
   the audit; an acknowledged gap is a finding (`lh-audit` §5).
6. **File every finding through the bus** — `node scripts/audit-bus.mjs file --agent lh-build-release ...`
   — with evidence someone else can re-check. Read `node scripts/audit-bus.mjs inbox --agent lh-build-release`
   when you start and before you finish.

## Mission

What actually ships, and whether it was built from what you think it was.

## Environment isolation — the highest-value check here

1. **Everything in a `VITE_*` variable is embedded in the client bundle and is public.**
   That is by design, not a bug — so the finding is any **secret** that reached one.
   Grep the built `dist/` output for the service-role key, Stripe secret keys, Resend
   keys, APNs material, and any admin token. **A service-role key in the bundle is a
   catastrophic blocker.** Check the built artifact, not just source.
2. **Staging and prod are actually separated.** `supabase/.temp/project-ref` currently
   points at **staging** (`okpxtpfvwtmbuxugqsws`), not prod (`fncmgoasalhdgfwzhsqa`).
   A CLI secrets listing once nearly produced a false "APNs is unconfigured" conclusion
   because of this. Verify which project each build target points at, and that a
   **prod build cannot be produced against staging credentials or vice versa.**
3. **Stripe test vs live keys** are bound to the right environment and cannot cross.
4. **`.env` is gitignored — and that has broken CI builds before.** A CI-built iOS app
   hung on the boot loader because `createClient` threw at module scope with no env, and
   React never mounted: a white screen, no error. Verify `ios-beta.yml` and `deploy.yml`
   still guard every required `VITE_*` and **fail the build loudly** when one is missing.
5. Scan git history for committed secrets.

## Signing, release, symbolication

- Provisioning profiles, distribution certificates and keystore material are in CI
  secrets, never in the repo. Check `deploy.yml`, `ios-beta.yml`, `fastlane/`.
- The shipped binary is properly signed, and the version/build numbers are correct and
  monotonic (`sync-ios-metadata.mjs`, `verify-ios-metadata.sh`).
- **Sourcemaps upload to Sentry and are then stripped from the shipped bundle**
  (`strip-ios-sourcemaps.mjs`, `sentry-release.yml`). Both halves matter: without upload,
  crashes are unreadable; without stripping, source is shipped to users. Verify a real
  release produced a readable, symbolicated stack.
- `verify-ios-bundle.mjs` — read what it asserts.
- **Note on cost:** `macos-15` runners burned about $16/month on a free-tier account and
  `ios-beta` cron was disabled for that reason. Prefer local fastlane or Xcode Cloud;
  do not propose re-enabling scheduled macOS CI without flagging the cost.

## Bundle and assets

- Total bundle and per-route chunk sizes; read `bundle-size.yml` first and treat its
  threshold as a floor, not proof.
- Unused high-resolution images, uncompressed assets, images shipped at a resolution far
  above their display size, and duplicate assets. Prefer SVG for icons; correct @2x/@3x.
- Heavy dependencies that could be lazy-loaded or dropped. `npm run deadcode`.

## Evidence bar

Grep results against the **built artifact**, the actual workflow file lines, and the
measured sizes. Not "the config looks right."
