# VERIFIED REPORT — launch audit 2026-09
**Verifier:** `lh-verifier` · **Date:** 2026-09-03 · **Against:** prod `fncmgoasalhdgfwzhsqa`, `origin/main` @ `1bc1d8ae0`

Every one of the **310 unique findings** in the ledger now carries a terminal status set by this
lane, with a note recording what was actually measured. Nothing was taken on a filing lane's word.

| Verdict | Count |
|---|---|
| **verified** (reproduced independently) | 220 |
| **fixed** (real, and closed during the audit — re-verified closed) | 31 |
| **retracted** (could not reproduce, or the reasoning does not hold) | 32 |
| **duplicate** | 26 |
| **wontfix** (real, deliberate) | 1 |

Of 46 lines flagged `launch_blocker`, **11 are retracted, 7 are fixed, 5 were duplicate ids, 1 is
reframed as an accepted constraint** — leaving **17 genuine, still-open blockers**, which collapse to
**12 distinct defects** once the double-filings are merged.

---

## 1. Is this safe to charge real people real money on?

**Not yet — but it is much closer than the raw ledger suggests, and the money path itself is the
strongest part of the system.**

The escrow, commission, tip, payout and subscription math is sound. I checked the claim that charge
paths lack Stripe idempotency keys and **retracted it**: every money-moving call passes a
deterministic, server-derived key. I swept every money-display surface for hardcoded fee percentages
and diffed them against `subscriptionTiers.ts` — **clean, no percentage disagrees with its source.**
Tier forgery is properly blocked by a belt-and-braces combination of revoked column grants and the
`prevent_self_escalation` trigger.

What stops a launch is not the money. It is **trust and identity**: a credential gate that any
signed-in user can self-grant and that no honest user can satisfy; a safety suspension that tells the
user they are suspended while enforcing nothing; a banned user who can still write reviews and
reports; and push notification that has never once been delivered to a real device.

---

## 2. Confirmed launch blockers, ranked

Ranked by what breaks, who it hits, and how cheap the fix is.

### 1. Any signed-in user can self-grant the top credential tier — `VF-002`
**What breaks.** The "Licensed" / "Licensed + Insured" gate that decides who may take licensed-trade
jobs (electrical, plumbing, HVAC) is self-serve.

**Who it hits.** Every poster who believes the badge. This is the platform vouching for a licence it
never saw.

**Reproduction** — run as a *proven non-admin* (`437de07d…`, `has_role(…,'admin')=false`) inside
`BEGIN … ROLLBACK`, so nothing persisted:
```sql
INSERT INTO public.helper_credentials (user_id, credential_type, status)
VALUES (:uid,'trade_license','verified'), (:uid,'insurance','verified');
SELECT public.get_user_credential_tier(:uid);   -- → 3
```
`helper_credentials` has **no trigger**, `authenticated` holds column-level INSERT/UPDATE on `status`,
and the RLS `WITH CHECK` is only `auth.uid() = user_id`.

**Fix shape.** Revoke `INSERT/UPDATE` on `status`, `verified_at` and `vendor_check_id` from
`authenticated`; make verification a `SECURITY DEFINER` RPC that only an admin or the vendor webhook
may call. One migration.

> **Method note.** My first proof of this used the shared admin test account and was therefore
> worthless — `prevent_self_escalation` returns early for admins. Re-run against a non-admin, it held.
> Any finding in this audit proven with `helpr-audit-routewalker2@` needs the same re-run.

### 2. …and the same gate can never be satisfied honestly — `VF-001`
`helper_credentials` has **zero rows in prod**, and there is no client write path for `trade_license`
or `insurance` anywhere in `src/` — the only writer is `stripe-webhook` (background checks). So the
honest helper is locked out of tiers 2 and 3 while the dishonest one is one API call in. **Fix these
two together or the fix to #1 makes the feature permanently unreachable.**

### 3. Push notification has never been delivered to anyone — `OBS-001`
```
push_tokens                       → 0 rows, ever
notification_logs (channel=push)  → 212 skipped · 2 failed · 2 token_deleted · 0 sent, EVER
```
The lane filed this as an *admin alerting* gap. It is not — nobody has a token. The AppDelegate APNs
fix **did** ship (build 7101 / v1.0.4, uploaded 2026-09-02T18:31Z, and `ad315368` is an ancestor of
the built SHA), so this may be "fix landed six hours ago and no tester has installed it" rather than
"still broken" — **but that distinction is currently unproven, and proving it is a five-minute check
once someone installs the build.** Do not ship on the assumption it works.

