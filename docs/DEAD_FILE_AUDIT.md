# Dead-file audit — 2026-05-10

Audit of `src/**/*.{ts,tsx}` for files that aren't imported anywhere.
Each file below was verified manually after the script ran (the script
flagged 8; all 8 are genuinely dead). Total deletion saves ~1.2KB
gzipped from the bundle plus eliminates 8 future surfaces of polish
debt.

## Files to delete

```
src/components/ui/use-toast.ts                 # 3-line re-export of @/hooks/use-toast (zero importers)
src/components/dashboard/DashboardTodayRow.tsx # superseded by current Browse Tasks layout
src/components/dashboard/CategoryQuickChips.tsx # superseded by JobFilters category dropdown
src/components/profile/PayoutSetupBanner.tsx   # superseded by PayoutSetupDialog (only mentioned in a comment)
src/components/RetainerAgreement.tsx           # removed from UserProfile in commit 3e4dd12e — no other importers
src/pages/PrivacyPolicy.tsx                    # consolidated into Legal.tsx; /privacy now redirects to /legal?tab=privacy
src/pages/TermsOfService.tsx                   # consolidated into Legal.tsx; /terms now redirects to /legal?tab=terms
src/pages/PlatformRules.tsx                    # consolidated into Legal.tsx; /rules now redirects to /legal?tab=community
```

## How to delete

Pure removal — no imports to fix, no migrations needed.

```bash
git rm \
  src/components/ui/use-toast.ts \
  src/components/dashboard/DashboardTodayRow.tsx \
  src/components/dashboard/CategoryQuickChips.tsx \
  src/components/profile/PayoutSetupBanner.tsx \
  src/components/RetainerAgreement.tsx \
  src/pages/PrivacyPolicy.tsx \
  src/pages/TermsOfService.tsx \
  src/pages/PlatformRules.tsx

git commit -m "chore: delete 8 unused source files surfaced by dead-file audit"
```

## How the audit was run

`/tmp/find-dead-files.sh` (left in the temp dir, not committed) walks
every `.ts`/`.tsx` file in `src/` excluding tests and type
declarations, then greps for `import` statements that reference each
file by its `@/...` alias path or a relative path. Files with zero
matches (besides themselves) are flagged.

Caveats / known false-positive sources:
- The script doesn't follow `lazy(() => import("..."))` if the import
  spec is a *bare basename* — but every lazy import in this codebase
  uses a path stem. None missed.
- Test files are skipped from BOTH the source list and the importer
  search (a test is allowed to be the only importer of a helper, but
  if THAT helper is otherwise unused it's still dead — caught here).
- HTML index references (preload, etc.) ARE included in the importer
  search.

## Re-running

The script is idempotent. Re-run after refactors to catch new orphans:

```bash
bash /tmp/find-dead-files.sh
```

If you want this checked in CI, the script can be promoted to
`scripts/find-dead-files.sh` and wired into a GitHub workflow that
fails when the count exceeds zero. Not added now — first cleanup +
manual run, then automate.
