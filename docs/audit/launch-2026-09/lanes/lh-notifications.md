# Lane report — lh-notifications

**Scope:** whether the right notification reaches the right person, once, and whether
the counts are true. Delivery mechanics (APNs, Resend) belong to `lh-native-bridge`
and `lh-email-delivery`.

**Worktree:** `~/.lh-audit/lh-notifications` @ `b170609a` (detached off `origin/main`).
**Live state:** all DB claims are read-only `execute_sql` against **prod**
`fncmgoasalhdgfwzhsqa` on 2026-09-02. No writes, no migrations, no Stripe.

**What I fixed: nothing.** Every finding below lands in owner-review territory —
a DB lookup table, a `SECURITY DEFINER` trigger, an edge function that gates
transactional email, or a preference schema. Per the standing constraint
("anything touching payments, auth, the data model or a migration gets QUEUED"),
all eight are filed for owner review with a fix proposal, not shipped. I was also
still in `plan` mode and not released.

---

## 1. Headline

The notification system has **one root defect expressed three different ways**:
*a preference that does not exist is treated as an answer instead of as a question.*

| Where | Missing thing | Treated as | Result | Artifact |
|---|---|---|---|---|
| `send-notification-email/index.ts:152` | no `notification_preferences` row | "opted out" | email **fails closed** | `notification_logs` join: 0 emails ever sent to a row-less account |
| `fan_out_push_on_notification` | no `notification_preferences` row | "no gate to apply" | push **fails open** | `pg_get_functiondef`: `IF prefs.user_id IS NOT NULL THEN` wraps both checks |
| `fan_out_push_on_notification` | no `notification_type_pref_map` row | "no category to check" | push **fails open** (NT-001) | `select type from notification_type_pref_map` → no row for `info`/`success`/`warning` |

Artifacts: `select count(*) from profiles` = 37, `from notification_preferences` = 5,
profiles with no prefs row = **32** (prod `fncmgoasalhdgfwzhsqa`, 2026-09-02).

The third is NT-001, already filed. The first two are new and the first is worse.

---

## 2. Findings

All filed through the bus. Severity per `lh-audit` §4; `blocker` is orthogonal.

### N-001 · HIGH · **LAUNCH BLOCKER** — transactional email is dead for 86% of accounts

`notification_preferences` rows are created **lazily** — only when a user opens
Profile → Notifications and flips something. `handle_new_user` does not create one
(`pg_get_functiondef` confirms), and no migration backfills. `email-unsubscribe/index.ts:147`
documents the laziness in a comment.

`send-notification-email/index.ts:152`:

```ts
if (!prefs || !(prefs as any)[prefColumn]) {
  await logSkip('skipped', 'preference_off')
```

A **missing** row and an **explicit opt-out** take the same branch, and the skip is
logged as `preference_off` — a preference the user never set.

**Live proof.** Joining `notification_logs` to `notification_preferences`:

| has prefs row | email sent | email skipped |
|---|---|---|
| true | **46** (4 users) | 4 (1 user) |
| false | **0** | 6 (4 users) |

Prod holds 37 profiles and **5** preference rows. Every transactional email the
system has ever delivered went to one of the 4 accounts that happen to have a row.
**Not one email has ever reached any of the other 32.** In-app is unaffected
(68 in-app notifications delivered fine to 9 row-less users), which is exactly why
this has never been noticed.

### N-002 · HIGH — the same missing row makes push fail *open*

```sql
IF prefs.user_id IS NOT NULL THEN
  IF prefs.push_enabled IS NOT TRUE THEN RETURN NEW; END IF;
  -- category check
END IF;
-- ...falls through and sends
```

For the same 32 accounts, neither `push_enabled` nor the category toggle is
consulted. One missing row, two opposite failure modes. Push is currently harmless
(prod `push_tokens` = **0 rows**, confirming NB-004), which is precisely why this
must be fixed *before* `min_supported_build` is raised, not after.

### N-003 · HIGH — Quiet Hours is enforced in UTC against a UI that says local

`send-push-notification/index.ts:469-471` states it outright: *"no per-user timezone
is stored, so we evaluate the window in UTC."* The UI never says UTC — it says
"Mute non-critical pushes overnight", defaults to 22:00–07:00, and renders a
`QuietHoursClock` whose props are documented as `24hr local`.

Louisiana is UTC−5 (CDT). A user setting 22:00–07:00 gets silence from
**17:00–02:00 local** — muted all evening, unmuted at 2am. Inverted from intent.

Nobody is harmed *yet*: `select count(*) from notification_preferences where
quiet_start is not null` returns **0** of 5. It ships broken, which is the point of
catching it now.

### N-004 · MEDIUM — one notification type, three disagreeing preference maps

