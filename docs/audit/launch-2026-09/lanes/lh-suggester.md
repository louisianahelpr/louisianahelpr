# lh-suggester — what to build, cut or change next

Lane: product judgment, not defects. Every number below was read from live prod
(`fncmgoasalhdgfwzhsqa`) or from `origin/main` at `b170609a` in an isolated
worktree. Where I am reasoning rather than measuring, I say so.

Findings filed: **S-001 … S-006**. Fixes applied: **none, deliberately** — the
brief for this lane is propose, not fix.

---

## The one-paragraph version

Louisiana Helpr has never run its core loop. Three non-seed jobs exist, all
inserted at one identical timestamp, none ever funded, all expired unclaimed;
every other row in `jobs` is a fixture. That is not a criticism — it is the
single most important fact for deciding what to do next, because it means every
launch decision is still free. Nothing has to be migrated, no user has to be
re-rated, no expectation has to be honoured. The three things I would spend that
freedom on, in order: **fix the geographic spine** (signup asks for a city and
the entire matching system runs on parish, so 72% of accounts are invisible to
it), **cut the surfaces that cannot earn their keep before there is any
liquidity** (subscriptions first, then five long-tail features), and **launch one
parish in storm season** rather than a state in general.

---

## What the data actually says

Measured 2026-09-02 against prod. Every row below is reproducible with these
four queries against `fncmgoasalhdgfwzhsqa` (read-only, `execute_sql`):

```sql
-- A. job funnel + fixture split
select is_seed, status::text, payment_status, count(*), min(created_at), max(created_at)
from jobs group by 1,2,3 order by 1,4 desc;
select id, title, budget, status::text, payment_status, parish, zip_code,
       created_at, cancellation_reason, stripe_session_id is not null as had_session
from jobs where is_seed = false order by created_at;

-- B. account + reachability census
select count(*) profiles,
       count(*) filter (where parish is null)      no_parish,
       count(*) filter (where zip_code is null)    no_zip,
       count(*) filter (where latitude is null)    no_lat,
       count(*) filter (where stripe_account_id is not null)      connect,
       count(*) filter (where stripe_subscription_id is not null) subs,
       count(*) filter (where marketing_consent) mk,
       count(*) filter (where push_consent) pu,
       count(*) filter (where sms_consent) sms
from profiles;
select count(*) from push_tokens;              -- 0
select count(*) from notification_preferences; -- 5

-- C. price distribution + the money floor/ceiling
select count(*), min(budget), percentile_cont(0.5) within group (order by budget),
       max(budget), round(avg(budget),2) from jobs where budget is not null;
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.jobs'::regclass and pg_get_constraintdef(oid) ilike '%budget%';

-- D. feature usage, by row count
select relname, n_live_tup from pg_stat_user_tables
where schemaname = 'public' order by n_live_tup desc;
select category::text, count(*), round(avg(budget),0) from jobs group by 1 order by 2 desc;
```

Query A returned exactly three `is_seed = false` rows, all with
`created_at = 2026-07-25 18:15:55.391535+00` — identical to the microsecond,
which is why I call them bulk-inserted rather than organic — all with
`had_session = false`, `payment_status = 'unpaid'`, and
`cancellation_reason = 'Job listing expired — scheduled time passed with no
helper assigned'`.

| | |
|---|---|
| Jobs, total | 64 — of which **61 are fixtures** (`is_seed`) |
| Non-seed jobs, ever | **3.** Identical `created_at` to the microsecond, so bulk-inserted, not organic. `stripe_session_id` NULL on all three. All expired: *"scheduled time passed with no helper assigned"* |
| Jobs that ever completed with real money | **0** |
| Profiles | 39 (22 seed) |
| Profiles with a Stripe Connect account | **2** |
| Profiles with a subscription | **0** (`stripe_subscription_id` NULL on all 39; the 3 rows carrying a paid tier were set by hand) |
| `push_tokens` | **0 rows** |
| `notification_preferences` | 5 rows, for 39 profiles |
| `marketing_consent` / `push_consent` / `sms_consent` | **0 / 0 / 0** |
| Median job budget | **$130** (p25 $94, p75 $180, max $400) |
| Budget CHECK constraint | `budget >= 10 AND budget <= 5000` |
| Parish concentration | Lafayette 25, Vermilion 8, Iberia 5 — Acadiana, not New Orleans |

