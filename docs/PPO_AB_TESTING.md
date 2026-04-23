# Product Page Optimization (PPO) — A/B Testing on the App Store

Apple's PPO lets us run up to 3 simultaneous A/B tests on the live App
Store listing — Apple splits visitors evenly across the control + each
treatment, then declares a winner once results hit 90% statistical
significance (typically 2–4 weeks).

We extend Apple's analytics by tagging every install with the treatment
ID it came from, so we can answer the question Apple *can't*: which
variant produces the highest **activation** (signup → first job posted /
first job completed), not just the highest install count.

---

## What's in this repo

| Path | Purpose |
|------|---------|
| `fastlane/metadata/ppo_tests/trust/` | Trust-vs-value test copy + screenshot brief |
| `fastlane/metadata/ppo_tests/visual/` | App-UI-vs-lifestyle test copy + screenshot brief |
| `fastlane/metadata/ppo_tests/local/` | Statewide-vs-parish test copy + screenshot brief |
| `src/lib/ppoAttribution.ts` | Captures the `?ppt=` referrer Apple appends to PPO installs and tags every downstream analytics event |

The attribution capture runs from `useCppVariantRouter()` in `App.tsx`,
so PPO and CPP coexist cleanly — a user can land on the Poster CPP via
the Trust treatment and we record both facts.

---

## The 3 launch tests

### 1. Trust  — `?ppo_test=trust`
**Hypothesis:** Does safety messaging beat price messaging?
- **Control:** "Verified, Secure, Local"
- **Treatment:** "Jobs from $50. Save Your Time."

### 2. Visual — `?ppo_test=visual`
**Hypothesis:** Does app-UI imagery beat lifestyle photography?
- **Control:** Screenshots of dashboard, map, messaging
- **Treatment:** Editorial photos of real Louisiana neighbors at work

### 3. Local — `?ppo_test=local`
**Hypothesis:** Does parish-specific copy beat broad statewide copy?
- **Control:** "Service marketplace for your home"
- **Treatment:** "Reliable help in Iberia & Vermilion Parishes"

---

## One-time setup in App Store Connect

1. **Wait until you have ~100 weekly installs.** PPO needs traffic to
   reach significance — running it on 12 installs/week just wastes the
   90-day clock.
2. App Store Connect → My Apps → Helpr → **Custom Product Pages →
   Product Page Optimization → Create Test**.
3. For each test:
   - Pick a name matching `Trust Test` / `Visual Test` / `Local Test` so
     the dashboard correlates with this repo.
   - Upload control + treatment assets from
     `fastlane/metadata/ppo_tests/<test>/{control,treatment}/`.
   - Set traffic split to **50/50** (default).
   - Run length: 60 days (Apple's max is 90; cut early if a winner
     declares).
4. Apple reviews the assets (~24 h). After approval, Apple stamps every
   treatment install with `?ppt=<treatment_id>`.
5. Copy the `treatment_id` from the App Store Connect test detail page
   into `PPO_TESTS[<testId>].treatments[].applePptId` in
   `src/lib/ppoAttribution.ts`. Ship.

---

## Web-mirror campaigns (optional but recommended)

Apple's PPO only fires for App Store visitors. If you're running paid
social pointing at louisianahelpr.com first, mirror the same hypotheses
with manual params so the analytics rolls up into one chart:

```text
Control:    https://louisianahelpr.com/?ppo_test=trust&ppo_arm=control
Treatment:  https://louisianahelpr.com/?ppo_test=trust&ppo_arm=treatment
```

The same `recordPpoAttribution()` call picks them up.

---

## Reading results

Apple shows installs / impressions / conversion per arm in **App Store
Connect → Analytics → Product Page Optimization**. Cross-reference with
our admin analytics:

```sql
-- Activation rate per PPO arm
select
  properties->>'ppo_test_id'    as test,
  properties->>'ppo_arm'        as arm,
  count(*) filter (where event = 'app_opened_from_deep_link')   as installs,
  count(*) filter (where event = 'signup_completed')            as signups,
  count(*) filter (where event = 'first_job_posted')            as first_post,
  count(*) filter (where event = 'first_payout_received')       as first_payout
from analytics_events
where properties ? 'ppo_test_id'
  and created_at > now() - interval '60 days'
group by 1, 2
order by 1, 2;
```

A treatment that wins on installs but loses on activation isn't a real
win — keep the control. The whole point of running our own attribution
on top of Apple's is catching that exact failure mode.

---

## Adding a new test later

1. Add a new key in `PPO_TESTS` inside `src/lib/ppoAttribution.ts`.
2. Add a folder under `fastlane/metadata/ppo_tests/<slug>/` with
   `control/` and `treatment/` subfolders mirroring the existing tests.
3. Create the test in App Store Connect, copy back the treatment ID,
   commit, ship.