| Source | Kind | `job_match` maps to | handles `info`/`success`/`warning`? |
|---|---|---|---|
| `notification_type_pref_map` (DB, 14 rows) | push | `job_updates` | **no** ← this is NT-001 |
| `TYPE_MAP` in `send-notification-email:13-30` | email | `email_new_offers` | yes |
| `notify_helpers_on_job_post` (SQL, hardcoded) | producer gate | `new_offers` | n/a |

The email map already encodes the categories the DB map is missing. That is useful:
**the fix for NT-001 does not need to be invented, it needs to be reconciled.**

### N-005 · MEDIUM — the preference screen shows a switch that does nothing and hides the ones that matter

UI renders 7 rows; the maps use 10 pref columns.

- **Mapped but no switch:** `job_updates` (579 rows — the largest single block),
  `system_alerts` (76), `job_applications` (90), `payments` (27). **772 rows / 44%
  of all notifications are uncontrollable by the user.**
- **Switch but mapped to nothing:** `promotions`. A Promotions toggle that gates
  no push whatsoever.

### N-006 · MEDIUM — the iOS app-icon badge counts only messages

`useNavUnreadCount.ts:116` is the **only** `setAppIconBadge` caller in the codebase
and derives from the `messages` table. Unread *notifications* never touch the
springboard. `fan_out_push_on_notification` also never sends a `badge` value, though
`send-push-notification` supports one (`index.ts:93,161`) — so once push is live an
arriving notification will not increment the icon either.

| account | bell (unread notifications) | app icon (unread messages) |
|---|---|---|
| `eli.test.helper@louisianahelpr.com` | 110 | 2 |
| `admin@louisianahelpr.com` | 98 | **0** |

### N-007 · MEDIUM — parish fan-out is unbounded and unthrottled

`notify_helpers_on_job_post` loops every matching helper with no `LIMIT` and no
cooldown, issuing one `net.http_post` **per recipient inside the INSERT transaction**.
Its sibling `notify_saved_searches_on_new_job` carries a 1-hour per-search throttle;
this one has none, and `trg_notify_helpers_funded_update` re-arms on every transition
back to open+funded — so a cancel/repost loop re-alerts the whole parish each cycle.
Harmless at 37 accounts; a storm at launch scale. Relayed to `lh-trust-safety` via
the orchestrator.

### N-008 · LOW — deleted-job notifications tell the user to try again forever

581 of 1773 rows (33%) link to a job that no longer exists; 474 are `job_match` →
`/dashboard?quickApply=<id>`. These do **not** dead-end — `QuickApplyHandler`
resolves the miss and toasts. But the copy is *"This task isn't available to open
**yet** — if you just got the alert, try again in a few minutes."* That copy was
written for the Early-Access delay case and is permanently false for a deleted job.

---

## 3. NT-001 — fix proposal (proposal only; not shipped)

**The one-line fix is wrong.** Adding three rows to `notification_type_pref_map` is
tempting and would make the symptom disappear. Do not do it: `warning`/`info`/`success`
are **severity labels spanning five real categories**, so `warning → system_alerts`
would let a user mute *account suspension* and *dispute* notices with one switch while
still mis-categorising everything else.

**What the 763 rows actually are** — and this reframes the finding. Artifact:
`select type, title, count(*) from notifications where type in ('warning','info','success')
group by 1,2` (prod, 2026-09-02), bucketed by whether `link` targets `/admin`:

| type | admin/operator alerts | user-facing |
|---|---|---|
| `warning` (525) | **434** — "Escalated dispute overdue" 233, "⚠️ Email delivery failed" 189, "🚨 Dispute escalated" 12 | 91 |
| `info` (222) | **182** — "New member joined" | 40 |
| `success` (16) | 0 | 16 |
| **total** | **616 (81%)** | **147 (19%)** |

Four-fifths of NT-001's volume is operator mail to admins, which is very likely
*why nobody noticed*: admins should get these regardless of category preference, so
the fail-open looked like correct behaviour. The genuine user-facing exposure is
~147 rows, not 763. It is still a blocker — but the fix is a split, not a remap.

**Recommended, in this order:**

1. **Close the fail-open first — it is cheap and it is the actual bug.** Make an
   unmapped type a *decision* rather than an accident: default-deny with an explicit
   always-send allowlist, and `RAISE WARNING` into `error_logs` when a type has no
   map row, so a newly-introduced type can never again silently bypass the gate.
   Fix the missing-prefs-row fail-open (N-002) in the same change — same bug class,
   same function, and it is what makes the gate meaningful for 86% of accounts.