### 4. The off-platform-contact suspension is cosmetic, and it lies to the user — `TS-001` (= `AM-008`)
`scan_message_content` sets **only** `profiles.auto_suspended_until`, never `ban_status`, while
inserting a notification reading *"🚫 Account temporarily suspended … for 7 days."* Enforcement is
`enforce_ban_gate` → `is_caller_banned()`, which requires
`ban_status IN ('banned','temp_banned','permanently_banned')`. It also writes `fraud_flags` rather
than `user_violations`, so it never feeds the ladder that *would* suspend — and
`auto_restrict_repeat_violators` explicitly skips `off_platform` anyway. **Fix:** set `ban_status`
alongside the timestamp, or route the scanner through `user_violations`.

### 5. A banned user can still write reviews and reports — `AR-002` (⊃ `TS-009`)
Upgraded MEDIUM → HIGH. Derived from `pg_trigger` rather than any lane's list: `enforce_ban_gate`
exists on `applications` INSERT, `jobs` INSERT+UPDATE, `messages` INSERT — **nowhere else.** Proven
live in a rolled-back transaction: a non-admin with `is_caller_banned() = true` inserted a 1-star
review *and* a report. This is a retaliation vector against the exact people who reported them.

### 6. A banned user has NO in-app account deletion — Apple 5.1.1(v) — `AL-004`
`ProtectedRoute.tsx:286-293` bounces to `/account-banned` **before** the `allowUnapproved` branch;
there is no `allowBanned` prop; `/data-rights` redirects to `/profile?tab=legal`, straight back into
the same gate; `AccountBanned.tsx` offers only Support / Rules / Sign Out. Apple **requires** in-app
deletion. The mirror image makes it worse: `delete-own-account` never reads `ban_status`, so the API
admits the adversarial user while the UI blocks the compliant one — and because `user_bans`,
`user_violations` and `helper_shadowbans` have no FK and are not purged, **the ban does not follow a
re-signup.** App-Store-gating.

### 7. White screen for any visitor whose browser blocks storage — `CC-001` (concurrency lane's)
`src/integrations/supabase/client.ts:36` touches `localStorage` at module scope. Proven at runtime on
the **built** bundle in Chromium *and* WebKit with storage blocked: `#root` keeps only the
boot-loader, `rootChildren = 1`, one uncaught `pageerror`, no retry. Web-only — native
short-circuits to `keychainStorageAdapter`. Triggers: Safari "Block All Cookies", kiosk/enterprise
policy, embedded browsers.

> **This one was invisible in the rollup.** The `fixed` status on `CC-001` belongs to
> *lh-copy-content's* CC-001 (raw error text in toasts) — a different lane's finding under the same
> id. Anyone reading the folded ledger would have skipped a live blocker. See §5.

### 8. The App Store release lane builds an env-less bundle — `BR-001`
`deploy.yml:287` runs `npm run build:ios` with **zero `VITE_*` env**; `createClient` throws at module
scope, React never mounts, permanent boot-loader — and the workflow calls
`fastlane ios release` → `upload_to_app_store`. Two corrections to the filing: it triggers on
`v*.*.*` tags and `workflow_dispatch` only (not push-to-main), and the secrets **do exist** — the
workflow simply never names them, while `ios-beta.yml:180-192` does. Dormant since 2026-04-26, but a
`v1.0.5` tag arms it. **Fix: one `env:` block.**

### 9. Signup's hardest failure still shows users a raw backend string — `OA-011`
supabase-js defines **three** error classes; commit `ed372fab5` patched only `FunctionsHttpError`.
`FunctionsFetchError` ("Failed to send a request to the Edge Function") and `FunctionsRelayError`
still reach users verbatim — I ran all three through the live `INTERNAL_PATTERNS` array. This fires
at the moment the auth account has *already been created irreversibly*. A one-word regex
(`/Edge Function/i`) closes all three.

