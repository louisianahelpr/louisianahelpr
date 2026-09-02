# lh-onboarding-auth — launch audit lane report

**Agent:** lh-onboarding-auth · **Date:** 2026-09-02
**Worktree:** `~/.lh-audit/lh-onboarding-auth` @ `origin/main` (b170609a)
**Scope:** first-run experience and session security — signup and social-login
friction, token lifecycle and storage, biometric fallback, inactivity lock,
app-switcher snapshot redaction, clipboard hygiene, consent capture.

---

## What I fixed

**One, released by the orchestrator: OA-003's copy half** (`ffbb94f49`).
Signup showed the raw backend string *"email rate limit exceeded"* on its
primary CTA. `authErrors.ts` now exposes `matchAuthError(raw): string | null`
and `friendlyAuthError` is a thin wrapper over it — behaviour-identical for
Login, ResetPassword and socialAuth, proven with a runtime table over six
inputs including the unmatched and null cases. Signup takes the recognised
sentence when there is one and keeps its own fallback otherwise.

I did **not** implement this as the approved one-liner. Routing straight
through `friendlyAuthError` would have swapped one wrong message for another:
it must return a string, so it conflates "here is something to show" with "I
recognised this", and its fallback says *"sign you in"* — wrong on a screen
creating an account. `socialAuth.ts:90-95` hit the same wall and worked around
it by comparing against the fallback **literal**, which breaks silently the day
that copy is reworded; it should adopt `matchAuthError`, and is left alone only
because the social flow was outside the approved scope.

Verified by re-running the original reproduction against prod: identical 429,
identical backend body, toast now reads *"Too many attempts just now. Give it a
moment and try again."*

