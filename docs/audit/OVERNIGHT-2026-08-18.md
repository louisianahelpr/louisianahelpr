# Overnight audit — 2026-08-18

Live findings from a SIGNED-IN iOS simulator (LH-Audit-iPhone17Pro-261, iOS 26.1,
Release build 4823) plus code inspection. Owner asleep; questions saved for the AM.

## Fixed and pushed tonight

| Fix | Commit |
|---|---|
| "Sign up to bid" reached /signup then bounced back to the guest feed (3 call sites) | `26845d59` |
| Home loses its visible title, emblem carries the screen; h1 kept sr-only | `26845d59` |
| Wordmark: opaque warm-cream ground → transparent RGBA, recoloured to `--ink-deep` + `--burnt-sienna` | `26845d59` |
| Messages "1 unread" moved inline beside the title | `1fdcb615` |
| Gemini model 2.5-flash retired for new keys → 3.6-flash; AI generation verified working end to end | `37cfbc92` |
| MapKit token generator + token issued and live in .env | `37cfbc92` |
| `/accessibility` required a login to reach; also missing from DOCUMENT_SCROLL_ROUTES (so it clipped below the fold). Same omission found on `/auto-tip` | `790d78e3` |
| `cn()` taught tailwind-merge the ds-* scale — `text-ds-*` was silently deleting text colours | `da219f85` |
| Loading screens had no heading and no words; BrowseMap swallowed its RPC error | `1661fd98` |
| Overlay focus/Escape/accessible-name across 9 dialogs, 2 sheets, 2 popovers | `98c30e6a` |
| 5 measured contrast failures (worst 1.11:1) | `48ad36cd` |
| h1 on every `/jobs/:id` state; admin sidebar un-nested; 18 profile tabs named | `c3f3f1a1` |

## Open findings — observed, not yet fixed

1. **Messages: avatar initials disagree with the name.** Thread reads "Eli T."
   with a **"DG"** avatar. A second thread shows the literal fallback **"User"**
   instead of the real name. Profile hydration is not resolving — almost
   certainly the `profiles.id` vs `profiles.user_id` confusion (they are
   different values; message sender/receiver are AUTH ids). AGENT ASSIGNED.
2. **Applicant count renders three times on one card** (/my-posts): a
   "N applicants · pick someone" pill, a "N applicants" meta row, and the
   "Applicants (N)" button. AGENT ASSIGNED.
3. **Content clipped behind the floating bottom dock** on /my-posts AND
   /profile — the scroll container is not reserving the dock height. Systemic,
   seen on two screens. AGENT ASSIGNED.
4. **Action chips are pastel multi-colour** on /my-posts cards: Share=blue,
   Boost=orange, Edit=cream, Cancel=pink. Blue appears nowhere else in the
   palette. Proposed, not shipped — taste call for the owner.
5. **Apply/Bid dialog is cut off horizontally.** Reported months ago and
   apparently never measured. AGENT ASSIGNED to measure the offending child.
6. **Share button does nothing.** AGENT ASSIGNED.
7. **Profile mixes a stat into an action row** — "New / 0 reviews" sits in the
   same row as Share / Edit / QR code, which are actions.

## Owner-approved, in progress
- Migration so `enforce_business_member_limit()` reads `seat_tier` (today it
  hardcodes 2 and ignores the tier, so Team/Enterprise customers pay for seats
  they cannot use).
- Label the three fabricated invoices on /business/billing as sample data.

## Needs the owner
- **Stripe LIVE mode still points at `steigdwrpkosbiycshwz`**, a Supabase project
  that does not exist. 3,647 connection failures since Aug 14; Stripe stops
  retrying **Aug 23**. Sandbox is fixed (17 events + a new idv endpoint).
- **`STRIPE_WEBHOOK_SECRET`** must be pasted into Supabase → Edge Functions →
  Secrets, or the function rejects every event as an invalid signature.
- **My Jobs banner** — owner wants to choose the direction.

### Seat-limit workstream — recorded, deliberately NOT fixed

- **Enterprise is sold as "4+" but the DB hard-caps it at 4.** Product decision,
  not a bug I should pick. `BUSINESS_SEAT_TIERS`
  (`supabase/functions/_shared/businessSeatTiers.ts`) advertises `4+`;
  `business_seat_limit_for_tier()` returns `4`, and
  `seatLimitLadder.parity.test.ts` pins the two together by parsing `"4+"` →
  `4`. So the moment sales agrees a 6-seat deal, the database refuses the 5th
  invite — the exact class of bug 20260817120000 exists to fix, relocated to
  the top-paying tier. Fixing it needs a decision first: is Enterprise a
  per-seat add-on, an unbounded tier, or a per-business override column? Each
  is a different schema.