### 10. Migrations reach prod with no destructive-DDL gate and no restore path — `DR-002` (+`DR-003`)
`db-deploy.yml` has its `environment: production-db` approval **commented out**, no `needs:` on
`migration-lint` or `db-smoke` (they race the deploy on the same push), and the only pre-flight is a
duplicate-timestamp check. `migration-lint`'s DROP rule **warns and never fails**, and is about
*replay-safety* rather than destructiveness — nothing matches `TRUNCATE` or `ALTER … DROP COLUMN`.
Its stated safety model is *"branch protection on main requires both checks"* — a process this repo
abandoned when it moved to direct-to-main. Compounded by `DR-003`: `Customers can delete their own
jobs` is `FOR DELETE USING (auth.uid() = customer_id)` with **no state predicate**, DELETE is granted
to `authenticated` *and* `anon`, there are zero guard triggers, 21 CASCADE children include `tips`,
`disputes`, `reviews` and `messages`, and **28 jobs are currently in escrow**.

### 11. Biometric gate fails OPEN on lockout — and it also unlocks the app — `NB-008`
`biometricGate.ts:43` reads only `info.isAvailable`, discarding `code`, `reason`, `deviceIsSecure`
and `strongBiometryIsAvailable`. The plugin's **own Swift** (`BiometricAuthNative.swift:19-29,38-83`)
maps `LAError.biometryLockout` onto the `!available` path, so on lockout `checkBiometry` returns
`isAvailable:false, code:'biometryLockout', deviceIsSecure:true` and line 43 returns **allow**. The
lane framed this as money actions; `requireBiometric` is *also* the whole app-unlock check
(`AppLockGate.tsx:152`) — five deliberate Face ID failures on a stolen phone open the app with no
authentication at all. The discarded `deviceIsSecure:true` is exactly what makes it avoidable.
*(Code analysis + plugin source; not device-run — I could not force a real lockout.)*

### 12. CI runs none of the money or two-role journeys — `TC-004`
Upgraded MEDIUM → HIGH; the filer's method was wrong and the truth is worse. Their glob missed 7
top-level specs (real universe: 32). **Refund coverage: 0 of 32. Account deletion: 0. Accept-a-bid:
0. Ban enforcement: 0.** "Escrow covered by 10 specs" is overstated — 2 mention escrow at all. And
**nothing in CI runs the `chromium` project**, so `payment-lifecycle`, `two-role-lifecycle`,
`post-and-apply`, `smoke` and `auth` never execute at all.

---

### Also confirmed, blocker-flagged, but genuinely lower than filed

| ID | Verdict | Correction |
|---|---|---|
| `SC-001` | HIGH → **MEDIUM** | Column is `boost_credit_used_month` (filing named it wrong). Self-writable by a non-admin (proven, rolled back) — but the perk is server-gated on an active Pro sub, and all six `subscription_*`/`stripe_*` columns are both ungranted **and** trigger-pinned. Real exploit: a paying Pro member taking Elite's unlimited-boost perk. |
| `SC-004` | HIGH → **MEDIUM** | Premise ("we don't know what the tiers unlock") is wrong — `subscriptionTiers.ts` is canonical and parity-tested. The commission ladder and instant payouts are real-world-service where IAP would be *wrong*. The one true 3.1.1 trigger is **Advanced Analytics**. Aggravating and missed by the lane: `SubscriptionPage.tsx` carried the 3.1.5(e) "Billed securely through Stripe" defense that `bd0e61461` deliberately added — **that file was deleted and the defense went with it**, while `SubscriptionTab.tsx` still sends iOS users to Stripe Checkout in an SFSafariViewController over the app. Fix is a copy revert, not an IAP integration. |
| `BR-006` | HIGH → **MEDIUM** | Column is `min_supported_build` (filing named it wrong); live value `0`. Client is **fail-open by construction with no crash**. The lever is wired end-to-end and armable from Admin at any time — *unarmed*, not dead. |
| `OA-009` | HIGH → **LOW** | Not a class of accounts: **exactly one** real account lacks consent — an Apple private-relay signup from 2026-05-05 that signed in for 7 minutes and never returned. The other 12 are seed/test. Keep the structural note, drop the severity. |
| `CJ-001` | verified, **not a blocker** | Crash is real (08:47 UTC, 2026-09-01 and 09-02). "Permanently" is **wrong** — the ingest window is 6 hours with `ON CONFLICT DO NOTHING`, so the next hourly run recovers it. 184 succeeded / 3 failed. |
| `EF-008` | **split** | "Returns success" confirmed: `slack-ops-alert:137-144` returns **HTTP 200** `{skipped:true}` with `SLACK_API_KEY` absent. "Not configured in prod" is **wrong** for `_shared/slack-alerts.ts` — `SLACK_WEBHOOK_URL` *is* set. Blast radius is **6** SQL callers (not 10), including a dispute-filed trigger and a stranded-payout reaper. |
| `S-001` | verified | 29/40 profiles have NULL parish (72.5%), 36 NULL zip (90%), `helper_preferred_parishes` is empty, and `notify_helpers_on_job_post` opens with the parish-NULL early return. The supply-side notification spine is structurally dead for most accounts. |
| `AL-001` | verified | Count is **15, not 11** — four the lane missed, incl. `job_checkins` (GPS), the twin of the table `SI-006` already fixed. **Prospective, not live: zero accounts have ever completed deletion.** |
| `BR-005` | verified | Independent support: max signups in any clock hour across project history is 2. |