Feature usage, all from row counts:

| Feature | Real usage |
|---|---|
| Gift card (`pif_credits`) | 3 rows, all seed, all with `stripe_payment_intent_id` NULL and `claim_token` NULL — **no money and no claim link has ever passed through it** |
| Referrals | 34 codes generated, **0 rows in `referrals`**; the 2 `referral_credits` rows have NULL `referral_code_id` and NULL `referred_user_id` |
| Saved searches | 0 |
| STR iCal sync | 0 connections |
| Recurring jobs | 0 |
| Instant book | 0 |
| Group jobs | 2 (seed) |
| Worker protection | 0 |
| Scope video | 0 |
| Helper credentials | 0 |
| `helper_preferred_parishes` | 0 |
| Pet profiles | 2 |
| Home maintenance reminders | 5 |
| Tips | 5 |

---

## DO NOW — before the marketplace opens

### 1. Collect ZIP at signup. Nothing else on this list matters until this is true.

**S-001 · HIGH · launch blocker.**

Signup requires email, password, first name, last name, avatar photo, phone,
DOB and **City** (`Signup.tsx:153`, `SignupStep2.tsx:282`). It does not ask for
a ZIP. `louisianaCities.ts:15-18` says explicitly that parish is *deliberately
not* derivable from the city list — it is resolved "authoritatively from ZIP via
the `get_parish_for_zip` RPC". ZIP is only ever collected in `ProfileEditForm`
and in Post-a-Job.

So in prod: **28 of 39 profiles have `parish` NULL, 35 have `zip_code` NULL, 38
have `latitude` NULL.**

The live body of `notify_helpers_on_job_post` (read via `pg_get_functiondef`,
not from a migration) opens with `IF NEW.parish IS NULL ... RETURN NEW`, and its
fallback rung joins `p2.parish = NEW.parish`. A helper whose parish is NULL
matches nothing. A job whose parish is NULL notifies nobody. Both return
silently. The function's own comment asserts *"profiles.parish is derived from
the ZIP for EVERY account, poster and helper alike"* — the data disproves it,
which is exactly the class of comment the audit standard warns about.

Radius and "near me" browse need `profiles.latitude`, which 38 of 39 accounts
do not have.

**What I would do:** add ZIP next to the City field on `SignupStep2`, and have
`complete-signup` call the existing `get_parish_for_zip` and stamp
`parish` + `latitude`/`longitude`. Every piece already exists —
`louisiana_zip_parishes` covers all 64 parishes, `parishLookup.ts` wraps the RPC,
`parishCentroids.ts` has coordinates for the top 25 parishes. This is one field
and one write.

**Cost:** small — one input, one derivation, no new dependency.
**What it displaces:** nothing. It is additive.
**Territory:** `src/pages/signup/*` belongs to `lane-onboarding-auth`; relayed.

One caveat worth stating: `louisiana_zip_parishes` holds **252 ZIPs** against
roughly 500 Louisiana ZCTAs. A user in an unmapped ZIP still gets NULL. Worth
knowing before the fix is called done.

### 2. Do not sell memberships at launch.

This is my highest-conviction recommendation and it is the one I most expect
pushback on, so here is the whole argument.

**The ladder is dilutive on exactly the helpers you need.** From
`subscriptionTiers.ts:121-190` and `_shared/proTiers.ts`:

| Tier | Price | Helper commission | Points given up | Break-even GMV/mo |
|---|---|---|---|---|
| Free | — | 12% | — | — |
| Basic | $5/mo | 11% | 1 | **$500** |
| Pro | $10/mo | 10% | 2 | **$500** |
| Elite | $20/mo | 8% | 4 | **$500** |

Platform revenue from a subscriber is `price + tier% × GMV`; from the same person
on free it is `12% × GMV`. They are equal at `price / (12% − tier%)` — which is
$500/month for all three tiers, evidently by design.

**Above $500/month of GMV a subscriber earns the platform less than they would
on free.** The brief I was given states this the other way round; the arithmetic
above is why I am contradicting it. And $500/month at the median $130 job is
**3.85 jobs — about one a week.** That is not a power user. It means the
membership is accretive only on helpers who barely work, and a margin leak on
everyone who does. (Sources for every number in that table:
`src/lib/subscriptionTiers.ts:121-190` for the four `platformFeePercent` and
`price` values, and `supabase/functions/_shared/proTiers.ts:106-115`
`PRO_RECURRING_AMOUNT_CENTS` for the cents actually charged — 500/1000/2000
monthly. Median budget $130 from query C above.)

There is an honest counter-argument: if the perks *cause* extra volume, the
static comparison is wrong. So price that. For a Pro helper to be revenue-neutral
the subscription must induce a volume lift of `1.2×G₀ − 100` — roughly **+10% at
$1,000/month baseline, +15% at $2,000**. That is a real bet, and the perk you are
betting on is **5–10 minutes of early access to job listings**. At launch the
feed is empty, so early access is worth nothing; at low liquidity it is worth
something precisely by taking work away from free helpers — the supply you most
need. Both ends of the curve are bad. (The perk itself:
`src/lib/subscriptionTiers.ts:59-62` describes Basic's "5-min Early Access" and
Pro's "10-min early access (vs Basic's 5-min)" plus priority placement.)

**Four more reasons, none of which is about the maths:**

- **SC-004** is the Apple 3.1.1 risk: a recurring digital entitlement sold
  through Stripe inside the iOS app. Not selling it at launch removes the single
  largest App Review rejection risk from the submission.
- **S-003** (filed): the "Once" option charges three live Stripe Prices whose
  amounts nothing in the repo pins, while the UI renders the *monthly* price
  beside them. `proTiers.ts:112` states the exclusion outright.
- **SC-001** (filed by another lane): the Pro free-boost ledger is a
  client-writable column.
- **Zero subscribers exist.** Nothing is lost and nobody is disappointed.

**Cost:** hide one tab. Fully reversible.
**What it displaces:** the only revenue line that is not transaction-based —
which today generates $0.

### 3. Waive the helper-side 12% for the launch cohort.

The economics, verified: poster pays `1.12 × B`, helper receives `0.88 × B`, so
the platform's gross spread is **24% of job value**. Net of Stripe (2.9% + $0.30
on the poster charge) that is ~20.6% of B, break-even at B = $1.45 — both figures
in the brief reproduce exactly, so the model is sound.

But a 24% spread on a **local, repeat, in-person** service is the most
disintermediation-prone shape there is, and the 12/12 split is worse than a
single-sided fee of the same size because *both parties see a number they
dislike at the same moment*. On a median job the poster pays $145.60 and the
helper is handed $114.40; a $31 gap that both of them can close by exchanging
phone numbers. The app already ships an off-platform-contact scanner and a
`favorite_helpers` rebook rail — it is simultaneously detecting the leak and
building the relationship that causes it.

I am **not** recommending you re-architect the split. It is frozen onto job rows,
defended across eight migrations, and touching it now is exactly the wrong risk.
I am recommending you set `platform_settings.helper_fee_percent` to `0` for the
launch window. That is:

- **one UPDATE on one row.** The edge functions read it at runtime, and jobs
  freeze their `helper_fee_percent` at post time, so it affects new jobs only and
  cannot retroactively disturb anything.