2. **Introduce one new type, `admin_alert`.** It absorbs **616 of 763 rows in a
   single move**, is the highest-leverage change available, and is the safest: these
   should never have been user-preference-gated at all. Call sites:
   `auto-resolve-disputes/index.ts:170,356,370`, `complete-signup/index.ts:709`,
   `release-payout/index.ts:377,584`, `process-scheduled-payouts/index.ts:351,817`.

3. **Split the remaining 147 at their call sites onto existing categories.** Every
   user-facing title already has a home — no new user toggle is needed:

   | title | count | → pref column | call site |
   |---|---|---|---|
   | "Job auto-cancelled" / "Job cancelled" / "Job expired" / "Job re-opened" / "Job removed by admin" | 79 | `job_updates` | `auto-expire-jobs:104,117,187`, `poster_cancel_job`, `notify_on_job_update` |
   | "Application accepted!" | 9 | `job_applications` | `checkoutSessionCompleted.ts:418` |
   | "📋 New job offer!" | 6 | `new_offers` | `notify_helper_on_direct_offer`, `create-payment:645` |
   | "Helpr is On the Way" / "Arrived" / "Working" / "✅ Arrival confirmed" | 10 | `transit_updates` | `JobTracking.tsx:1076` |
   | "Helpr marked the job complete" / "Poster confirmed" / "Work has started" / "Job auto-completed" / "✅ Work confirmed" / "Your Helpr hasn't confirmed yet" / "Last chance to review" / "Revision requested" | 22 | `work_status` | `create-payment:653,1275,1491,1688`, `auto-release-payment:317`, `sweep_dayof_confirm_reminders`, `sweep_release_last_chance` |
   | "License verified" / "Insurance verified" / "Verification Successful" | 4 | `system_alerts` | `review_credential`, `stripe-idv-webhook:333` |
   | "⚠️ Message hidden" / "Cancellation warning (1 of 2)" / "🚫 Account temporarily suspended" | 4 | **deliberately unsuppressible** | `scan_message_content`, `apply_consequence_ladder` |

   Counts above are from the same `group by type,title` query; call sites from
   `grep -rnE 'type: *"(warning|info|success)"' supabase/functions src` (40 hits) and
   a regex over `pg_get_functiondef` for the 17 DB functions that insert those types.

   The last row matters: safety and enforcement notices must stay un-mutable. That
   is the case for step 1's *explicit allowlist* rather than a blanket default-deny.

4. **No new toggle.** The gap is not missing categories — it is that four existing
   ones have no switch (N-005). Fix N-005 instead of inventing an eighth toggle.

5. **The 763 already-sent rows: do nothing, deliberately.** `sweep_old_notifications`
   (`cron.job` id 35, `30 3 * * *`, last run 2026-09-02 03:30 `succeeded`) deletes
   read rows at 30 days and unread at 90 (per its `pg_get_functiondef`),
   so the entire backlog ages out unaided. Back-filling `type` would rewrite what the
   user already saw in their bell. The only optional touch-up is relabelling the 434
   admin rows to `admin_alert` if the admin console wants to filter on it — cosmetic,
   not correctness.

---

## 4. Verified working (with artifact)

- **Exactly-once — clean.** Self-join of `notifications` on `(user_id, job_id)` within
  a 10-second window, excluding `type='message'`: **zero pairs**. No event is
  double-notified across the RPC-trigger and edge-function paths, despite three
  separate `AFTER UPDATE` triggers on `jobs` (`notify_on_job_update`,
  `notify_poster_on_status_change`, `notify_on_payment_escrowed`).
- **Retention — bounded and actually running.** `cron.job` + `job_run_details`:
  `sweep-old-notifications` (`30 3 * * *`, direct `SELECT public.sweep_old_notifications()`,
  last run 2026-09-02 03:30, `succeeded`) and `cleanup-notifications` (`16 9 * * *`,
  last run 09:16, `succeeded`). Table is 1773 rows. Passed to `lh-cron-jobs`.
- **Bell / NotificationPanel unread count — correct.** Uses an exact
  `count: "exact", head: true` server query rather than deriving from the paged list
  (`NotificationPanel.tsx:115-124`), dedupes realtime inserts on `id`, and on a count
  failure falls back to the page rather than inventing a number.
- **Fan-out candidate guards — correct.** Both `notify_helpers_on_job_post` and
  `notify_saved_searches_on_new_job` correctly exclude seed-hidden jobs, live direct
  offers, unfunded jobs, banned/unapproved accounts, and the poster themselves, and
  both use `COALESCE(np.<col>, true)` so a missing prefs row reads as "on" — the
  *correct* handling of the very row whose absence breaks N-001/N-002 elsewhere.
- **Deleted-job links do not dead-end.** `QuickApplyHandler` resolves a miss through
  `open_jobs_browse` and toasts; only the copy is wrong (N-008).