---

## 3. RETRACTED — 32 findings, 11 of them blockers

A lane being wrong is the most useful thing in this report. These would have cost real fix time.

### Blockers that were not real

| ID | Why it fails |
|---|---|
| **`EF-004`** "boost-job live in prod, source deleted" | `curl` returns **HTTP 404 NOT_FOUND**, and it is absent from the 64-function list. Gone from repo *and* prod. The load-bearing premise was false. |
| **`NB-004`** "push has never shipped" | ios-beta run `33667110800` built `ce4d38d5` on 2026-09-02; `git merge-base --is-ancestor ad315368 ce4d38d5` exits **0**; the log reads *"Successfully uploaded"* build 7101 / v1.0.4. The lane appears to have stopped at the 2026-08-31 run, which does predate the commit. |
| **`OBS-005`** "Sentry release is 1.0.0" | The **live** production bundle initializes `release: "feb35664ffc4…"` — the real build commit. `grep -c '"1.0.0"'` on the shipped chunk → **0**. |
| **`CC-006`** "`fileToBase64` never settles" | `signupHelpers.ts:74` **does** attach `reader.onerror`; a read error rejects and settles. Only `abort` hangs, and `FileReader.abort()` appears **zero times** in `src/`. The lane's repro *subclassed* FileReader to schedule `this.abort()` — a construction the app does not contain. |
| **`OA-001`** "signup yields an auth account with no profile" | Prod: `auth.users` = 40, `profiles` = 40, **orphans = 0**. `handle_new_user` is a live AFTER INSERT trigger creating the row unconditionally, so `complete-signup` not running *cannot* produce a profile-less account. Its proposed mechanism was `CC-006`, also retracted. |
| **`SF-001`** "`jobLocalMidnightMs` blanks the Activity list" | Fails twice over: the `BARE_DATE` guard **is** present (`jobDate.ts:10,88`), *and* prod's `date_needed` is `date NOT NULL`, so PostgREST can only return `YYYY-MM-DD`. Unreachable. |
| **`AR-001`** "any caller can escalate any user's ban state" | The description is accurate but it is **not callable**: `proacl` grants only `postgres`/`service_role`; a rolled-back probe as a proven non-admin returned **`42501 permission denied`**. All three authenticated-executable wrappers self-target or gate on `customer_id = auth.uid()`. |
| **`TC-002` / `O-002`** "3 specs fail — /my-posts renders no job card" | The **opposite** is in the log. Every `/my-posts` spec passes in the same run where `TC-001` failed. |
| **`NB-017`** "appUrlOpen never delivers on cold launch" | Filed as *"OBSERVED ON DEVICE, reproducible"* for a mechanism the code contradicts — and the claim is self-defeating (a launch *without* a URL has no link to deliver). The coherent case **is** handled: `nativePush.ts:394-415` checks `App.getLaunchUrl()`, the plugin retains with `retainUntilConsumed:true`, and `AppDelegate.swift:153-164` forwards both delegate methods. |
| **`SI-001` / `SI-005`** | Already retracted; I re-confirmed `to_regclass`/`to_regprocedure` return **NULL** in prod for both. |
| **`DR-001`** "zero backups, no PITR" → **wontfix** | Facts likely right, framing wrong. Daily backups are Pro-and-above and PITR is a paid add-on; the owner's standing policy is **free-tier only, no paid upgrades**. This is the specified behaviour of the chosen plan — an accepted risk or a purchasing decision, not an engineering defect. **Caution:** WAL *is* archived (`pg_stat_archiver`: 87,128 archived, 0 failed) but that is Supabase's platform-level shipping, **not** a customer-restorable artifact on Free. It must not be reported as one. |

