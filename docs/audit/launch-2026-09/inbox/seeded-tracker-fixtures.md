# Seeded tracker fixtures — both owner accounts, both sides, every stage

Inserted into **prod `fncmgoasalhdgfwzhsqa`** on 2026-09-09. INSERT ONLY — no
pre-existing row was updated or deleted, including the three cancelled jobs
account A already had.

## Accounts

| Role in this fixture set | Account | user_id |
|---|---|---|
| Owner A | `lexilombas05@gmail.com` | `76b07824-9b41-4741-a4c4-4f8de362f682` |
| Owner B | `admin@louisianahelpr.com` | `7f65ef12-1d3d-439b-b0a7-f42ce8bc176d` |
| Counterparty on every job A or B **posted** | Hallie Helper (fixture) | `437de07d-1bd7-46c8-a451-6b46aa3bcad5` |
| Counterparty on every job A or B **is doing** | Perry Poster (fixture) | `71c56dfb-b326-4010-b960-b18dd3966e7f` |

The two owner accounts are **never** each other's counterparty — every stage on
A is independent of B's state and vice versa.

## Row counts

| Table | Account A | Account B | Total |
|---|---:|---:|---:|
| `jobs` (all `is_seed = true`) | 26 | 26 | **52** |
| `applications` | 24 | 24 | **48** |
| `job_tracking` | 10 | 10 | **20** |
| `messages` | 78 (26 threads × 3) | 78 | **156** |
| `notifications` (trigger-created, not inserted by hand) | 103 | 103 | **206** |

Every job has exactly one 3-message thread between its two parties. Four
threads per account end on an **unread** inbound message so the Messages badge
and unread state are exercised (badge read `4` in the capture).

## ID scheme

All fixture jobs use a recognisable UUID prefix, which is what makes the
cleanup below exact:

```
5eed0a10-0000-4000-8000-0000000000NN   A · jobs A POSTED   (NN = 01..13)
5eed0a20-0000-4000-8000-0000000000NN   A · jobs A IS DOING (NN = 01..13)
5eed0b10-0000-4000-8000-0000000000NN   B · jobs B POSTED   (NN = 01..13)
5eed0b20-0000-4000-8000-0000000000NN   B · jobs B IS DOING (NN = 01..13)
```

Child rows (`applications`, `job_tracking`, `messages`, `notifications`) carry
no special id — they are addressed by `job_id`.

## Stage matrix

The stage list is derived from `STATUSES` + `PRE_STATUSES` in
`src/components/JobTracking.tsx` (posted → assigned/Offered → confirmed/Accepted
→ job_confirmed/Confirmed → on_the_way → arrived → working → done) plus the
terminal states the Activity tabs expose (`completed`, `cancelled`,
`revision_requested`, `disputed`). Buckets are the five in
`src/pages/activity/activityFilters.ts`.

### Side 1 — jobs the account POSTED (`/my-posts`), helper = Hallie Helper

| NN | Tracker stage | `jobs.status` | `payment_status` | Bucket (measured) | Title |
|---|---|---|---|---|---|
| 01 | Posted, no applicants | open | escrow | waiting | Deep clean before showing |
| 02 | Posted, 1 pending applicant | open | escrow | needs_you | Help loading a 16-foot truck |
| 03 | Offered (assigned, unconfirmed) | accepted | escrow | waiting | Replace two interior door knobs |
| 04 | Accepted (helper confirmed) | accepted | escrow | scheduled | Trim crepe myrtles and haul limbs |
| 05 | Confirmed (day-of, both sides) | accepted | escrow | scheduled | Assemble a desk and two bookcases |
| 06 | On the Way | in_progress | escrow | scheduled | Grocery run and pharmacy pickup |
| 07 | Arrived | in_progress | escrow | scheduled | Pick up a dresser from Mid City |
| 08 | Working | in_progress | escrow | scheduled | Paint a small bedroom, one coat |
| 09 | Done — awaiting poster approval | in_progress | escrow | needs_you | Board up two windows before the front |
| 10 | Completed | completed | **released** | done | Post-party kitchen and patio cleanup |
| 11 | Revision requested | revision_requested | escrow | needs_you | Mow, edge, and blow the driveway |
| 12 | Disputed | disputed | escrow | needs_you | Move a piano across the house |
| 13 | Cancelled | cancelled | **refunded** | cancelled | Two dog walks while I travel |

### Side 2 — jobs the account IS DOING (`/my-jobs`), poster = Perry Poster

