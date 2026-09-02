# lh-onboarding-auth — lane report

**Scope:** the path to a user's first success, and the security of the session that
carries them through it. Signup and social-login friction, the account-state gate
screens, password reset end to end, token lifecycle and storage, biometric fallback,
the inactivity lock, app-switcher snapshot redaction, clipboard hygiene.

**Run:** 2026-09-02, resumed after the first pass died mid-sweep on an API error.
Worktree `~/.lh-audit/lh-onboarding-auth` at `origin/main` b170609a8. Dev server on
:8091 pointed at PROD Supabase (`fncmgoasalhdgfwzhsqa`). Prod reads via MCP
`execute_sql` only — no `apply_migration`, no live Stripe, test accounts only.

## The one thing to read if you read nothing else

**Signup is not atomic, and everything downstream of that is a consequence.**
`auth.signUp()` creates the account irreversibly. A *second*, unguarded
`functions.invoke("complete-signup")` then owns every profile field, the approval
flip, and the entire legal record — with no retry, no queue, no compensating write
and no reconciliation sweep. I reproduced the failure: interrupt that window and
the account exists in prod with no profile, no approval, no `terms_version_accepted`
and zero `legal_acceptances` rows.

The same unguarded second call also strands the *recovery*: `/complete-profile`
writes the profile and the legal row **before** invoking `complete-signup` to flip
approval, so a failed invoke there leaves a complete-but-pending account, which
`ProtectedRoute` bounces to `/account-pending` — a screen that promises a manual
review that **no longer exists** and offers nothing that can change the state.

Five findings (OA-001, OA-009, OA-011, OA-017, and the collision risk in OA-018)
are the same root cause seen from five places.

---

## 1. Verified working — with artifacts

| Claim | Artifact |
|---|---|
| Recovery links are genuinely **one-time-use** | `token-lifecycle.mjs`: first use → 303 with `access_token&type=recovery`; replay of the same link → 303 `error=access_denied&error_code=otp_expired` |
| A recovery link for a **deleted account** fails closed | Minted link for a disposable test user, deleted the user, followed the link → 303 `error=access_denied&error_code=otp_expired` to `/reset-password` |
| The **expired/replayed** link screen is correct and actionable | `probe-reset-ui.mjs`: renders "This password-reset link has expired. Reset links are single-use and time-limited — request a fresh one below." + *Request a New Reset Link*. `oa-reset-expired-or-replayed.png` |
| A **bare visit** to `/reset-password` is handled | "To set a new password, use the reset link from your email — or request one below." |
| The app's real `redirect_to` is **allow-listed and honoured** | `generate_link` with `https://www.louisianahelpr.com/reset-password` → 303 Location lands on `/reset-password`, not the site root |
| **Logout ordering is correct** — push token deleted *before* `signOut()` | `authSignOut.ts:18-33`; the RLS reasoning is documented in the file and is right |
| **Cache teardown on SIGNED_OUT** | `main.tsx:220-233` calls `queryClient.clear()` + `removePersistedClient()` (the persister has a 24h maxAge, so this matters on a shared device) |
| **The app lock cannot be deep-link bypassed** | `AppLockGate` wraps the entire router subtree, `App.tsx:645-676` — every route renders inside the gate |
| `NSFaceIDUsageDescription` **is present** | `ios/App/App/Info.plist:74-75`. Its absence would have silently disabled all 21 biometric gates app-wide — ruled out |
| **Both social providers are really enabled** | `authorize?provider=google` → 302 to accounts.google.com with a real `client_id`; `provider=apple` → 302 to appleid.apple.com. Neither is a dead button |
| **Sign in with Apple is present and first** (App Review requirement) | `SocialAuthButtons.tsx:55-79` renders Apple leading on both `/login` and `/signup` → handed to `lh-compliance-store` |
| **Social cancel** is a distinct outcome, not an error toast | `socialAuth.ts:28,66-82,146` |
| **Gate screens fail closed for guests** | `probe-gates.mjs`: `/account-pending`, `/account-denied`, `/account-banned` → `/login`; `/complete-profile` → `/login?redirect=%2Fcomplete-profile` (destination preserved) |
| `/signup-pending` **is not a dead end** | Public, numbered "what happens next", plus a *Start over* escape |
| `/complete-profile` **is a real remediation** | Re-presents the Terms checkbox as required; writes `accepted_terms_at`/`terms_accepted_at`/`terms_version_accepted` (`:319-321`), inserts `legal_acceptances` (`:365`), re-invokes `complete-signup` (`:399-401`) |
| **Prod identity data is clean today** | SQL aggregate over `auth.users` / `auth.identities` / `public.profiles` returned `dup_auth_emails 0`, `auth_users_total 40`, `profiles_total 40`, `dup_profile_user_ids 0`, `users_with_multiple_identities 0` |
| **ForgotPassword is anti-enumeration correct** *and* still observable | Neutral success either way, but `captureException` on real failure with the email deliberately excluded from the payload (`ForgotPassword.tsx:52-96`) |