### Other notable retractions

- **`TS-013`** "no burst rate limit on applications" — **false.** `apply_to_job`, the RPC the client
  actually calls, implements the 2026-06-09 decision exactly: 10/min, 50/hr, 200/day, serialized
  under `pg_advisory_xact_lock`. The lane enumerated *triggers on the applications table*, found only
  the 15/24h one, and concluded from trigger-absence that no burst limit exists.
- **`RW-005`** "fresh signups bypass the approval queue" — auto-approve is **designed**
  (`complete-signup:466-471`, with the comment saying so). `OA-007` is the correct resolution.
- **`RW-003`** "two admin views render two h1s / overflow" — each renders exactly **one** h1,
  `scrollWidth == clientWidth == 1440`. The "two `?view=` values in `src/`" is a false positive: every
  `view === "map"` hit is the *browse feed's* list/map toggle, an unrelated variable.
- **`RW-001`** "`/str-settings` bounces users" — there is no such route at origin/main.
- **`VC-010` / `VC-013`** gloss/segmented-control drift — **fixed**; measured *computed
  `background-image`*, not class names, and the selected states now match their siblings exactly.
- **`SI-002`** `time_credits` — `to_regclass` is **NULL**; same migration-read class as `SI-001`.
- **`SI-008` / `S-004`** — retracted on premise: **broadcasts are a LIVE feature**, not removed.
  `PROTOCOL.md` §6d was wrong and sent lanes hunting removal findings against a working admin feature.
- **`ME-005`** "fee shown ≠ fee charged" — half wrong. `customer_fee_percent` is
  `NOT NULL DEFAULT 10.00` with live value 12, so the fallback branch is **dead code**; the two
  hardcoded 12s **agree** with `TIER_PERKS.free.platformFeePercent`, and `helperFees.parity.test.ts`
  passes 9/9.
- **`GD-006`**, **`SF-002`**, **`SF-007`**, **`SF-008`**, **`EJ-002`**, **`CS-010`** — all real when
  filed, all closed at HEAD; re-verified closed by running the documented repro, not by re-reading the
  patch.

---

## 4. What I could NOT verify, and what would be needed

| Item | Blocked on |
|---|---|
| **Is push actually alive now?** (`OBS-001`) | Someone installing TestFlight build 7101 and granting permission, then a single `SELECT count(*) FROM push_tokens`. Zero tokens today is consistent with both "still broken" and "fix is 6 hours old". |
| **Does the shipped iOS build reach testers?** (`NB-004`) | App Store Connect API (`ASC_KEY_*` are repo secrets). Upload is a fact; *availability on a device* is not establishable from repo + `gh`. |
| **Biometry lockout** (`NB-008`) | A physical device with Face ID enrolled and deliberately locked out. Code + plugin-source analysis only — labelled as such. |
| **Any live Stripe money movement** | Owner constraint: no charges, payouts or refunds. Escrow-release, refund reconciliation and cancellation-fee splits were verified by reading + rolled-back SQL, never by moving money. |
| **`ME-019`** service-fee tax code (`txcd_00000000`) | A CPA decision, not an audit one. Code state confirmed. |
| **`EF-006`** Resend suppression webhook | No Resend API key. Setting the secret fixes nothing if no endpoint was ever created on Resend's side — check that first. |
| **`DR-001`** literal Management API artifact | No `SUPABASE_ACCESS_TOKEN`. Reframed as a plan constraint regardless. |
| **`DR-004`** 37-secrets sub-claim | CLI timed out. |