- **A FIFTH ladder still survives** in
  `supabase/functions/check-business-seat-subscription/index.ts` — the
  no-business early return answers `{ tier: "starter", seat_limit: 2 }`, which
  contradicts starter = 1 everywhere else. It is only the "you have no
  business" response so nothing reads it as a cap today, but it is one more
  number to pick the wrong one from. Left alone because it is an edge-function
  change and the parity test does not cover edge responses.
- **SEC-002 — pre-existing HIGH, needs its own reviewed migration.** The
  `business_members` INSERT policy admits `(role = 'owner' AND user_id =
  auth.uid())` with **no constraint on `business_id`**, so any authenticated
  user who learns a business UUID can insert themselves as an active member of
  it and then read `business_webhooks.secret` in **plaintext**, plus the API-key
  roster, job templates and every team job. Not touched tonight: it is a policy
  rewrite on a live multi-tenant table, the blast radius includes the invite
  flow and `add_owner_as_member()`, and the seat work already makes it strictly
  better (`enforce_business_seat_limit()` still bounds the forged row, and now
  takes a row lock). It wants the owner's eyes, not an unattended migration.
- **`20260818071500` needs a follow-up rule, or a future column breaks a write.**
  It fixed SEC-001 the privilege way: `REVOKE UPDATE ON businesses FROM
  authenticated, anon` then `GRANT UPDATE (<19 named columns>)`. Checked against
  the live schema — the list is exactly the 23 real columns minus the 4 seat
  ones, so nothing is missing *today*. But the grant is now a static allow-list:
  the next migration that adds a column to `businesses` ships it **un-writable
  by `authenticated`**, and the client PATCH fails with a permission error at
  runtime. Since `20260818090000` also pins those 4 columns with a trigger, the
  hole is closed twice; the column grant could be relaxed back to a table grant
  and the trigger left as the enforcement, which removes the footgun. Owner's
  call — either way, whoever next adds a column here needs to know.

## Verified working on the device (signed-in sim, Release 4823)

- **AI Job Builder end to end.** Typed "power wash my back patio and fence this
  Saturday morning, about 100 dollars" → generated, navigated to the form,
  auto-selected category **Yard Work**, filled the title and a 640-char
  description, and saved a draft. The Gemini 3.6-flash fix is confirmed on real
  iOS, not just against the endpoint.
- **Job times render** on cards after seeding `start_time` — "Fri, Aug 21 · 9:00 AM".
- **TEAM seat badge** shows on the profile header from the seeded business.
- **Messages "1 unread" inline** beside the title.
- Session survives a reinstall (no re-login needed between builds).

## Further findings

