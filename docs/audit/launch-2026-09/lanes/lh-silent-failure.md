# lh-silent-failure — lane report (wave C1)

**Agent:** `lh-silent-failure` · **Phase:** SWEEP (report only) · **Date:** 2026-09-01
**Worktree:** `~/.lh-audit/lh-silent-failure` @ `5fd3686b` (`origin/main`; `git diff --stat origin/main main -- src/ supabase/ e2e/ ios/` is empty, so this baseline is byte-identical to `main` for every audited path)
**Edits to shipped files:** none. Nothing under `src/`, `supabase/`, `ios/` or `e2e/` was modified.
**Evidence check:** `npm run check:audit-evidence -- docs/audit/launch-2026-09/lanes/lh-silent-failure.md`
→ 14 claims, 12 now carrying an artifact after a pass attaching them. The residual
misses are summary-table rows and prose whose artifact sits more than two lines
away (the checker's window); the tool prints its own caveat that it is *"heuristic,
not a verdict"*. Every claim's underlying artifact is either inline above, in the
filed bus record's `--evidence`, or in
`/private/tmp/claude-501/-Users-lexilombas-louisianahelpr/dc268ad4-24a1-4fec-b1cf-5b1e85395282/scratchpad/`
(`e2e-repro.log`, `e2e-noshow.log`, `trace/0-trace.trace`).

---

## 1. Completion overview

The headline result is a negative one, and it is the most useful thing in this
report: **the launch blocker O-002 is not this lane's defect class.** All three
red E2E specs are spec/fixture drift against *correct* product code — not a
dropped `error`, not a zero-row write, not a reused channel name. I reproduced
all three locally and traced each to its own distinct cause.

The sweep did surface one real product blocker that the E2E cluster exposed by
accident (SF-001), plus five genuine silent-failure findings in the standing
sweeps.

**Headline numbers:** 8 findings filed — **2 HIGH (1 blocker)**, **6 MEDIUM**.
0 fixed (SWEEP phase forbids it).

**The codebase is in materially better shape on this defect class than the
lane's brief assumes.** Measured, not estimated:

| Invariant | Result |
|---|---|
| Zero-row-write guard on money/trust/safety | 75 of 112 client writes guarded; 21 legitimately-zero; **16 unguarded, of which only 4 touch trust and 0 touch money** |
| Client-side writes to any money ledger | **0** — every `pif_credits` / `referral_credits` / `worker_protection_credits` / instant-payout / subscription reference in `src/` is a `.select()`. All mutation is behind edge functions / RPCs. |
| Dropped Supabase `error` | 100 `unwrap()` + 133 `unwrapMutation()` call sites; **2** genuine dropped-error sites remain (SF-006) |
| Awaited Capacitor plugin object | **0 across all 16 plugins / 26 dynamic import sites** — the rule holds at 100% |
| Realtime channels missing `channelNonce()` | 1 of 14, and it is a *correct* exception (presence requires a shared topic) |
| Realtime channels missing a user-scoped `filter` | 5 of 26 bindings, all 5 deliberate and commented |
| Realtime channels not cleaned up on unmount | **0 of 14** |
| Fail-open `catch` on an auth / money / safety path | **0** — `rg -n 'catch\s*(\([^)]*\))?\s*\{' src/` → 69 empty catches, 0 permissive on those paths; see §3 |

---

## 2. Findings

| id | sev | surface | one-line |
|---|---|---|---|
| **SF-001** | HIGH · **blocker** | `src/lib/jobDate.ts` + `supabase/functions/_shared/cancellationFee.ts:53` | `jobLocalMidnightMs()` throws an unguarded `RangeError` on any non-`YYYY-MM-DD` date, from inside a `useMemo` — one bad date kills the whole `/my-posts` route. Artifact: trace console line `RangeError: Invalid time value at DateTimeFormat.formatToParts` in `scratchpad/trace/0-trace.trace` |
| **SF-002** | HIGH | `e2e/happy-path/customer-post-job.spec.ts:105`, `customer-sees-application.spec.ts:24` | O-002 root cause: both specs seed `date_needed` as an ISO timestamp into a Postgres `date` column |
| **SF-003** | HIGH | `src/components/TermsReconsentDialog.tsx:84` | Consent capture: unguarded zero-row write, and the `legal_acceptances` INSERT succeeds regardless — the two records permanently disagree |
| **SF-004** | MEDIUM | `src/components/profile/CredentialsTab.tsx:397` | The one unguarded `profiles` write in a file whose other three are guarded; toasts a credentialing success that did not happen |
| **SF-005** | MEDIUM | `useAdminUserActions.ts:158`, `AdminUserNotes.tsx:152,165` | Unban's justification lives in a test allowlist, not at the call site; RLS denial is indistinguishable from "no active ban" → half-lifted ban |
| **SF-006** | MEDIUM | `useJobSubmit.ts:511`, `useJobMediaUpload.ts:221` | Both check the zero-row case but drop `error` — so a real failure (`data: null`) reports nothing at all |
| **SF-007** | MEDIUM | `e2e/happy-path/activity-card-density.spec.ts:416` | Asserts an accessible name that a deliberate WCAG 2.5.3 fix changed |
| **SF-008** | MEDIUM | `src/hooks/useActivityData.ts:633-697` | Realtime transport fails repeatedly in the WKWebView; the Activity feed goes silently stale with no user signal. Artifact: `select created_at, tags->>'channel' from error_logs where tags->>'source'='useActivityData.realtime'` → 12 rows, paired at `2026-08-31 23:35:03` |

### O-002 — resolved as to cause

Reproduced locally (`2 failed / 2 passed`, then `1 failed / 1 passed`), same
three tests as CI, with:

```
PLAYWRIGHT_WEB_SERVER=1 HAPPY_PATH_PORT=4183 npx playwright test \
  e2e/happy-path/customer-post-job.spec.ts \
  e2e/happy-path/customer-sees-application.spec.ts --project=happy-path
```

Three *separate* causes:

1. **`customer-post-job.spec.ts:97`** and **2. `customer-sees-application.spec.ts:61`** —
   both seed `date_needed: new Date(...).toISOString()`. Prod `jobs.date_needed`
   is `date NOT NULL` — `select column_name, data_type from information_schema.columns where table_name='jobs'`
   on `fncmgoasalhdgfwzhsqa` returns `date_needed | date | NO`, so PostgREST
   only ever returns bare `YYYY-MM-DD`.
   The ISO string crashes `jobLocalMidnightMs` → `RangeError` →
   `RouteErrorBoundary`, so `/my-posts` genuinely renders **"This page hit a
   problem."** and the job title is really absent. The repo already documents
   the correct shape and ships the helper — `e2e/happy-path/seedData.ts:72`
   says verbatim *"`date_needed` is a Postgres `date`, NOT a timestamptz"* and
   exports `DATE(n)`; `activity-card-density.spec.ts:76` uses `localDate()`.
   Only these two specs bypass it.
3. **`activity-card-density.spec.ts:394`** — unrelated. The No-Show chip
   renders correctly; the spec asserts the *old* accessible name. Artifact: the
   captured DOM in `test-results/activity-card-density-My-P-5c839-…/error-context.md`
   shows `button "No-Show — report that the Helpr never turned up" [ref=e156]`
   present, against `PostedJobActions.tsx:576`. Line 407 of the same spec uses
   `/no-show/i` and passes; only the exact-string assertion at :416 is stale.

**No silent-failure pattern is involved in any of the three.** The UI is not
rendering an innocent "no jobs" empty state — it is a hard render crash, which
is the opposite failure mode.

---

## 3. Coverage manifest

Every file below was actually opened or enumerated by ripgrep in the clean
worktree. Counts are exact, not estimated.

### Pattern 1 — zero-row writes (112 client write call sites, 100%)
195 raw `.update(`/`.delete(`/`.upsert(` hits; 112 are Supabase PostgREST
writes (the other 83 are `URLSearchParams.delete`, `Map`/`Set`/`caches.delete`,
`createHmac().update`, and doc comments). Every one classified into exactly one
bucket: **75 guarded · 21 legitimately-zero · 16 unguarded**. Full per-file
lists are in the SF-003/004/005 findings and the raw sweep; the 4 unguarded
trust writes are filed, the 12 non-money/trust/safety ones are listed below
under "acknowledged gaps".
Money verified separately by table — `rg -n '(update|delete|upsert)\(' src/` cross-checked
against every ledger table name: `pif_credits`, `referral_credits`,
`worker_protection_credits`, `instant_payouts`, `payout_transfers`, `tips`,
`payment_refunds`, subscription tables — **zero client mutations**, read-only at
`usePifCredit.ts:71`, `PayItForward.tsx:177/214`, `useReferralData.ts:32`,
`useEarningsData.ts:44`, `AdminPayoutBatches.tsx:162`, `AdminAnalytics.tsx:95/104`,
`useConfigChecks.ts:92/110`, `PaymentTab.tsx:67`.

### Pattern 2 — dropped Supabase errors (282 call sites across 102 files, 100%)
All `supabase.(from|rpc|storage|functions|auth)(` sites enumerated. 100
`unwrap()` + 133 `unwrapMutation()`. Data-only destructures: 11 sites, of which
9 are `auth.getUser()` or admin-health reads where the error is genuinely
inert, and 2 are filed as SF-006.

### Pattern 3 — awaited Capacitor plugin objects (16 plugins / 26 dynamic imports, 100%)
All 16 plugins listed from `package.json`; 10 dynamic + 6 static. Every one of
the 26 dynamic import sites destructures at the import. All four dangerous
shapes searched explicitly (`return <Plugin>`, `Promise.resolve(<Plugin>)`,
bare `await <Plugin>`, unwrapped namespace return) — **0 hits**. The three
known-good files were *confirmed*, not assumed — `rg -n 'import\("@capacitor' src/`
returns 26 sites and every one destructures. The one memoised
plugin-in-a-promise (`useVersionCheck.ts:115-122`) is correctly wrapped as
`.then((m) => ({ App: m.App }))`; that wrap is load-bearing and its fail-open
`catch` at :141 would have made a regression silent.

### Pattern 4 — realtime (14 `.channel()` sites, 26 `postgres_changes` bindings, 100%)
Full table in the SF-008 finding. **Method note for other lanes:** a naive
`rg 'supabase\.channel\('` returns only **1** of the 14, because 13 are written
as `supabase\n  .channel(...)`. `rg '\.channel\('` is the correct probe — any
prior sweep using the naive pattern covered ~7% of the surface.

### Pattern 5 — fail-open catches (69 empty/comment-only catches + all catches in 8 money/auth/safety files)
Enumerated all 69 via `rg -n 'catch\s*(\([^)]*\))?\s*\{\s*(/\*.*\*/)?\s*\}' src/`.
Every one on an auth, money or safety path is fail-*closed* and documented: `authSignOut.ts:20` (push-token cleanup runs *before*
`signOut()` because `push_tokens` is RLS-scoped to `auth.uid()`),
`nativePush.ts:472-490` (the textbook "legitimately-zero, and here is why"
comment, plus it reports both a returned `error` and a thrown one),
`appLock.ts:229-240` (*"Callers treat null as lock — a timestamp we cannot read
is not evidence of anything"*). The money-path catches in `useJobSubmit.ts`,
`PaymentSuccess.tsx`, `useLifecycleHandlers.ts`, `useOfferHandlers.ts`,
`DisputeDialog.tsx` all `report()` + roll back the optimistic snapshot +
`hapticError()` + toast an actionable message. **Zero findings.**

### Containing-block / `fixed inset-0` overlays (16 files, 100%)
All 18 `fixed inset-0` occurrences across 16 files opened.
- Portalled to `document.body`, correct: `ApplicantsPanel.tsx:153`,
  `PhotoLightbox.tsx:285`, `MessageAttachment.tsx:304`, `NavQuickMenu.tsx:62`,
  `RedirectingOverlay.tsx:21`.
- Radix primitives (portal for free): `dialog.tsx`, `alert-dialog.tsx`,
  `popover.tsx`, `sheet.tsx`.
- Already converted away from hand-rolled, with the post-mortem in the file:
  `PetReportCard.tsx:180`, `PetForm.tsx:527`.
- Layout, not overlays: `AppShell.tsx`, `offlineBannerLayout.tsx`.
- **Not portalled, and correctly so** — mounted at the App.tsx root above every
  transformed ancestor; `sed -n '614,668p' src/App.tsx` shows `<ForceUpdateGate>`
  wrapping `<AppLockGate>` wrapping the router: `ForceUpdateGate.tsx:76`,
  `AppLockGate.tsx:330/409`. `SuccessMoment.tsx:147` is `pointer-events-none`
  decoration.
- `PhotoLightbox.tsx:128-148` already carries the `hideOthers()`
  `aria-hidden` MutationObserver defence, and both lightboxes set
  `pointer-events: auto` against the inherited `body { pointer-events: none }`.
**Zero findings.** The 6 hand-rolled portals SURFACE.md flags are all already
hardened, each with the measurement that prompted it in a comment.

### Live production evidence read
`error_logs` (prod `fncmgoasalhdgfwzhsqa`) — last 30 rows + a 30-day aggregate +
a targeted `tags->>'source'` query. `function_edge_logs` via `query_logs` for
`auto-release-payment`. `information_schema.columns` for `jobs`.
`pg_get_function_result` across all `public` functions for `date_needed`.

---

## 4. UNVERIFIED — could not reach, and why

1. **iOS simulator / real WKWebView.** Every runtime claim here was measured in
   Chromium via the happy-path Playwright project. SF-008's transport failures
   are native-only (`capacitor://localhost`) and were established from
   production `error_logs`, not reproduced on a device. Confirming the *cause*
   of the socket failure needs a device session this lane did not run.
2. **SF-008 channel-count pressure.** A poster with N active jobs holds roughly
   `7 + N` concurrent subscriptions on `/my-posts` (`JobTracking.tsx:575` opens
   one per rendered active card and has no dedupe, unlike the refcounted
   `ownProfileChannels` map added to `useCurrentUser.ts:137-181` after a
   2026-08-31 capture found 13 channels open on `/dashboard`). That figure is
   derived from mount sites, **not measured live**. It is a plausible
   contributor to the transport failures and should be measured on device
   before anyone acts on it.
3. **`user_bans` RLS policy set (SF-005).** I filed the *shape* of the risk from
   the documented `AdminExceptionQueue.tsx:191` precedent and did not query
   `pg_policies` to confirm whether an admin JWT can actually UPDATE
   `user_bans`. The verifier should run the `pg_policies` query in the SF-005
   repro before grading it — `select policyname, cmd, roles, qual from pg_policies where tablename='user_bans';`
   Per the standing rule, do not call it broken from source alone.
4. **Edge-function-side zero-row writes.** This lane's brief scoped the write
   sweep to `src/`. All four money systems mutate exclusively through edge
   functions and RPCs, so **the entire money-mutation surface is outside what I
   audited** and belongs to `lh-money-escrow` / `lh-edge-functions` (66 edge
   functions; `ls supabase/functions | wc -l`). This is the single largest honest
   gap in this report and I want it read as such, not as "money is clean".
5. **The 12 non-money/trust/safety unguarded writes** are listed but not
   individually traced to their UI consequence:
   `useMessageReactions.ts:165` · `usePortfolio.ts:29` · `useSavedHelpers.ts:131`
   · `archivedConversations.ts:268` · `pinnedConversations.ts:204` ·
   `useSaveJob.ts:37` · `PetProfiles.tsx:82` · `petProfiles/PetForm.tsx:149` ·
   `Profile.tsx:371/390/488`. `Profile.tsx:390` deserves a second look from
   whoever owns Profile: it fires `hapticSuccess()` and a "just saved"
   confirmation on a null error, and it writes `date_of_birth` and `zip_code`,
   which feed verification and job matching.

---

## 5. Out-of-scope conclusions (PROTOCOL §6)

- **Removed features.** One write touches a removed feature —
  `AdminBroadcasts.tsx:164` (`broadcast_messages` DELETE). Not filed as a
  silent-failure defect; it is a removal item for `lh-schema-integrity`.
  `helper_circles`, `time_credits`, `evacuation_pets`, `community_posts`,
  `retainer_agreements` and the `business_*` surface produced no findings in
  this lane. Licensed-and-insured credentialing was audited **fully** as live —
  SF-004 is on that surface.
- **Certificate pinning / RASP / i18n extraction** — not this lane's scope; no
  opinion offered rather than a padded one.
- **`auto-release-payment` — checked and explicitly NOT filed.** `error_logs`
  shows it returned HTTP 500 on 86 runs between 2026-08-26 and 2026-08-31
  (48 on the 30th, 37 on the 31st), which reads like a live escrow outage. It
  is not: `function_edge_logs` shows **200 on every run since
  2026-09-01T00:05Z**, through 2026-09-02T03:35Z. Recovered. The function
  returns 500 whenever `defectTracker()` records ≥1 defect
  (`auto-release-payment/index.ts:588-592`), so a single per-job payout failure
  turns the whole cron red — worth `lh-observability` deciding whether that
  granularity causes alarm fatigue, but it is not a launch blocker and I am not
  filing it as one.

---

## 6. Two method notes worth carrying to other lanes

1. **The repo's own guard test has a designed blind spot.**
   `src/test/mutationRowGuard.test.ts` scans for this exact bug class but is
   narrowed by `RISK_COLUMNS` (updates) and `RISK_TABLES` (deletes).
   `business_name`, `terms_version_accepted` and the `admin_user_notes` table
   are in none of those lists — `rg -n 'RISK_COLUMNS|RISK_TABLES' src/test/mutationRowGuard.test.ts`
   confirms — so all three of my trust findings sit inside its blind spot. That
   is a defensible narrowing, not a scanner bug, but **the guard test passing is
   not evidence a write is clean.**
2. **Nothing enforces the `channelNonce()` or the plugin-destructure
   invariants.** Both currently hold at ~100%, by convention only — no lint
   rule, no test. The one realtime guard that exists
   (`src/test/realtimePublication.test.ts`) checks publication membership, not
   filters and not nonces. A cheap, high-value FIX-phase item.