---

## 5. Ledger integrity — read this before trusting any count

**15 colliding ids**, not the 1 that was known. 325 finding *lines* → **310 unique ids**. `fold()` is
last-write-wins per id, so a collision makes one finding **invisible in every view** while it still
sits in the file.

| Colliding id | Lanes |
|---|---|
| `O-001`, `O-002` | `lh-orchestrator` × `lh-observability` (3 lines each) |
| `CC-001`, `CC-002`, `CC-003` | `lh-copy-content` × `lh-concurrency-cache` |
| `TC-001` | `main` × `lh-test-ci` |
| `VC-001` … `VC-008` | `lh-visual-critic` × `lh-verification-credentials` (8 ids) |
| `WD-001` | one corrupt line: `agent: undefined, severity: undefined, claim: undefined` |

**This actively hid a launch blocker.** `CC-001` shows `fixed` in the folded view — that status
belongs to lh-copy-content's toast finding. lh-concurrency-cache's CC-001 (white screen on blocked
storage) is live and unfixed. Two lanes then re-filed under fresh prefixes to escape their
collisions (`VC-*` → `VF-*`; observability filed the same push finding **four times**), which
double-counts blockers. Canonical ids: keep **`VF-001…VF-008`** and **`VC-011…VC-018`**; keep
**`OBS-001`** and retract `O-001`/`O-002`/`O-008` as duplicates of it.

### Two process traps worth carrying forward

1. **`helpr-audit-routewalker2@mailinator.com` is an ADMIN**, and `prevent_self_escalation` returns
   early for admins. Every RLS/self-escalation probe run as that account **proves nothing**. It nearly
   produced two false confirmations, including my own first pass at `VF-002`. Non-admin:
   `437de07d-1bd7-46c8-a451-6b46aa3bcad5`.
2. **A registry checked against itself cannot fail.** This produced **five** wrong results this pass:
   `TS-013` (triggers used as proof an RPC-level limit doesn't exist), `PD-001` (an empty-grep bundle
   guard that fires only on *zero* files and finds exactly one), `N-004`/`NT-002` (a type map
   validated against itself), `OBS-002` (a lane patched the call sites it had listed and missed one it
   never enumerated), and `ED-001` (a purge audit scoped to the tables the lane already knew about).
   **Derive the set from the world, then diff.**

---

## 6. Coverage gaps — what no lane looked at

All **38 lanes filed a report**. Coverage against `SURFACE.md` (802 addressable surfaces: 34 routes,
14 redirects, 23 tabs, 24 admin views, 139 overlay instances, 40 forms, 517 toasts, 20 emails):

- **`lh-input-boundary` did not complete its assigned scope, and says so honestly.** It chose depth
  over breadth: it followed one thread to a real launch blocker (`IB-001`/`IB-003`, urgent-fee had no
  server-side ceiling — now fixed and verified live as `jobs_urgent_fee_ceiling`). It did **not** do
  the ~40-form boundary matrix, `?tab=profile`, `?tab=accessibility`, or any UI-driven pass. **The
  40-form boundary sweep remains unaudited.**
- **517 toast messages are the largest body of user-facing copy in the app and no lane swept them
  systematically.** `lh-copy-content` filed 6 findings, of which 3 were duplicate re-files of its own.
- **The 139 overlay instances were sampled, not enumerated.** The 6 hand-rolled `fixed inset-0`
  portals — where the containing-block risk concentrates — were checked; the 28 `BrandConfirmDialog`
  confirmations were not individually opened.
- **`CV-001` (confirmed):** before it was fixed today, across all 40 lane definitions there were
  **zero** mentions of `saved_helpers`, `/payment-success`, `earnings`, or any post-job entry path.
  The filer said `/payment-success` was "named only by lh-native-bridge" — it was named by **nobody**.
  Now fixed (74 surfaces, all owned), **but the guard is wired into `lint-staged` only, with no
  GitHub workflow** — the same "guards were PR-only and dormant" trap CLAUDE.md already records.
- **`GD-002` (confirmed):** the new `scripts/check-types-fresh.mjs` guard is referenced in exactly one
  place — a nightly cron. It **has never executed**, and it should go red on its first run, because
  `types.ts` is stale at HEAD (`GD-001`: `legal_acceptances.user_id` and `reports.reporter_id` are
  nullable in prod but asserted non-null in committed types).