| NN | Tracker stage | `jobs.status` | `payment_status` | Bucket (measured) | Title |
|---|---|---|---|---|---|
| 01 | Applied, awaiting decision | open | escrow | waiting | Costco run and unload |
| 02 | Direct offer held for me | open | escrow | needs_you | Hang a ceiling fan in the den |
| 03 | Offered (accepted app, not yet confirmed) | accepted | escrow | needs_you | Move-out clean for a one-bedroom |
| 04 | Accepted (I confirmed) | accepted | escrow | scheduled | Setup crew for a backyard reception |
| 05 | Confirmed (day-of, both sides) | accepted | escrow | scheduled | Build a swing set in the backyard |
| 06 | On the Way | in_progress | escrow | scheduled | Deliver a washer to River Ranch |
| 07 | Arrived | in_progress | escrow | scheduled | Clear leaves and clean gutters |
| 08 | Working | in_progress | escrow | scheduled | Touch up hallway and stairwell |
| 09 | Done — awaiting their approval | in_progress | escrow | waiting | Bring in patio furniture and secure the shed |
| 10 | Completed | completed | **released** | done | Load a storage unit off Airline |
| 11 | Revision requested | revision_requested | escrow | needs_you | Weekly clean for a small office |
| 12 | Disputed | disputed | escrow | needs_you | Fix a leaking kitchen faucet |
| 13 | Cancelled | cancelled | **refunded** | cancelled | Feed and check on two cats |

`5eed0b10-…` / `5eed0b20-…` are the same 26 rows for account B.

## Money / escrow state chosen per stage, and why

* Every live stage (open, accepted, in_progress, revision_requested, disputed)
  is **`payment_status = 'escrow'`**. That is what a real funded job looks like,
  and it is also load-bearing: `enforce_job_funded_before_award` refuses
  `helper_id` on an unfunded job, `notify_helpers_on_job_post` only fires on a
  funded one, and a SQL-inserted job is invisible in Browse unless it is
  `escrow`.
* Completed → **`released`**, with `poster_completed_at` and
  `payout_scheduled_at` stamped.
* Cancelled → **`refunded`**, with `cancelled_at` / `cancelled_by` /
  `cancellation_reason`.
* Fee columns mirror the house shape seen on real prod rows:
  `platform_fee_percent = 12`, `helper_fee_percent = 12`,
  `platform_fee_amount = customer_fee_amount = round(budget × 0.12, 2)`,
  taxes 0, `protection_opted_in = false`, `credential_tier = 0`,
  `pricing_mode = 'set_price'`.
* Budgets $45–$250, dates −15 to +17 days, real parishes/cities
  (New Orleans/Orleans 70115, Baton Rouge/East Baton Rouge 70808,
  Lafayette/Lafayette 70503, New Iberia/Iberia 70560) with matching lat/lng, and
  categories drawn from the `job_category` enum.

## Verification actually performed

1. **Bucket classification run through the app's own functions.** All 52 jobs +
   48 applications were read back from prod and passed through
   `postedActivityBucket()` / `appliedActivityBucket()` (and the synthetic
   direct-offer shape `fetchAppliedActivity` builds) imported from
   `src/pages/activity/activityFilters.ts`. Every row landed in the bucket in
   the tables above; every job reported `msgs=3`.
2. **Tracker step run through `deriveCurrentStatusIdx()`** from
   `src/components/JobTracking.tsx`. Steps 0–6 each appear exactly once per side
   per account; `revision_requested` and `disputed` clamp to step 5 (Working)
   and `cancelled` sits at step 1, which is the documented render-time refusal,
   not a seeding error.
3. **Driven in Playwright Chromium at 375×812**, signed in as each account, all
   five bucket tabs on `/my-posts` and `/my-jobs` plus `/messages`. Zero
   horizontal overflow on every screen; zero console errors on account B, only
   4× HTTP 400 from an unrelated background request on account A.
4. **Public-browse leak checked as a signed-out visitor** — see below.

### Screenshots

`/private/tmp/claude-501/-Users-lexilombas-louisianahelpr/e0241cf9-a362-473b-a66a-f80d4cd37af9/scratchpad/shots/`

`A-myposts-{needs_you,scheduled,waiting,done,cancelled}.png`,
`A-myjobs-{…}.png`, `A-messages.png`, and the same eleven for `B-`.