- **Seeded helper preferences are healthy.** The brief warned that an earlier sweep
  flipped `push_enabled → false` on `eli.test.helper@louisianahelpr.com`. Artifact:
  `select push_enabled, new_offers, messages, transit_updates, work_status,
  financial_alerts, reviews, promotions from notification_preferences np join profiles p
  … ` returns **all eight `true`** (`match_digest_mode` is `true`, a non-default worth
  knowing). That warning no longer applies — I did not conclude anything from it.

## 5. Retracted (reproduced, found false)

- **"18 identical duplicate message notifications."** A `GROUP BY type,title,user_id`
  showed 18 rows titled "Marie H." with `spread = 00:00:00`. Reading the rows showed
  **18 distinct message bodies** from one seeded conversation, all backdated to a
  single `created_at` by the seed script. Not duplicates. This is why the
  exactly-once query above excludes `type='message'`.
- **"Admin dispute-alert storm."** Prod holds 233 "Escalated dispute overdue" rows,
  13 per burst every 6 hours from 2026-08-29. It is **already fixed**:
  `auto-resolve-disputes/index.ts:113-155` now carries a `REMINDER_WINDOW_HOURS`
  dedupe that fails closed. Artifact: `select date_trunc('hour',created_at), count(*)
  from notifications where title='Escalated dispute overdue' group by 1 order by 1 desc`
  → newest bucket is **2026-09-02 06:00**, while `cron.job_run_details` for jobid 15
  (`21 */6 * * *`) shows a `succeeded` run at **18:21** that produced no rows.
  Filed nothing.

## 6. UNVERIFIED — could not reach, and why

- **Actual push delivery to a device.** Prod `push_tokens` is **0 rows**; there is
  nothing to deliver to. Everything about push above is established from the trigger
  definition, the edge function, and `notification_logs`
  (`no_registered_devices` × 180). Confirms NB-004 rather than assuming it.
- **Read-state sync across two devices / two tabs.** Needs two authenticated
  sessions driven concurrently; the realtime path is read (`NotificationPanel.tsx`
  re-reads the list on channel drop) but not exercised.
- **The native app-icon badge on a real springboard.** N-006 is proven from the
  code path and the divergent server counts, not from a photograph of an icon.
  `lh-native-bridge` owns the device half.
- **Quiet-hours suppression firing end-to-end.** Proven by reading the comparison
  against `new Date()`; not driven, because no account has a window set and setting
  one is a mutation of a shared account.

## 7. Coverage manifest

**Database (live prod).** `notifications` · `notification_logs` ·
`notification_preferences` · `notification_type_pref_map` · `push_tokens` ·
`match_digest_queue` (read). Functions read via `pg_get_functiondef`:
`fan_out_push_on_notification` · `log_notification` · `notifications_fill_job_id` ·
`notification_job_id_from_link` · `sweep_old_notifications` ·
`notify_helpers_on_job_post` · `notify_saved_searches_on_new_job` · `handle_new_user`.
All 16 triggers on `notifications`/`jobs`/`applications`/`messages`/`reviews`/`tips`
enumerated via `pg_trigger` (all `tgenabled='O'`). 17 further DB functions that insert
`warning`/`info`/`success` enumerated by regex over `pg_get_functiondef`.

**Edge functions.** `create-notification` · `send-push-notification` (730 lines) ·
`send-notification-email` · `cleanup-notifications` · `auto-resolve-disputes` ·
`email-unsubscribe`. Grepped for producers across all 66.

**Source.** `NotificationPreferences.tsx` · `notificationPreferences/{constants,types}` ·
`NotificationPanel.tsx` · `notificationPanel/notificationDestination.ts` ·
`mobileNav/useNavUnreadCount.ts` · `lib/appBadge.ts` · `lib/notifications.ts` ·
`profile/QuietHoursClock.tsx` · `dashboard/QuickApplyHandler.tsx`. ~40 TS call sites
of the three unmapped types enumerated.

**Not opened:** the notification surface's *visual* rendering at the four
breakpoints — `lh-route-walker` and `lh-visual-critic` own that; my lane is
correctness of what reaches whom.

## 8. Out-of-scope conclusions (PROTOCOL §6)

- **Broadcast messages** — swept and **clean**. Zero references to
  `broadcast_messages`, `broadcast_dismissals`, `fan_out_broadcast_to_notifications`
  or `set_broadcast_pending_fan_out` in any notification path. No removal finding
  to hand `lh-schema-integrity` from this lane.
- **APNs / Resend transport** — deliberately not audited; `lh-native-bridge` and
  `lh-email-delivery` own them. N-001 is about the *gate in front of* Resend, not
  Resend.
- **Cron liveness** — verified only far enough to answer my own retention question;
  `lh-cron-jobs` owns the general case.