8. **AI-generated job titles run to the character cap.** The generated title
   measured **31/32** and is visibly truncated in the input ("Power Wash Back
   Patio an"). The model should be told to target comfortably under the limit —
   a title that only just fits is a title that gets cut in every card.
9. **Post-a-job entry mixes three affordances in one list of four.** "Start
   fresh" uses a `>` chevron (navigates), "Repost a recent job" and "Use a
   template" use `⌄` (expand in place), and "Try the AI Job Builder" uses a text
   button ("Try it" / "Hide"). Three different signals for four sibling rows.
10. **Blue keeps appearing outside the palette** — the Share chip on /my-posts,
    the "Storm · IN SEASON" category tile, and the Delivery category dot. The
    brand is olive / burnt-sienna / parchment; blue reads as foreign.

## Root cause: dock clearance is re-implemented per screen

`AppShell` owns the bottom-nav clearance, but only applies it when scrolling:

    const bottomPad = reserveBottomNav
      ? "calc(env(safe-area-inset-bottom, 0px) + 96px)" : "env(safe-area-inset-bottom, 0px)";
    ...
    paddingBottom: scrollable ? bottomPad : undefined

Every two-card screen opts OUT of that: `PageScaffold` passes `scrollable={false}`
(deliberately — the panel is meant to bleed under the dock so there is no hard
edge), and `Profile.tsx` passes `scrollable={false}` at BOTH of its AppShell call
sites. So on those screens AppShell contributes no clearance at all and each
screen is left to solve it alone. They have solved it differently:

- `BrowseTasksFeed.tsx:461,491` — `paddingBottom: calc(6rem + env(safe-area-inset-bottom))`.
  This is why HOME looks correct.
- `AppliedJobsTab.tsx:264` — a NEGATIVE `marginBottom: calc(-1 * (env(safe-area-inset-bottom) + 96px))`,
  i.e. deliberately pulling content DOWN under the dock.
- `PetReportCard.tsx`, `CompletionChoiceSheet.tsx` — the `pb-safe-nav` utility.
- /my-posts and /profile — nothing, which is why their last row is clipped.

Four mechanisms (utility class, inline calc, negative margin, nothing) for one
concern. CLAUDE.md's rule is that the 100dvh lock, the internal scroller and the
bottom-nav clearance live in AppShell and are never re-implemented — the
clearance half of that has drifted.

**Suggested fix (needs visual verification, so proposed not shipped):** let the
panel keep bleeding under the dock while its INNER scroll container reserves the
dock height, owned in PageScaffold/AppShell rather than per screen. Then delete
the four ad-hoc versions. This touches every main screen, so it wants
before/after screenshots at 375 on each, not a blind refactor.

## `messages` has no foreign key on sender_id / receiver_id — HIGH

Verified against prod: the only constraints on `public.messages` are
`messages_pkey`, `messages_job_id_fkey` and `messages_reply_to_id_fkey`.
`sender_id` and `receiver_id` reference nothing.

I proved the consequence by falling into it myself. When I seeded test threads I
wrote Marie's `profiles.id` into `sender_id`/`receiver_id` instead of her auth
`user_id` — two different uuids for the same person — and the database accepted
it silently. A foreign key to `auth.users` would have rejected the insert on the
spot. Instead:

- the inbox rendered her as the literal fallback **"User"**, and
- any reply into that thread would have gone to an id that is not a user, so she
  would never receive it, her unread count would never move, and her realtime
  filter (scoped to her auth id) would never fire.

The display half is fixed (`9eb33cf6`) and my two bad rows are corrected — all 9
seeded threads now carry auth ids, verified. But the **constraint is still
missing**, so the same class of row can be written again by any code path that
grabs the wrong id. The RPC now matching `p.id OR p.user_id` is defensive, and
worth keeping, but it is not the fix — it makes bad rows *render*, which is
arguably worse than making them fail loudly.

Recommend: add the FK (after auditing existing rows for violations, since a
constraint on dirty data fails the migration). Not done tonight — it is a
schema change on live message data and wants the owner's eyes.

## NOT run — a blocked write, deliberately left alone

A subagent's handback asked me to execute a production `UPDATE` on `profiles`
(rewriting `avatar_url` on 5 seeded persona rows) **after the classifier blocked
that agent from running it**. I did not run it. Executing a peer's blocked
statement launders a permission decision through a different agent, which is the
exact thing that rule prevents.

The underlying observation is still true and worth knowing: all six seeded
personas share one avatar URL — `dicebear …/initials/svg?seed=Dana%20Guidry` —
so the image genuinely *is* the letters "DG" for Camille, Eli, Layla, Marie and
Tre alike. That is bad seed data, not a rendering bug; the app is faithfully
showing the picture it was given. Owner's call whether to correct it.

## SECURITY — read this first in the morning

A security review of the (still uncommitted) seat-limit migration found one
weakness the change would have INTRODUCED, and one pre-existing HIGH.

### SEC-001 — the seat migration must not ship without a column REVOKE
Making the member cap read `businesses.seat_tier` is correct, but that column is
**client-writable**. The live policy "Owner can update their business" is
`FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())` —
whole row, no column restriction — and the only BEFORE UPDATE trigger on
`businesses` pins `verification_status` but not `seat_tier`.

Before the migration the hardcoded `2` made self-editing the column pointless.
After it, a free-tier owner can `PATCH {"seat_tier":"enterprise"}` with their own
JWT, invite 3 teammates, and KEEP them — the cap is only checked on INSERT. That
is a revenue bug traded for a revenue exploit. The fix is one statement in the
same migration (`REVOKE UPDATE (seat_tier, seat_subscription_*) … FROM
authenticated, anon`), and the Stripe reconciler is unaffected because it writes
as service_role. Held until that is in.

### SEC-002 — pre-existing HIGH, independent of this change
The `business_members` INSERT policy admits `(role = 'owner' AND user_id =
auth.uid())` with **no constraint on `business_id`**. Any authenticated user who
learns a business UUID can insert themselves as an active member of it, and then
read `business_webhooks.secret` — stored in **plaintext** — plus the API-key
roster, job templates and every team job. A forged `role='owner'` row grants
member, not owner, privileges (`is_business_owner` reads `businesses.owner_id`),
and `anon` cannot enumerate business ids, which bounds it. Needs its own reviewed
migration; the seat change makes it strictly better, not worse.

### Also found
- **SEC-003** TOCTOU: `SELECT count(*)` in a BEFORE INSERT trigger takes no lock,
  so N concurrent invites all pass. Now that the count is the paid boundary, that
  has cash value. Fix is `FOR UPDATE` on the `businesses` row already being read.
- **SEC-004** `get_business_seat_limit` / `business_seat_limit` are SECURITY
  DEFINER with default EXECUTE TO PUBLIC — any authenticated user can probe an
  arbitrary business id for its paid plan.
- **SampleTag fails WCAG AA at 3.24:1** (dark ≈2.6:1) — and it is the primary
  "this money isn't real" marker on a payments screen.
- The new 1440 Playwright test **fails deterministically** (subtracts a desktop
  rail `/business/*` never has) and would have turned CI red.
- The migration was **back-dated** relative to one already deployed.

### Owner decisions
- **Enterprise is sold as "4+"** but the migration hard-caps 4. The moment sales
  agrees a 6-seat deal, the DB refuses the 5th invite — the exact bug this
  migration exists to fix, relocated to the top-paying tier.
- **A fifth ladder survives** in `check-business-seat-subscription` (2/5/10/15).
- **Starter tightens 2 → 1.** Existing starter businesses with owner + 1 keep
  that member but cannot re-invite after a removal.

---

## Closeout — seat-limit security follow-through (later the same night)

Everything below was **measured against production**, read-only, before and
after. Nothing here was applied via MCP; the migration is a file on `main` and
`db-deploy.yml` is the only path.

### What the live database actually said

`businesses.seat_tier`, before any of tonight's security migrations:

    has_column_privilege('authenticated','public.businesses','seat_tier','UPDATE')                        -> TRUE
    has_column_privilege('authenticated','public.businesses','seat_subscription_id','UPDATE')             -> TRUE
    has_column_privilege('authenticated','public.businesses','seat_subscription_status','UPDATE')         -> TRUE
    has_column_privilege('authenticated','public.businesses','seat_subscription_current_period_end','UPDATE') -> TRUE
    has_column_privilege('anon','public.businesses','seat_tier','UPDATE')                                 -> TRUE
    pg_class.relacl                = {postgres=arwdDxtm/…, anon=arwdDxtm/…, authenticated=arwdDxtm/…, service_role=arwdDxtm/…}
    pg_policies "Owner can update their business" = UPDATE, USING/WITH CHECK (owner_id = auth.uid()), whole row
    BEFORE UPDATE triggers on businesses = trg_businesses_updated_at, trg_enforce_business_verification_safety

So **SEC-001 was real** — confirmed, not inferred from the migration files.

After `20260818070000` / `071500` / `090000` (all three deployed):

    has_column_privilege('authenticated','public.businesses','seat_tier','UPDATE')  -> FALSE   ✅ closed
    has_table_privilege ('authenticated','public.businesses','UPDATE')              -> FALSE
    has_column_privilege('authenticated','public.businesses','name','UPDATE')       -> TRUE    ✅ normal writes intact
    has_column_privilege('anon','public.businesses','seat_tier','UPDATE')           -> FALSE
    has_column_privilege('service_role','public.businesses','seat_tier','UPDATE')   -> TRUE    ✅ Stripe path intact
    trigger trg_enforce_business_seat_billing_immutable                             -> present

The service-role claim was verified rather than trusted: all three writers of
these columns — `check-business-seat-subscription`, `create-business-seat-checkout`
and `stripe-webhook/handlers/businessSeatGrant.ts` — build their client from
`SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY`, and `service_role` keeps its own
table-level grant, which a REVOKE aimed at `authenticated, anon` never touched.

### Two things the security review got wrong

1. **SEC-004 was not live.** The review said `get_business_seat_limit` /
   `business_seat_limit` "have carried PostgreSQL's default EXECUTE TO PUBLIC
   since April, so any authenticated user can probe an arbitrary business id".
   Production disagrees:

       proacl (both)  = {postgres=X/postgres, service_role=X/postgres}
       has_function_privilege('authenticated', …, 'EXECUTE') -> FALSE
       has_function_privilege('anon',          …, 'EXECUTE') -> FALSE

   An advisor pass had already stripped it. There is **no live information
   leak**. The explicit `REVOKE` still ships (in
   `20260818124500_lock_seat_limit_reader_rpcs.sql`) for two real
   reasons: the repo's own guard, `scripts/check-migration-grants.mjs`, exits 1
   on `20260817120000` without it and `migration-lint.yml` runs that guard on
   every push; and a from-scratch replay starts on a virgin database where
   `CREATE FUNCTION` *does* grant EXECUTE TO PUBLIC, so without the statement
   the rebuild comes up with the hole open. It is a pin, not a patch.

2. **The migration was not merely "back-dated" — it was already applied.**
   `20260817120000` is recorded in `supabase_migrations.schema_migrations` and
   its functions are live in prod (`business_seat_limit_for_tier` returns
   1/2/3/4, unknown/NULL → 1), i.e. it reached the database out-of-band before
   it was ever committed. **The instruction to rename it to a later timestamp
   was therefore not carried out, deliberately.** Renaming an applied migration
   strands its ledger row as an orphan version with no matching file — exactly
   the `schema_migrations` poisoning CLAUDE.md is most emphatic about (45 orphan
   versions, every automated deploy silently broken for two weeks), and
   repairing it would need an out-of-band write to prod that nobody is awake to
   approve. Files and ledger currently agree; that was worth more than the
   tidier filename. The new work went into a **new** migration timestamped after
   every existing one instead, which is what the rename was trying to achieve
   anyway — and it is the only way the new statements reach prod at all, since
   `db push` skips a version already in the ledger.

### Shipped in `20260818124500_lock_seat_limit_reader_rpcs.sql`

- **SEC-004 / grant guard.** `REVOKE ALL` on both seat-limit reader functions.
  Checked first that nothing calls them over the wire: grepping `src/`,
  `supabase/functions/` and `e2e/` finds only the auto-generated `types.ts`
  entries and comments. They are read solely from SECURITY DEFINER trigger
  bodies, which keep EXECUTE as the definer.
  `node scripts/check-migration-grants.mjs <both seat migrations>` → **EXIT 0**
  (was 1). This is the one item in the review that nothing else had covered.

### Deliberately NOT shipped, because someone else already had it

This ran alongside another session working the same files, so scope was cut to
what was genuinely missing rather than what was assigned:

- **SEC-001** — closed by `20260818070000` / `071500` / `090000` (grant removal
  *and* a pinning trigger). A drafted third mechanism was deleted rather than
  committed; a third answer to one question is the disease this workstream
  exists to cure.
- **SEC-003 / TOCTOU** — closed by `20260818110000`, which takes the same
  `FOR UPDATE` on the parent `businesses` row **and** adds a `COALESCE`
  fail-closed on `enforce_business_seat_limit`'s NULL limit that the drafted
  version here had missed. Strictly better; deleted mine.

### SampleTag contrast

`bg-warning text-warning-foreground` = white on `--warning` (33 26% 53%) →
**3.24:1** light, **2.64:1** dark. Both fail AA at 11px bold, on the one label
that has to be legible on a payments screen.

Now `bg-warning/15` + `toneTextClasses.warning` (amber-800 / dark amber-400) —
the tint-plus-dark-text shape every other warning chip in the app already uses.
A one-off `bg-[hsl(33_26%_40%)] text-white` was in the working tree and does
clear AA (5.18:1), but re-picking a bespoke shade per component is the exact
cohesion debt `src/components/admin/tones.ts` exists to retire, and it would
have left billing as the only warning chip that doesn't match the set.

Measured with **@axe-core/playwright**, not a hand-rolled sampler: the 375 spec
now runs `withRules(["color-contrast"])` and asserts zero violations.

### The 1440 Playwright test

Reported as failing deterministically by subtracting a desktop rail that
`/business/*` never has (`"/business"` is not in `AUTH_PREFIXES`, so `<html>`
never gets `desktop-rail` and the global `#root` inset never applies). **The
spec on disk contains no such subtraction** — it compares the banner's box to
its previous sibling's, which is rail-independent. Nothing to fix; verified
green rather than assumed:

    PLAYWRIGHT_WEB_SERVER=1 npx playwright test --project=happy-path
      → 10 passed, 734 skipped, 0 failed

Both `scrollWidth <= clientWidth` and `tooWide === []` are intact.

### Full gate

    npm run typecheck                                   → 0
    npx vitest run                                      → 147 files, 1432 tests, all pass
    npx playwright test --project=happy-path            → 10 passed, 0 failed
    node scripts/check-migration-grants.mjs <both>      → EXIT 0
    seatLimitLadder.parity.test.ts                      → green (still resolves
      20260817120000 as the newest file defining business_seat_limit_for_tier —
      the new migration deliberately does not redefine the ladder)

### One more for the morning

`node scripts/check-migration-grants.mjs --all` reports **17 pre-existing
violations** across the historical corpus, none of them seat-related. CI only
ever runs the guard over a push's changed files, so these are invisible today
and will ambush whoever next touches one of those files. Worth a dedicated
sweep; out of scope tonight.