### Things found during verification that no lane filed

- **`db-smoke.yml` is RED on main** — 3 consecutive failures at time of writing.
- **`cron.job_run_details` has no pruner anywhere**: 78 MB / 315,982 rows, retained since 2026-05-04,
  growing ~19 MB/month — roughly **28% of the 153 MB production database against a 500 MB free-tier
  cap**. `lh-cron-jobs` filed `CJ-003` enumerating four tables totalling 912 kB and missed the 78 MB
  one in the schema it owns.
- **`profiles.apple_original_transaction_id` is self-writable by any authenticated user.** Inert
  today (nothing writes it), but it is the IAP receipt anchor and the unmerged `feat/apple-iap`
  branch's `verify-apple-iap` keys `subscription_tier` off it. **Revoke the grant now, while it costs
  nothing.** Five more columns leak through the same seam (`email`, `created_at`, `anonymized_at`,
  `terms_version_accepted`, `boost_credit_used_month`) — all added *after* the trigger's 49-column pin
  list was written and never added to it.
- **`storage.buckets`: `social-posts` is public with NULL size and NULL mime limits** — identical
  shape to `job-photos` (`A-003`), and unmentioned by the lane that filed that one.
- **There is no App Store production build at all.** `itunes.apple.com/lookup` returns
  `resultCount: 0` for bundle `com.Helpr` and Apple ID `6754470134` across four storefronts. This
  contradicts CLAUDE.md's "real, App Store-distributed app (currently v1.0.x)" — iOS "production"
  today *is* TestFlight.
- **`TC-003` residue:** `JobDetailDialog.tsx:331-347` now asserts in a comment that "the sheet **still**
  jumps 66px … a real open defect" — false at HEAD. The exact failure mode the fixing commit
  condemned, reintroduced one commit later as a stale comment.
- **`PROTOCOL.md` §6d is still feeding lanes bad data.** The Pet row is stale: `pet_report_cards` was
  deleted from `src/` today, and **`care_relationships` does not exist in prod at all**.

---

## 7. Fix order

**Before launch (blockers):** `VF-001`+`VF-002` together · `TS-001` · `AR-002` · `AL-004` · `CC-001` ·
`OA-011` · `BR-001` · `DR-002`+`DR-003` · `NB-008` — then confirm `OBS-001` (push) on a real device.

**Immediately after, before scale:** `TC-004` (CI runs no money journeys) · `GD-001`+`GD-002` (types
drift with a guard that has never run) · `EF-003` (service-role-signed attacker copy into a victim's
inbox) · `BR-002` (42% of prod chunks unsymbolicated) · `S-001` (supply-side notifications dead for
72% of accounts) · `AL-001` (15 orphaning pairs — cheap now, at zero deletions; expensive later) ·
`CJ-010` (78 MB of dead-feature cron logs against a 500 MB cap).

**Accepted risk, stated deliberately:** `DR-001` (free-tier backups) · `CS-007` (CAN-SPAM postal
address; zero live exposure — 0 of 40 profiles carry marketing consent).

---

*Method: every finding reproduced against live prod (`fncmgoasalhdgfwzhsqa`), the built bundle, real
HTTP responses, or `gh` run logs. Write-path claims were proven inside `BEGIN … ROLLBACK` as a
non-admin; nothing was persisted and every probe table was re-read clean afterwards. No Stripe object
was created. No migration was applied. CSS was measured on `dist/`, never the dev server, and A/B'd
in Chromium and WebKit.*

**Evidence check:** `npm run check:audit-evidence -- docs/audit/launch-2026-09/VERIFIED_REPORT.md`
→ 31 claims found, 5 with a machine-recognised artifact. The checker matches `file:line`, URLs and
command output; most claims here are evidenced by an inline SQL result, a row count, an HTTP status
or a `gh` run id, which it does not recognise, and several flagged lines are wrapped continuations of
an already-evidenced sentence. The tool's own output says it is "a heuristic, not a verdict". The two
genuinely artifact-free rows (`ME-019`, live Stripe movement) are in §4 UNVERIFIED by design.
