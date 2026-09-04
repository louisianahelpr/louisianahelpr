# STR calendar sync creates jobs no helper can see

**Status:** open · **Found:** 2026-09-03 · **Live damage so far:** none
**Severity:** would be high the moment a host connects a calendar; zero until then.

## What happens

`str-ical-sync` (cron, every 6h — `20260831193040`) reads a host's Airbnb/VRBO
iCal feed, detects a guest checkout, and inserts a cleaning job:

```
supabase/functions/str-ical-sync/index.ts:243   status: 'open'
                                                payment_status: (default) 'unpaid'
```

Nothing in that function funds the job. Since migration `20260831010000`, **all
three browse surfaces** — `get_ranked_open_jobs`, `open_jobs_browse` and
`get_open_jobs_for_map` — require `payment_status IN ('escrow','payout_pending',
'released')`.

So every auto-created job is **invisible to every helper on the platform.** Not
"no supply yet" — structurally unseeable.

## Why it is a trap rather than a no-op

The host's own screens read `public.jobs` directly, so **the host sees the job
and the sync looks like it worked.** They believe their turnover is handled. It
is not, and nothing tells them.

The function's own comment says exactly this (`:198-210`), labels it a KNOWN
PRODUCT GAP, and counts the rows in `jobs_created_unfunded` so the number is
visible rather than implied. It was raised for decision and not resolved.

## Blast radius today: zero

Queried prod 2026-09-03:

| | |
|---|---|
| `str_calendar_connections` | **0** |
| with `auto_create_cleaning` on | **0** |
| jobs with `is_auto_created` | **0** |

Nobody has connected a calendar, so no host has been burned. This is latent, not
live. **It becomes live the first time one person turns the feature on.**

## The fix is smaller than the comment implies

The gap is a **missing client entry point, not missing backend.**

`create-payment` already funds an *existing* job. It takes a `jobId`, reads the
row (`:129`), and creates the Stripe session — it does not create the job. And
its guard at `:134` is:

```js
if (job.stripe_session_id && job.payment_status && job.payment_status !== "unpaid")
```

An unfunded job **passes** that guard. So
`invoke("create-payment", { action: "escrow", jobId })` — the identical call the
post-a-job flow already makes at `src/pages/postjob/useJobSubmit.ts:556` — would
fund an auto-created STR job today, unchanged.

What does not exist is any UI that calls it for a job that already exists. Every
other client caller uses `release`, `tip`, `resolve_revision` or an `admin_*`
action; only `useJobSubmit` funds, and only for a job it just created.

## Options

**A — Fund-it affordance (recommended).** Show auto-created unfunded jobs in the
host's list with an explicit "not posted yet — fund to publish" state and a
button calling `create-payment` with `{ action: 'escrow', jobId }`. Smallest
change, reuses a proven path, and keeps the human in the loop on a charge.

**B — Create as draft, not `open`.** Insert with a status that never claims to be
live, and have the host complete it through the normal post-a-job checkout. Most
honest about what has actually happened; needs a draft state the jobs table and
the host's UI both understand.

**C — Auto-fund at creation.** Charge the host's saved card off-session when the
job is created. Truest to the feature's promise and the worst fit for consent —
it charges someone for a job they have not seen. Would need explicit opt-in
wording at connect time, and interacts with the same off-session card
requirements `charge-recurring-visits` already depends on.

**D — Do not create a job at all; send a prompt.** The value the feature actually
sells is *not forgetting*, not *not typing*. A notification — "a guest checks out
tomorrow, post your cleaning job?" with a prefilled deep link — delivers the whole
benefit with none of the payment complexity, and cannot strand a row.

D is the smallest honest version; A is the smallest version that keeps the
feature as pitched.

## Until it is fixed

**Do not market calendar automation.** A host who connects a calendar because of
an ad gets a phantom job, no helper, and no way to fix it. Marketing copy for STR
hosts must stay on manually-posted turnover cleaning, which works — see the
`str-hosts-2026` batch, written deliberately without any automation claim.

Also note `/str-settings` is no longer a route (removed 2026-09-02); the settings
live as a Profile tab, so there is no deep link to send anyone to.
