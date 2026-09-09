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

## The mirror axis: a column GRANT is mandatory where no table grant exists

Recorded 2026-09-09 alongside the above, because the two together are the
whole rule and either one alone is misleading.

The same migration's GRANT half was **load-bearing and did land**.
`authenticated` holds NO table-level UPDATE on `public.profiles` — only
column-level UPDATE on an allowlist — so without

```sql
GRANT UPDATE (onboarding_tour_completed_at) ON public.profiles TO authenticated;
```

every user's write would have failed 42501 forever, the tour would have kept
re-showing, and the diff would have read as correct. Verified twice against
prod, and the client write was then observed landing on a real row
(`onboarding_tour_completed_at` went from NULL to a timestamp 10s old, read
back from prod after a real signed-in session stamped it).

So, stated once:

- A column-scoped **REVOKE** is powerless against a table-level grant.
- A column-scoped **GRANT** is mandatory where no table-level grant exists.

Both are invisible in review, in opposite directions: the useless line looks
protective, and the missing line looks unnecessary. The only way to tell
which you have is to read the object back.
