# A column-level REVOKE cannot remove a table-level grant

**Filed 2026-09-09. Not a live vulnerability — a review-readability trap.**

`20260909175426_account_scoped_onboarding_tour_completion.sql` ends with

```sql
REVOKE ALL (onboarding_tour_completed_at) ON public.profiles FROM PUBLIC;
REVOKE ALL (onboarding_tour_completed_at) ON public.profiles FROM anon;
```

which follows the house rule in CLAUDE.md (name anon, never rely on PUBLIC).
It deployed successfully, and it achieved **nothing**. Verified against prod
immediately after `db-deploy` went green:

```
information_schema.column_privileges, column onboarding_tour_completed_at:
  anon=INSERT, anon=REFERENCES, anon=SELECT
  authenticated=INSERT, REFERENCES, SELECT, UPDATE   <- the GRANTs worked
```

Cause: `anon` holds **table-level** SELECT / INSERT / DELETE / REFERENCES on
`public.profiles` (pre-existing, table-wide, not introduced here). Column
privileges reported for a column include those inherited from the table
grant, and a *column-scoped* REVOKE can only remove a *column-scoped* grant.
Removing anon's reach would mean revoking at the table level, which is a much
larger change with its own blast radius.

**Why it is not a hole:** `pg_class.relrowsecurity = true` on profiles and
`pg_policies` returns ZERO policies naming `anon` or `public`. RLS with no
applicable policy denies every row, so the grant buys anon nothing today.

**Why it still matters:** this is the exact family CLAUDE.md already records
("a REVOKE that silently does nothing is worse than none, because it reads as
done in review"). The existing entry is about `FROM PUBLIC` not covering
`anon`; this is the second axis — **column scope not covering table scope** —
and the same instinct produces it. Anyone reading that migration concludes
anon was locked out of the column. Anon was never in scope to lock out, and
the line is decoration.

**Recommendations**
1. Verify a REVOKE by reading the object back (`column_privileges` /
   `pg_proc.proacl`), never by the migration applying cleanly. Same rule as
   re-measuring a fix's own number.
2. Decide separately whether anon should hold table-level INSERT/DELETE on
   `profiles` at all. It is inert behind RLS, but it is one dropped policy
   away from not being — and nothing in the schema explains why it is there.
   That is a real question for the authz lane, not a change to make casually.