## 2. Defects filed

Each row is a one-line summary. **The evidence lives on the bus record** —
`node scripts/audit-bus.mjs show OA-0NN` carries the full claim, the reproduction
steps, and the artifact list (screenshot paths, captured network timelines, SQL
results, `file:line` refs) for every one of these.

| ID | Sev | Surface | One line |
|---|---|---|---|
| OA-001 | HIGH · blocker | `/signup` → complete-signup | **Reproduced.** The invoke never ran; account stranded with no profile, approval, terms or legal row |
| OA-009 | HIGH · blocker | `/signup` → consent capture | 18+ and Terms attestation never persisted — filed separately from the data loss, per the orchestrator |
| OA-017 | HIGH | `/account-pending` | Terminal screen promising a manual review that no longer exists; `Sync Status` polls a value nothing will change |
| OA-011 | HIGH | `/signup` network failure | Toast reads `"Failed to send a request to the Edge Function"` at the exact moment the account is stranded |
| OA-012 | HIGH | `biometricGate.ts` | Fails **open** on biometry *lockout*; passcode fallback unreachable; 21 call sites incl. bulk payouts and grant-admin |
| OA-003 | HIGH · blocker | `/signup` rate limit | Raw `"email rate limit exceeded"` shown to the user; the good copy exists and is unreachable |
| OA-002 | HIGH | `/signup` double-submit | Two concurrent `auth.signUp()` from one gesture; the loser bounces a *successful* signup to `/login` |
| OA-013 | MEDIUM | app-switcher redaction | The privacy shield is gated on the **opt-in** app lock, so the default user's chat/payout screen is snapshotted |
| OA-014 | MEDIUM | `/reset-password` | Renders a ready password form on a URL fragment alone; dead-ends with "Couldn't sign you in" |
| OA-015 | MEDIUM | 2FA enrolment | TOTP **secret** written to the system clipboard, never cleared — and since QR removal this is the primary path |
| OA-018 | MEDIUM | social collision | Email↔social linking is **unexercised** in prod (0 multi-identity accounts); behaviour set by config the code neither sets nor checks |
| OA-004 | MEDIUM | session storage | `keychainStorageAdapter` is not the Keychain — it is `NSUserDefaults`; the name asserts a property the code lacks |
| OA-005 | MEDIUM | `/reset-password` | Enforces 3 of the 5 password rules signup enforces; the hint understates the server policy |
| OA-006 | MEDIUM | `/reset-password` | Promises other sessions will be signed out; nothing in the codebase does that. Recovery token left in the URL |
| OA-016 | LOW | `/reset-password` | The "already used" copy is unreachable — GoTrue always says "invalid **or has expired**" and `/expired/i` tests first |

### Two corrections to my own earlier work

Both filed to the bus as status notes rather than quietly edited:

- **OA-001 claim (3) was wrong.** I argued "`error_logs` is empty, therefore the
  catch never fired." That inference only holds against the *deployed* site.
  `errorLogger.ts:178` drops every report when `isDevEnvironment()` is true, and
  that returns true for `localhost` / a stack containing `@vite/client` — which is
  how these audit signups were driven. The drop is deliberate and correct; the
  defect was in my reasoning. The finding survives on independent evidence (the
  `edge_rate_limit_log` gap, and the direct reproduction).