Measured tab counts on account A matched the classification exactly:
My Posts — Needs You 4 · Scheduled 5 · Waiting 2 · Done 1 · Cancelled 4
(the 4th cancelled is one of the owner's three pre-existing jobs; the other two
are also there). My Jobs — Needs You 4 · Scheduled 5 · Waiting 2 · Done 1 ·
Cancelled 1.

## Two things the owner needs to know

### 1. Account B cannot see any of this yet — it is behind the profile gate

Every route on `admin@louisianahelpr.com` renders the "Please Take a Moment to
Re-Agree" sheet over the profile-completion wall: **"Still needed: Profile
picture, ZIP code — 5 of 7 done."** My Posts, My Jobs and Messages are all
unreachable until that is finished. The seeded data for B is correct and
verified through the app's own classification — it is the account that is
gated, not the fixtures. Fixing it means writing to the owner's existing
`profiles` row, which this task was scoped INSERT-ONLY, so it is left for the
owner: tap through the completion sheet once on the phone.

### 2. The seeded jobs ARE visible in public Browse right now, by design

`platform_settings.feature_flags.seed_jobs_hidden_publicly` is **`false`**
today (the owner's standing choice — fixtures visible while testing), so as a
signed-out visitor the eight open seeded jobs are reachable:

| Surface | seeded rows visible, flag = false | flag = true |
|---|---:|---:|
| `get_public_open_jobs` (landing teaser) | 4 | 0 |
| `get_open_jobs_for_map` | 6 | 0 |
| `get_ranked_open_jobs` | 6 | 0 |
| `open_jobs_browse` (dashboard list) | 6 | 0 |

The right-hand column was measured for real, inside a transaction that flipped
the flag and then `ROLLBACK`-ed — the flag is confirmed back at `false`. So all
four surfaces honour the gate consistently; nothing here needs a code change.
When the owner wants them hidden it is the one documented statement:

```sql
UPDATE public.platform_settings
   SET feature_flags = feature_flags
                       || '{"seed_jobs_hidden_publicly": true}'::jsonb;
```

(6 not 8 because the two direct-offer jobs are already hidden from every browse
surface while the offer is live, which is correct.)

No parish fan-out email was sent: `notify_helpers_on_job_post` found zero
notifiable **real** accounts in any parish used here, and the notifications
table shows zero `job_match` rows for these jobs.

---

## Cleanup — deletes exactly these rows and nothing else

Run either half independently. Order matters (children before jobs).

### Account A — `lexilombas05@gmail.com`

```sql
BEGIN;
CREATE TEMP TABLE _lh_cleanup_a AS
SELECT id FROM public.jobs
 WHERE id::text LIKE '5eed0a10-0000-4000-8000-%'
    OR id::text LIKE '5eed0a20-0000-4000-8000-%';

DELETE FROM public.notifications WHERE job_id IN (SELECT id FROM _lh_cleanup_a);
DELETE FROM public.messages      WHERE job_id IN (SELECT id FROM _lh_cleanup_a);
DELETE FROM public.job_tracking  WHERE job_id IN (SELECT id FROM _lh_cleanup_a);
DELETE FROM public.applications  WHERE job_id IN (SELECT id FROM _lh_cleanup_a);
DELETE FROM public.jobs          WHERE id     IN (SELECT id FROM _lh_cleanup_a);

DROP TABLE _lh_cleanup_a;
COMMIT;
```

### Account B — `admin@louisianahelpr.com`

```sql
BEGIN;
CREATE TEMP TABLE _lh_cleanup_b AS
SELECT id FROM public.jobs
 WHERE id::text LIKE '5eed0b10-0000-4000-8000-%'
    OR id::text LIKE '5eed0b20-0000-4000-8000-%';

DELETE FROM public.notifications WHERE job_id IN (SELECT id FROM _lh_cleanup_b);
DELETE FROM public.messages      WHERE job_id IN (SELECT id FROM _lh_cleanup_b);
DELETE FROM public.job_tracking  WHERE job_id IN (SELECT id FROM _lh_cleanup_b);
DELETE FROM public.applications  WHERE job_id IN (SELECT id FROM _lh_cleanup_b);
DELETE FROM public.jobs          WHERE id     IN (SELECT id FROM _lh_cleanup_b);

DROP TABLE _lh_cleanup_b;
COMMIT;
```

The `5eed0a1…` / `5eed0a2…` / `5eed0b1…` / `5eed0b2…` prefixes are unique to
this fixture set — verify first with
`SELECT count(*) FROM public.jobs WHERE id::text LIKE '5eed0%';` (expect 52).
Nothing else in prod uses that prefix.