- **free today.** There is no helper GMV to forgo.
- the strongest supply-acquisition message in this category: *"Helprs keep 100%
  of the job price."*
- still profitable — the remaining poster-side 12% nets ~9% of B, which clears
  break-even at any budget the $10 floor permits.

**Cost:** one row update, plus copy.
**What it displaces:** ~11% of net take on a base that is currently zero.

### 4. Launch one parish, in storm season, and stage the seed flip.

`storm_prep` is a live `job_category` and it carries **the highest average budget
of any category in the data — $245 against a $145 overall average, +69%.** It is
also the only category a national competitor structurally cannot serve better,
and today is 2 September: peak Atlantic hurricane season. Launching a Louisiana
marketplace in September without a storm posture is leaving the one durable
advantage on the table.

On the seed flip: `seed_jobs_hidden_publicly()` currently returns `false`, so all
61 fixtures are visible. Flip it and the browse feed goes to **zero** —
`LAUNCH_CHECKLIST.md` already names this ("Verify the public jobs feed has real
listings") but has no plan attached. The empty state
(`BrowseTasksFeed.tsx:546-650`) then greets a brand-new *helper* with *"Nothing
today, {name}"* and a primary CTA reading **"Post your first task"** — the wrong
ask for the persona who just arrived to find work. There is already a quieter
"Notify me" option beside it (`BrowseTasksFeed.tsx:626-628` renders the two
buttons side by side, with "Post your first task" as the primary navigating to
`/post-job`); make "Notify me" the primary when the viewer has no posted jobs.
Cheap, and it converts the dead moment into a supply signal.

The staging I would use: recruit ~25 genuinely posted, funded jobs in **Lafayette
Parish** (25 of the 61 fixtures are already modelled there — it is where the
owner's gravity is) before flipping the flag, not after. Hiding fixtures and
having stock are the same decision, which the checklist already says; the
addition is *which parish, and how many jobs*.

### 5. Reconsider "the poster pays before anyone applies."

Not a defect — a product choice worth re-examining while it is still free to
change. Post-a-Job is entry → form → **checkout**, so escrow is funded at post
time. Ten open fixture jobs sit at `payment_status = 'escrow'` with no helper
assigned.

Combined with `jobExpiry.ts` — a listing expires at its **scheduled start
time**, floored at now+1h — the first-run experience for a poster on a cold
marketplace is: hand ~$146 to an app you installed today, wait, and get refunded
when nobody comes. That is exactly the ending all three non-seed jobs reached
(*"scheduled time passed with no helper assigned"*), though I want to be precise:
those three were bulk-inserted, never had a Stripe session
(`had_session = false` in query A), and are **not** evidence of real-user
checkout abandonment. They are evidence that the expiry path works and that
nothing organic has ever been posted. The four fixture rows sitting at
`status = 'open', payment_status = 'abandoned'` (query A) are the only trace of
the checkout step being reached and not finished, and four seeded rows prove
nothing about real behaviour either.

The lower-risk alternative is a card **authorization** at post and a capture at
accept — the poster commits, sees "you won't be charged until a Helpr accepts",
and an unfilled job costs them nothing but a hold. I am flagging this as a
decision, not prescribing it: it is a real change to the money path and belongs
to `lh-money-escrow` to cost.

---

## DO NEXT — first 30 days

- **Raise `min_supported_build`.** It is `0` in prod, so every install that
  predates the AppDelegate APNs fix keeps dropping tokens. `push_tokens` holds
  **zero rows**, which is the empirical proof that push has never once worked in
  production. Until this is raised, "we fixed push" is true of the code and false
  of the fleet.
- **Give `notification_preferences` a default row at signup.** 5 rows for 39
  profiles is why transactional email is dead for 86% of accounts (N-001). One
  insert in `complete-signup` closes it, and it pairs naturally with the ZIP fix
  in the same commit.
- **`marketing_consent`, `push_consent` and `sms_consent` are `false` on all 39
  accounts.** Whatever the launch growth plan is, it currently has no legal
  audience. Decide whether the signup flow asks, and where.
- **Instrument the funnel.** `analytics_events` has 1,672 rows but no real
  journey has ever run through it. Before liquidity arrives, make sure you can
  answer: post-started → post-funded, job-posted → first-application,
  application → accept, accept → complete. Those four ratios are the entire
  business; without them the first 30 days produce anecdotes.
- **Decide the $5,000 ceiling deliberately.** The `jobs_budget_range` CHECK caps
  budgets at $5,000. That excludes roofing, HVAC and post-storm remediation —
  the highest-value work in Louisiana and the natural extension of `storm_prep`
  at $245 average. It is also where trust risk is highest, so a cap is
  defensible; what it should not be is accidental.

---

## CONSIDER

- **Rebook is the best asset in the product and it is buried.** `favorite_helpers`
  has 11 rows, the `YourHelpers` rail and `/profile?tab=saved_helpers` both exist,
  and repeat booking is the only mechanic that makes a local marketplace
  compounding rather than transactional. It is also the mechanic most exposed to
  the 24% spread (see 3 above). Making the second booking materially cheaper or
  faster than the first is the highest-leverage retention idea available.
- **A "somebody showed up" guarantee, not a feature.** The gap the checklist
  cannot see: an in-person marketplace's real failure mode is nobody arriving.
  `no_show_alert_sent_at` exists on `jobs`, so the plumbing is there. A stated
  promise — *"if your Helpr doesn't show, we refund you the same day and find you
  another"* — is worth more at launch than any of the twenty long-tail features
  below, and costs a policy rather than a codebase.
- **Job-value ceiling on trust, not on dollars.** `helper_credentials` has 0 rows
  and VC-002 (filed by another lane) says any signed-in user can self-grant the
  top "Licensed + Insured" tier. Until that is real, gating high-value categories
  on credential tier is theatre. Either make the credential real or stop
  displaying it — a trust badge that anyone can mint is worse than none.

---

## CUT — before launch

Every one of these is a real surface with real maintenance cost and zero or
near-zero usage. Cutting is the recommendation; where I mean "hide, don't
delete", I say so.

| # | Surface | Cost | Usage | Recommendation |
|---|---|---|---|---|
| 1 | **Memberships** (`?tab=subscription`) | live Stripe Prices, 4 tiers, 3 billing cycles, SC-001 + SC-004 + S-003 attached | 0 subscribers, ever | **Hide the tab at launch.** Argument in full above. Reversible, removes the biggest App Review risk, and stops the dilution the maths predicts. |
| 2 | **Gift card** (`/gift-card`) | 1,838 LOC in `src/` + 394 LOC across two edge functions | 3 seed rows; **no Stripe payment intent and no claim token on any of them** — neither the purchase nor the claim path has ever run | **Cut for launch.** It also carries an Apple IAP question (`lh-compliance-store` owns it) for a feature nobody has used. It occupies the Dashboard below the feed (`Dashboard.tsx:659`). |
| 3 | **Referrals** | 1,282 LOC + 3 tables + an admin view | 34 codes minted, **0 referrals**, and the 2 credit rows have NULL code and NULL referred user, i.e. they are orphans (`select * from referral_credits` → both rows `referral_code_id: null, referred_user_id: null`; `referrals` `n_live_tup` = 0; `referral_codes` = 34) | **Cut for launch.** Referral is a growth loop that needs a working product to refer people to. Ship it when the loop closes, not before. |
| 4 | **STR iCal sync** | 972 LOC in `src/` + an **849 LOC** edge function | 0 connections | **Cut.** A short-term-rental calendar integration is a vertical product bolted onto a general marketplace with no users in either. The largest LOC-per-user ratio in the app. |
| 5 | **Recurring jobs** | `charge-recurring-visits` is **1,157 LOC** and cron-scheduled; it replaced an already-withdrawn `spawn-recurring-jobs` | **0 recurring jobs** | **Cut the backend, keep the column.** The heaviest single edge function in the app, on a cron, charging money, exercised by nothing. Recurring billing that has never run is the last thing you want executing unattended on launch night. |
| 6 | **Helpr Wrapped** | 750 LOC | 0, and **nothing in the app links to it** — `?tab=wrapped` is reachable only by typed URL | **Cut.** A year-in-review for a product with no year. |
| 7 | **`helpr-pass-wallet`** (S-005) | 199 LOC, deployed edge function | **zero callers** in `src/`, `supabase/`, or `e2e/` — the only grep hit is a comment | **Delete the function.** It reads `profiles` and `reviews`, so it is live attack surface with no product behind it. Also: the `lh-audit` standard still carries a whole must-drive sub-checklist for it, including tier-refresh semantics, for a feature with no UI. |
| 8 | **Broadcast messages** (S-004) | `BroadcastBanner` runs **two queries on every Dashboard load**; `AdminBroadcasts` can still write to the table | 0 rows in both tables; owner confirmed the feature removed 2026-09-01 | **Delete both.** Pure latency on the most-loaded screen for a product that no longer exists. |
| 9 | **Worker protection** (`jobs.protection_opted_in` / `protection_fee`) | 2 columns, defended across 8 migrations including the money-column and negative-amount constraints | **zero frontend consumers** — the only `src/` hit is generated types | **Drop the columns.** Every future money-safety migration has to reason about two fields no code touches. |
| 10 | **`BirthdayPopup`** | 174 LOC, mounted on `/dashboard` | — | **Cut.** A modal that interrupts the primary screen of a marketplace to say happy birthday. It is the clearest single example of the app doing something other than its job. |

**What I would keep**, and why, so the cut list is not read as "cut everything":
**pet profiles** (2 rows but it is a genuine job-quality input for `pet_care`,
which averages $147), **home history** and **work record** (both are pure reads
over data you already have — they cost nothing to keep and they are the artifacts
that make a completed job feel like it accumulated into something), **group
jobs** (586 dedicated LOC and it unlocks moving and storm cleanup, the two
highest-budget categories), **saved searches** (568 LOC, 0 rows — but it is the
demand-capture mechanism for exactly the empty-feed problem in §4; keep it and
*promote* it), and **auto-tip** and **instant payout**, both of which are supply
retention levers that get more valuable as volume arrives, not less.

---

## UNVERIFIED — could not reach, and why

- **Whether the live one-time Stripe Prices actually charge $5/$10/$20.** That
  requires reading live Stripe Price objects, and the standing constraint for
  this lane is test-mode only. S-003 is filed with static evidence and relayed to
  `lh-money-escrow` / `lh-subscriptions-credits` to confirm against live Stripe.
- **The rendered surfaces.** This lane graded product shape from prod data and
  source; I did not drive Chrome or the simulator. `lh-route-walker`,
  `lh-visual-critic` and `lh-e2e-journeys` own that, and my recommendations do
  not depend on a pixel.
- **Whether the four browse surfaces still disagree about seed visibility.** The
  brief says they do not share a definition; migration
  `20260901035245_seed_visibility_server_authority_and_saved_search_matching`
  suggests that was consolidated. I did not verify it, because the
  recommendation in §4 (do not flip the flag until there is stock) holds either
  way. Flagged for whoever owns the flip.
- **Whether the $500/month subscription crossover was intentional.** All three
  tiers landing on the same number is too clean to be accidental, but I have no
  evidence either way and the recommendation does not turn on it.

---

## Ranked, if you only do a few things

1. **Collect ZIP at signup** (S-001). Everything downstream of "a job was
   posted" is dead without it.
2. **Don't sell memberships at launch.** Removes the Apple risk, the dilution,
   and three filed money findings, and costs nothing because nobody has bought one.
3. **Set `helper_fee_percent = 0` for the launch cohort.** One row, free today,
   strongest supply message available.
4. **Cut items 2–10 above.** Roughly 6,000 lines of `src/` and ~2,400 lines of
   edge function, none of it load-bearing, all of it needing to be correct on
   launch night if it ships.
5. **One parish, storm season, seed flag flipped only after ~25 real funded jobs
   exist in it.**

## Out-of-scope conclusions (PROTOCOL §6)

Nothing in §6's not-applicable list appeared in this lane's work, and I filed
none of it (the six filed findings are S-001…S-006; `node scripts/audit-bus.mjs
list --agent lh-suggester` is the artifact). The three assess-then-justify
items — certificate pinning, jailbreak detection, full i18n string extraction —
are all correctly "wontfix" from a product standpoint at this stage: none of
them affects whether a Louisianian can post a job and get someone to show up,
which is the only question that matters before there is a single real
transaction. I did not re-examine the deliberately staged apex-universal-links
work.

One correction to hand back to PROTOCOL §6c: its stated scale is 108 tables and
254 database functions. Live prod holds **80 tables, 2 views and 231 public
functions** (`select count(*) ... from pg_class join pg_namespace where nspname
= 'public'` grouped by `relkind`, plus `pg_proc`). The stated figures are
probably pre-removal-sweep or from staging; lanes sampling against them are
sampling a surface that no longer exists. Relayed to the orchestrator.

### Coverage manifest — what this lane actually opened

Prod (read-only `execute_sql`): `pg_stat_user_tables` full census, `jobs`
(schema + funnel + budgets + categories + parish + the three non-seed rows),
`profiles` (schema + census + tier + consent + geo), `platform_settings`,
`pif_credits`, `referral_credits`, `push_tokens`, `notification_preferences`,
`louisiana_zip_parishes`, `helper_preferred_parishes`, `pg_constraint` on
`jobs`, `pg_enum` for `job_category`/`job_status`, and
`pg_get_functiondef` for `handle_new_user`, `seed_jobs_hidden_publicly` and
`notify_helpers_on_job_post`.

Source (worktree at `origin/main` `b170609a`): `src/lib/subscriptionTiers.ts`,
`src/lib/proTiers.ts`, `supabase/functions/_shared/proTiers.ts`,
`src/components/profile/SubscriptionTab.tsx`,
`src/components/profile/subscriptionTab/tierConfig.tsx`,
`src/pages/Signup.tsx`, `src/pages/signup/SignupStep2.tsx`,
`src/components/ProtectedRoute.tsx`, `src/pages/PostJob.tsx` entry via
`src/pages/postjob/jobSubmitHelpers.ts`, `src/lib/jobExpiry.ts`,
`src/lib/offerResponseWindow.ts`, `src/lib/louisianaCities.ts`,
`src/lib/parishLookup.ts`, `src/lib/parishCentroids.ts`,
`src/components/postjob/CityAutocomplete.tsx`,
`src/components/admin/AdminSettings.tsx`, `src/pages/Dashboard.tsx`,
`src/components/BroadcastBanner.tsx`, `docs/LAUNCH_CHECKLIST.md`, and the
long-tail surface census (LOC + route reachability + edge-function ownership for
20 features) produced by a read-only sub-agent over the same worktree.

Not opened: any rendered surface. See UNVERIFIED above.

`npm run check:audit-evidence` was run on this file and reports 6/15 claims
carrying a same-line artifact. The remainder are prose sentences whose artifact
sits in the SQL block, table row, or `file:line` citation immediately above or
below them — the checker matches per line, and says so itself ("heuristic, not a
verdict"). I have not rewritten argument prose to inline a citation it already
carries in context; every factual claim in this report traces to the four
queries at the top or to a named `file:line`.