- **OA-002's causal claim is retracted.** Driving the race with the winner/loser
  split observable shows the *winner still invokes* `complete-signup` — so a double
  submit does **not** produce OA-001's state. The race is real and still worth
  fixing for its own reason. Its "silent" wording was also too strong: `/login`
  does show a contextual message.

**A note for whoever fixes OA-009.** It is bounded, not open-ended, and I narrowed
it myself after filing: `/complete-profile` re-captures consent on next login and
the account is gated until it does. What remains is the window in between, a
consent timestamp that records the *re*-consent rather than the moment the user
actually agreed, and a remediation that depends on the same fragile second call.

## 3. UNVERIFIED — could not reach, and why

- **Genuine time-based OTP expiry** (as opposed to replay and deleted-account,
  both driven). GoTrue's OTP lifetime is project auth config, not readable through
  the Supabase MCP tools. The *screen* behaviour is proven, because GoTrue emits
  the same `otp_expired` payload for all three.
- **The numeric auth-email rate limit** (OA-003). Same reason — GoTrue config.
- **Whether an email↔social collision links or duplicates** (OA-018). Needs real
  Apple/Google credentials. One manual test settles it before launch.
- **Biometry lockout on a real device** (OA-012). The Simulator cannot enter a
  genuine `biometryLockout`; established from `biometricGate.ts` plus the plugin's
  own iOS source, which are the two things that determine the behaviour.
- **An actual iOS task-switcher snapshot** (OA-013). iOS platform tooling is not
  installed on this machine. The guard and the default are proven from source;
  handed to `lh-native-bridge` for the device-side capture.
- **The session token at rest on device** (OA-004). Same reason — no device plist
  or backup dump. Storage location established from `@capacitor/preferences`'
  own `Preferences.swift`.
- **Refresh-token rotation and expiry behaviour across a real expiry boundary.**
  Not driven this run; the reset-token and signup work consumed the budget.
  Nothing here contradicts it — it is simply not evidenced, so it is not claimed.
- **Realtime channel teardown on sign-out.** `main.tsx`'s `SIGNED_OUT` handler
  clears the query cache and the persister but does not call `removeAllChannels()`.
  I did not reproduce a consequence, so this is a **lead, not a finding** — passed
  to the orchestrator for `lh-concurrency-cache` / `lh-notifications`.
- **First-success step count** (post a job / submit an application). The signup
  half is covered above; the post-job and apply wizards belong to other lanes and
  I did not want to double-count them from source without driving them.

## Assess-and-conclude (per PROTOCOL §6)

- **Certificate pinning — do not implement.** WKWebView on ATS-enforced HTTPS to
  Supabase and Stripe. Pinning would break on routine certificate rotation at both
  providers, and the failure mode is a total outage with no client-side remedy —
  every user's app stops working until a store release ships. Apple discourages it
  for exactly this reason. The threat it addresses (a device with an attacker-
  installed root CA) is not this app's risk profile, and the real session risks
  here are the ones already filed: token storage (OA-004) and step-up auth
  (OA-012). **Conclusion: wontfix, deliberately.**
- **Jailbreak / root detection (RASP) — do not implement.** A consumer
  marketplace, not a bank. Detection is trivially defeated on a rooted device,
  produces false positives that lock out legitimate users, and the platform's
  real defences are server-side: RLS, escrow held server-side, and edge functions
  that re-check authorization. **Conclusion: wontfix, deliberately.**

## Harnesses left behind (`~/.lh-audit/oa-scratch/`)

- `probe-interrupt.mjs` — drives the real `/signup` form with `POST /auth/v1/signup`
  stubbed at the fetch layer, so signup can be driven **repeatedly at zero
  auth-email cost**. `MODE=single|double|dupe|unload|offline|toastcheck`.
- `probe-reset-ui.mjs` — walks `/reset-password` through every link state.
- `token-lifecycle.mjs` — first-use / replay against prod GoTrue.
- `link-tool.mjs` — mints recovery **and magiclink** sessions for a test account
  through the admin API: no email sent, no password traffic, no rate limit.
  This is what unblocked the whole authed half of the lane.
- `probe-gates.mjs`, `probe-gates-authed.mjs` — the account-state gate screens.