**Everything else is unfixed and deliberately so** — see
[Proposed fixes](#proposed-fixes). The remaining items are auth, and the lane
brief queues auth for owner review.

---

## Headline

Eight findings filed (OA-001 … OA-008), one existing finding verified (NB-008),
one existing finding resolved (RW-005), and one existing finding **root-caused
into a materially different and more serious bug** (RW-004 → OA-001).

| Severity | Count | Blockers |
|---|---|---|
| HIGH | 3 | OA-001, OA-003 |
| MEDIUM | 5 | — |

The two things the owner should read first:

1. **OA-001 — signup is not atomic, and the failure is a consent gap, not just
   data loss.** `auth.signUp()` creates the account irreversibly; a separate,
   unguarded `complete-signup` call then owns every profile field, the approval
   flip *and* the entire legal record. When it does not run there is no retry,
   no reconciliation and no error anywhere. The resulting account has an 18+
   attestation and a Terms/Privacy/Platform-Rules acceptance that the user
   ticked and that **were never persisted** — `legal_acceptances` empty,
   `terms_version_accepted` empty, `accepted_terms_at` NULL — plus
   `approval_status` stuck at its `'pending'` default, which
   `ProtectedRoute.tsx:334` bounces forever.

2. **OA-003 — signup's hardest failure shows the user a raw backend string, and
   the quota behind it is an unanswered launch question.** Tapping Create
   Account when prod's auth email budget is spent renders the toast
   **"email rate limit exceeded"**, lowercase, verbatim. The copy is a one-line
   fix in my lane. The quota is not mine and matters more: it is shared across
   signup confirmations, password resets and resends, and I hit it twice today
   in ordinary use.

---

## 1. Verified working

Each with the artifact that establishes it.

| Claim | Artifact |
|---|---|
| `preserve_first_consent` does what its name claims | `pg_get_functiondef` against **live prod** (not a migration file): pins `NEW.accepted_terms_at := OLD.accepted_terms_at` when OLD is non-null, and blocks clearing it. `SET search_path TO 'public'`. Deliberately not exempt for admin/service_role. |
| A 429'd signup leaves **no orphan account** | Drove `/signup` to a `429 over_email_send_rate_limit`, then `select … from auth.users where email like 'helpr-audit-oa-%'` → **0 rows**. Unlike OA-001, nobody is stranded. This is the correct behaviour and is why OA-003 is a copy finding, not a data finding. |
| `approval_status` genuinely gates | `ProtectedRoute.tsx:334` bounces `'pending'`; prod `pg_policies` shows the only INSERT policy on `profiles` pins a client-inserted row to `approval_status = 'pending'`. |
| Auto-approve is intentional, not a bypass | `complete-signup/index.ts:461-465`, unconditional `approved` write under an explicit design comment. Prod: 34/37 approved, and all 3 `'pending'` accounted for. (Filed as OA-007, resolving RW-005.) |
| Forgot-password does not leak account existence | `ForgotPassword.tsx:57-92` falls through to a success-shaped response on every non-rate-limit error; copy is identical either way — *"If \<email\> is registered, we've sent a reset link. It expires in 1 hour."* |
| Reset-link error states are human and all have a way forward | `ResetPassword.tsx:270-283` distinguishes expired / already-used / no-token, each with a "Request a New Reset Link" button. No dead end. |
| Push token **is** deregistered server-side on logout | `authSignOut.ts:18-24` calls `unregisterPushOnSignOut()` **before** `auth.signOut()` — ordering is deliberate and commented, because `push_tokens` is RLS-scoped to `auth.uid()`. `nativePush.ts:549-554` issues a real DELETE. This closes the shared-device privacy leak. |
| Logout is centralised | Every sign-out call site routes through `signOutWithPushCleanup` (`authSignOut.ts:32`); no path calls `supabase.auth.signOut()` directly. Default scope is global. |
| `error_logs` accepts anonymous writes | `pg_policies`: `anyone_can_insert_errors`, role `public`, `WITH CHECK (user_id IS NULL OR user_id = auth.uid())`. Table healthy: 566 rows, 299 from unauthenticated contexts. |

---

## 2. Defects

Full claim, reproduction and evidence are in the bus
(`node scripts/audit-bus.mjs show OA-00N`). Summary only here.

| ID | Sev | Surface | One line |
|---|---|---|---|
| **OA-001** | HIGH · blocker | `/signup` → `complete-signup` | Root cause of RW-004: the edge function was **never invoked**. Account left unapproved with **zero legal consent recorded**, silently. Mechanism confirmed (CC-006, re-verified): `fileToBase64` never settles on an aborted read. |
| **OA-002** | HIGH | `/signup` Create Account | Button not disabled during the awaited validator → one gesture fires **two concurrent `auth.signUp` calls** (measured 29 ms apart); the loser silently `navigate("/login")`s. |
| **OA-003** | HIGH · blocker | `/signup` Create Account | Raw `"email rate limit exceeded"` shown as the user-facing toast; the correct copy already exists in `authErrors.ts` and signup can't reach it. Underlying quota unanswered. |
| **OA-004** | MEDIUM | native session storage | `keychainStorageAdapter` is **NSUserDefaults, not Keychain**. Full production session observed in plaintext on disk. |
| **OA-005** | MEDIUM | `/reset-password` | Validates **3 of the 5** password rules signup enforces; hint copy understates the policy; rejection falls through to *"Couldn't sign you in"*. |
| **OA-006** | MEDIUM | `/reset-password` success | Promises *"Anywhere else you were signed in will ask for the new password next time"* — nothing in this codebase does that. Recovery token never stripped from the URL. |
| **OA-007** | MEDIUM | `approval_status` + `/account-pending` | Resolves RW-005 (auto-approve is by design) and shows the pair with OA-001: **approval is a side effect of an edge function that can silently not run**. `/account-pending` then tells the stranded user a staffed review is coming that does not exist. |
| **OA-008** | MEDIUM | iOS app-switcher snapshot | Snapshot redaction is gated on the **opt-in, default-off** App Lock flag, so the default user's task-switcher preview captures chat, checkout and profile screens. |

**NB-008** (`lh-native-bridge`) → set **verified**, with the fix proposed in its
status note and a correction: its stated blocker ("the iOS platform component is
not installed on this machine") is false — see §3.

### Consent data hygiene (observation, not filed separately)

Prod holds 37 auth users, 25 profiles with `accepted_terms_at` set, but
`legal_acceptances` has only 19 rows across **10 distinct users**. So ~15 users
carry a consent timestamp with no corresponding audit row. Version columns are
fully populated where rows exist (`0` missing terms or privacy version). This is
the historical gap `complete-signup`'s own comment describes and predates the
current writer; I am recording it under OA-001 rather than inflating the finding
count, but it means the `legal_acceptances` audit trail is **not** complete
evidence for the existing user base.

---

### OA-001 — the mechanism (confirmed, and it raises the severity)

`lh-concurrency-cache` found the trigger (CC-006) and I re-verified it
independently. `fileToBase64` (`signupHelpers.ts:70-78`) wraps a `FileReader`
and attaches only `onload` and `onerror`. FileReader has **three** terminal
events; an aborted read fires `onabort`, which nothing listens for, so the
promise neither resolves nor rejects. `grep -rn onabort src/` returns **zero**
hits app-wide.

That await is the first statement of `completeProfile` (`Signup.tsx:241`),
which runs *after* `auth.signUp` has already created the account. Every symptom
documented from prod falls out of it: the auth user exists; `invoke` is never
reached, so the handler is never entered and **no `edge_rate_limit_log` row is
written** — the exact absent artifact used as dispositive proof; the `catch`
never runs, so no `report()` and no toast; the `finally` never runs, so the
button spins forever; and the profile holds only what `handle_new_user`
inserted, which is precisely the four fields RW-004 named, because they are the
*payload* of the call that never fired.

**This raises OA-001's severity rather than lowering it.** Not a rare race — a
deterministic hang on a path every user walks, since the avatar is a hard
requirement of the form (`Signup.tsx:131-134`), whose probability depends only
on the file and the device.

**Two unguarded instances, not one.** `supabase.functions.invoke` carries no
`AbortSignal` and no timeout at `Signup.tsx:252` **and** at
`CompleteProfile.tsx:400`. A stalled mobile connection hangs identically — and
CompleteProfile is the *recovery* path for this very failure, so the recovery
can hang the same way. Close all three or the intermittency merely moves.

**The finding behind the finding:** this codebase already learned this lesson
and did not apply it here. `keychainStorageAdapter.ts:21-26` states verbatim
that a try/catch *"catches a REJECTION; it does nothing for a Capacitor bridge
call that never settles at all"*, and adds a hard cap for exactly this shape —
while zero `onabort` handlers and two untimed invokes sit on the highest-traffic
path in the funnel.

The compliance half is unchanged and remains the part that needs the owner.

## 3. UNVERIFIED — could not reach, and why

Honest gaps. None of these is "assumed fine".

| Item | Why not verified |
|---|---|
| **Downstream half of OA-002** | Proved two concurrent `signUp` POSTs; both returned 429 (OA-003), so I never observed an unthrottled winner/loser split. The silent `navigate("/login")` branch is read from source, not driven. This is the one link between OA-002 and OA-001 that is still open. |
| **The configured auth-email quota (OA-003)** | GoTrue project config; not exposed by any Supabase MCP tool I hold. I deliberately state no number: prod history shows no clock hour above 2 confirmation-sending signups, yet one rolling hour carried 4 — so it is not a flat 2/hour. |
| **Live GoTrue password policy (OA-005)** | Attempted an empirical probe (`POST /auth/v1/signup` with weak passwords, which creates nothing on rejection); **refused by the environment's safety classifier** as credential-shaped traffic. The screen-to-screen divergence is proven from source regardless; the severity of the consequence is inherited from `Signup.tsx`'s comment. |
| **Whether other sessions actually survive a password reset (OA-006)** | Needs a real recovery link in a mailbox plus two browser contexts. The auth email budget was exhausted. Filed as "the app does not implement this", **not** as "the copy is proven false". |
| **NB-008 on-device trigger** | Five failed Face ID attempts → `canEvaluatePolicy` false. The simulator exists and the app is installed, so this **is** reachable — I ran out of budget, not capability. Should not be closed as demonstrated until someone runs it. |
| **App-switcher snapshot — visual confirmation** | Gap CLOSED as a finding (OA-008): the shield is gated on an opt-in flag that is default-off, corroborated by that key's absence on a real install. Still not done: backgrounding the running app and looking at the captured task-switcher image. Someone should confirm visually. |
| **Social login — actually operated** | Both Apple and Google paths, cancellation and email collision were read from source only (`socialAuth.ts`), never driven on web or native. Apple is present and rendered first with identical styling (`SocialAuthButtons.tsx:78-79`), which satisfies prominence — but I did not complete a real OAuth round-trip on either surface. Email-collision behaviour depends on the Supabase "automatic linking" project setting, which the client code cannot reveal. **Hand the Apple-prominence conclusion to `lh-compliance-store` as source-verified only.** |
| **AppLockGate re-lock and deep-link bypass — actually operated** | Read thoroughly (it wraps `<Routes>` in `App.tsx:645-676`, so no route escapes it, and `shouldLockOnFreshStart` fails closed on cold start). Not driven: no background/foreground cycle, no timeout expiry, no screenshots. Source reading is not sufficient for a lock. |
| **Logout completeness — realtime + second tab** | Push-token deletion and the NSUserDefaults clear are verified from source and are correct. **Not** verified: there is no centralised realtime-channel teardown on sign-out (teardown relies on per-hook unmount), and I did not drive a second tab to confirm the BroadcastChannel propagation in practice. |
| **First-run step counts** | Derived from reading the validators, not from a stopwatch run of both journeys end to end. Counts below are structural, not measured. |
| **Forced re-auth on 401** | No app-wide handler exists (`queryClient.ts:35-42` declines to retry 4xx but nothing forces re-auth). I did not drive an expired token to observe the half-logged-in window in practice. |

---

## 4. Time to Success (source-derived, not stopwatch-measured)

**To a first posted job:** ~16 required fields/checkboxes across 4 in-app
screens, **plus two out-of-app interruptions** — the email confirmation
round-trip, and Stripe Identity.

The friction finding that matters is not the field count, it is **disclosure**:
IDV is not mentioned anywhere in signup or `/signup-pending`. A poster fills 9
form fields, taps Review & Pay, and only then is sent to an external Stripe
Identity flow that carries a real dollar cost and, on automated failure, drops
them into a `manual_review` queue with no self-service retry
(`useJobSubmit.ts:276-300`, `IDVPromptDialog.tsx:75-90`). That is sunk cost
followed by an unbounded wait. The fix is disclosure, not removal.

**To a first submitted application:** the same signup cost, then **1 tap and 0
required fields** — applying deliberately does not trigger IDV
(`useApplyFlow.ts:91-107`). This half is correct and should not be touched.

Leanest safe cuts: the phone-duplicate lookup is a blocking network round-trip
on the critical path for what is only a fraud signal and could run after account
creation (it is also what opens the OA-002 race window); and DOB at step 2 is
largely redundant with the 18+ attestation at step 1, which is what actually
satisfies the server-side age gate.

---

## 5. Out-of-scope conclusions (PROTOCOL §6)

**Certificate pinning — WONTFIX, deliberately.** This is a WKWebView on
ATS-enforced HTTPS talking to Supabase and Stripe, both of which rotate
certificates on their own schedule with no notice to us. Pinning them means a
routine rotation bricks every installed copy of the app until an App Store
review clears a new build — days of total outage, as a *self-inflicted* failure,
to defend against an attacker who already needs a trusted root on the device.
Apple discourages it for exactly this reason. Recommend **not** implementing it,
and recording the decision so it stops being re-raised.

**Jailbreak / root detection (RASP) — WONTFIX.** A consumer marketplace, not a
bank. Every practical check is defeated by the tooling it detects, it produces
false positives on ordinary developer devices, and the assets it would protect
(a session token) are already better defended by server-side authorization.
The honest mitigation for a compromised device is the one already in place:
short-lived access tokens plus server-side authz on every write.

**Note on both:** OA-004 is *not* an argument for either. Moving the refresh
token to the Keychain is a small, well-understood change; pinning and RASP are
not, and should not ride along with it.

**Role-gating** — correctly not audited. There is no role system; every account
both posts and does jobs. No finding filed.

---

## 6. Coverage manifest — what I actually opened

**Driven live** (dev server on `:8083` → **prod** Supabase, Playwright):
`/signup` step 1 → step 2 → submit (single-click control **and** double-click
variant), the `DatePickerField` DOB wheel, the rendered error toast, the
resulting `auth.users` / `profiles` state.

**Live prod SQL (read-only):** `auth.users`, `auth.audit_log_entries`,
`profiles`, `legal_acceptances`, `login_history` (1130 rows, current),
`error_logs`, `edge_rate_limit_log`, `pg_policies`, `pg_proc` /
`pg_get_functiondef`, `information_schema.columns`.

**iOS simulator (booted, app installed):** `xcrun simctl listapps`, and
`plutil -p` over the app's NSUserDefaults plist — this is how OA-004 became an
observation rather than an inference.

**Source read in full:** `src/pages/Signup.tsx`, `signup/SignupStep1.tsx`,
`signup/SignupStep2.tsx`, `signup/signupHelpers.ts`,
`supabase/functions/complete-signup/index.ts` (746 lines),
`supabase/functions/_shared/rate-limit.ts`, `src/pages/ResetPassword.tsx`,
`src/pages/ForgotPassword.tsx`, `src/lib/authErrors.ts`,
`src/lib/userFacingError.ts`, `src/lib/errorLogger.ts`,
`src/lib/biometricGate.ts`, `src/lib/authSignOut.ts`, `src/lib/nativePush.ts`,
`src/lib/socialAuth.ts`, `src/components/auth/SocialAuthButtons.tsx`,
`src/components/AppLockGate.tsx`, `src/lib/appLock.ts`,
`src/hooks/useAuthReady.ts`, `src/components/ProtectedRoute.tsx`,
`src/pages/CompleteProfile.tsx`, `src/pages/SignupPending.tsx`,
`src/pages/AccountPending.tsx`, `src/components/profile/SecurityTab.tsx`,
`src/integrations/supabase/client.ts`,
`src/integrations/supabase/keychainStorageAdapter.ts`,
`node_modules/@capacitor/preferences/ios/.../Preferences.swift`,
`node_modules/@aparajita/capacitor-biometric-auth/dist/esm/definitions.d.ts`.

**Clipboard sweep:** every `navigator.clipboard` / `writeText` call site. Only
one writes a credential — `TwoFactorCard.tsx:288` copies the raw TOTP enrollment
secret to the system clipboard with no clearing. Standard practice for an
authenticator setup flow, so recorded here rather than filed; the rest are
referral links, case numbers and message text.

---

## Evidence check

`npm run check:audit-evidence -- docs/audit/launch-2026-09/lanes/lh-onboarding-auth.md`
→ 9 claims found, 1 with evidence, 8 without, UNVERIFIED section present.

That 8 is not 8 unsupported claims, and I have deliberately not reworded the
report to move the number. Of the eight lines flagged, **four are table rows
that already sit inside the UNVERIFIED section** (the checker matches per-line
and does not see the section they are in) — which is exactly where an
artifact-free claim belongs. Two are meta-statements about bus state
(`OA-001…007` filed, `NB-008` verified), independently checkable with
`node scripts/audit-bus.mjs list --agent lh-onboarding-auth`. One carries a
`file:line` citation the heuristic did not recognise, and one is a
recommendation rather than a claim. The tool says so itself: *"heuristic, not a
verdict"*.

The substantive claims — everything in §1 and §2 — carry their artifacts in the
bus records, which is where the evidence bar is actually enforced.

## Proposed fixes

Not applied. Ranked by risk; all await orchestrator release.

1. **OA-003 copy** — route `Signup.tsx`'s catch through `friendlyAuthError`
   before `userFacingError`. One line, no auth logic, no data-model change.
   Lowest risk; I recommend shipping this one first.
2. **OA-002 double-submit** — hold `loading` across the whole of `onContinue`,
   not just `createAccountAndFinish`. Small, but it changes signup control flow;
   wants `lh-silent-failure` over the diff.
3. **OA-005 reset validator** — bring to parity with signup's five rules and
   correct the hint copy. Touches auth; wants a reviewer.
4. **OA-001, OA-004, OA-006, NB-008 — recommend NOT fixing this pass.** Each
   needs an owner decision rather than a patch: whether signup becomes
   transactional or gains a reconciliation sweep; whether the refresh token
   moves to the Keychain and what the adapter is renamed to; whether the
   reset-password security promise is implemented or the copy withdrawn; and
   what the biometric fail-open policy should be when biometry is *locked out*
   versus merely absent.
