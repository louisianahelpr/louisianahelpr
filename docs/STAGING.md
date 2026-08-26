# Staging Supabase project

Created 2026-08-26. **Free tier, $0/month** — the organisation's second project,
which the free plan allows.

| | Production | Staging |
|---|---|---|
| Ref | `fncmgoasalhdgfwzhsqa` | `okpxtpfvwtmbuxugqsws` |
| Name | Louisiana Helpr | Louisiana Helpr — Staging |
| Region | us-east-1 | us-east-1 |

## Why this exists

Until now there was exactly one project, so **local development, the audit
sweeps, and every test account wrote to the live database.** The app warns
about it on every page load ("Local dev is pointed at PRODUCTION Supabase.
Every write goes to the live DB"). That single fact is the root of several
problems found during the launch audit, not merely a neighbour of them:

- Production became majority fixture data — 30 of 61 `jobs` rows and 20 of 23
  `profiles` were test rows, which inflated every admin money figure until
  `is_seed` was added and the aggregates were taught to exclude it.
- Test accounts for auth/signup flows had to be created against live auth.
- Any destructive test is unsafe by construction, so whole flows went
  unexercised.

## Local switch

`.env.staging` already holds the staging URL + publishable key (it is
gitignored, like every `.env*`). Publishable/anon keys are not secrets — they
ship in the client bundle. **Never** put a service-role key in it.

Nothing needs copying — Vite loads `.env.staging` for `--mode staging`, and
mode-specific values win over the base `.env`:

    npm run dev:staging   # local dev against STAGING
    npm run dev           # local dev against production (unchanged default)

Verified 2026-08-26: `loadEnv("staging")` resolves to `okpxtpfvwtmbuxugqsws`
while the default mode still resolves to `fncmgoasalhdgfwzhsqa`.

## Remaining setup — one step needs your password

The project is empty. Replicating the schema needs the database password,
which is set in the dashboard and is a credential, so it cannot be automated
from here:

1. Supabase dashboard → the **Staging** project → Settings → Database →
   **Reset database password**, and copy it.
2. Link and push all 471 migrations:

       npx supabase link --project-ref okpxtpfvwtmbuxugqsws
       npx supabase db push

Expect that push to be a real test of replay-safety. `CLAUDE.md` already warns
that a from-scratch rebuild runs every migration in timestamp order and that
unguarded DDL aborts it. **If it fails, that is a finding, not a setup
problem** — it means production's schema cannot currently be rebuilt from the
repo, which is worth knowing before launch rather than during an incident.

3. Optionally seed it. `scripts/seed-audit-jobs.sql` exists for exactly this,
   and on staging it can be run without polluting anything.

## What must NOT move to staging

Edge-function secrets, the Stripe **live** keys, and anything in the
`supabase/functions` environment stay pointed at production until deliberately
duplicated. Staging with live Stripe keys would be worse than no staging.
