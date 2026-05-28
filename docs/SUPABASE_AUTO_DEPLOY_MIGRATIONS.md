# Supabase — auto-deploy migrations on merge

How to stop running `supabase db push` by hand after every merge to `main`.

## TL;DR

Enable **Supabase's native GitHub integration** in the dashboard. It does
two things for free:

- **Preview branches**: every PR that touches `supabase/migrations/` gets a
  fresh ephemeral database with all migrations applied. Replay-safety bugs
  (the kind that bit us in [PR #355]) surface on the PR itself instead of
  on the next `db push`.
- **Auto-apply to prod**: when a migration-touching PR merges into `main`,
  Supabase applies it to the linked production project automatically.

No GitHub Actions minutes consumed, no secrets to rotate, no custom CI
job to maintain — Supabase owns the connector.

## One-time setup

1. Supabase dashboard → **Project Settings → Integrations → GitHub**.
2. **Connect repository** → select `louisianahelpr/louisianahelpr`.
3. Under **Branching**, set:
   - **Production branch**: `main`
   - **Auto-apply on merge**: enabled
   - **Preview branches**: enabled (one per PR that changes
     `supabase/migrations/`)
4. Confirm the production project ID matches `fncmgoasalhdgfwzhsqa`
   (cross-check: `grep project_id supabase/config.toml`).

That's it. The next migration PR that merges into `main` deploys to prod
without `supabase db push`.

## What changes for day-to-day work

| Step | Before | After |
| --- | --- | --- |
| Open a migration PR | CI smoke runs against a throwaway Postgres | CI smoke + Supabase preview branch both run |
| Merge to `main` | Engineer runs `supabase db push --linked` | Supabase applies on merge, no manual step |
| Roll back | `supabase migration repair --status reverted <ts>` + write inverse migration | Same — auto-apply doesn't change rollback semantics |

Preview branches give a real Postgres URL during the PR's lifetime — handy
for spot-checking RLS or running a one-off query against the branch's
state. URL appears in the PR's Supabase status check.

## Keeping the manual escape hatch

`supabase db push --linked` keeps working — useful when:

- The integration is paused (auth token expired, GitHub outage).
- Shipping a hotfix migration *before* the merge lands (rare, usually a
  bad idea — the merge should be the source of truth).
- Applying migrations to a *different* linked project (staging, fork).

## Updating the project guardrails

Once the integration is on, update `CLAUDE.md` to remove the *"Migrations
don't auto-deploy"* gotcha — that line is the reason we used to ship
graceful-fallback code for every new RPC. Auto-deploy doesn't eliminate
the graceful-fallback rule entirely (the merge and the auto-apply still
have a few-second gap), but the window shrinks from "until someone
remembers to push" to "until the integration runs."

## Cost

Free. Supabase ships the integration on every plan including Free.
Preview branches do incur compute time against your Supabase plan's
branch-hours quota, but the Free tier includes enough hours for typical
PR cadence — if we ever exceed it the dashboard surfaces a warning before
billing.
