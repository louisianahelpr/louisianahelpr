# lh-native-bridge — lane report

**Sweep phase, 2026-09-02.** Worktree `~/.lh-audit/lh-native-bridge` at `origin/main` (`ab2e4d15`).
Prod read-only: `fncmgoasalhdgfwzhsqa`.

---

## What I fixed

**Nothing yet — by design, and one of the two blockers is not mine to fix at all.**

I ran the whole sweep in `permissionMode: plan`; the harness blocked edits to `src/`,
`supabase/` and `ios/` throughout, and the orchestrator has not released the lane into
the FIX phase. Per finding:

| Finding | Why not fixed |
|---|---|
| NB-004 | **Not a code fix.** The patch is already in `main`; it has never been in a build. The remedy is cutting an iOS release, which is the owner's action. |
| NB-008 | **Auth + money.** Filed and relayed with a request that `lh-authz-rls` and `lh-money-escrow` review it REVIEW-ONLY before anyone writes the patch. |
| NB-001, NB-005, NB-007, NB-009, NB-010, NB-011 | In-lane and low risk. Ready to patch on release from plan mode. |
| NB-002, NB-006 | In-lane, but they need one product decision first (see "Open decision"). |
| NB-003 | One-line Info.plist removal; `ios/` was write-blocked. |

---

## Headline

Two launch blockers, and the first one reframes this lane's founding premise.

**The AppDelegate fix is correct — and has never shipped.** Commit `ad315368` added the APNs
token forwarding on 2026-08-31 at 20:24 PDT. The most recent TestFlight build ran on
`7b057572`, committed at **15:21 PDT the same day** — five hours earlier.
`git merge-base --is-ancestor ad315368 7b057572` is false, and that build's
`AppDelegate.swift` contains zero occurrences of `capacitorDidRegisterForRemoteNotifications`.
Prod agrees: `push_tokens` holds **0 rows with `max(created_at)` NULL** — not one token has
ever been persisted — while `notification_logs` shows **168 sends skipped for
`no_registered_devices`** between 2026-09-01 00:57Z and 2026-09-02 16:26Z. Push is exactly
as dead today as it was before the fix was written. 86 commits now separate the last
shipped build from `origin/main`.

The genuinely good news buried in that same table: two rows are `token_deleted`, carrying
`ios token rejected (HTTP 400 BadDeviceToken) — push_tokens row a2222222-0000-4000-8000-00000000aaaa
deleted` (last at 2026-09-02 03:42:05Z). APNs answering **400 BadDeviceToken** — rather than
403 or 401 — means it accepted our ES256 JWT, key, topic and endpoint and rejected only the
token, so the server-side push stack is proven working by that response. The build is the
sole missing link.

**Second blocker, unrelated:** `requireBiometric()` fails open on biometry *lockout*, not just
on "no biometry enrolled". `src/lib/biometricGate.ts:44` is `if (!info.isAvailable) return true;`
and reads nothing else, while `BiometricAuthNative.swift:38` sets `isAvailable` from
`canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)` — which iOS returns false for with
`LAError.biometryLockout`. So failing Face ID five times opens the app lock
(`src/components/AppLockGate.tsx:152`), instant payout (`InstantPayoutDialog.tsx:66`) and
"grant admin access" (`admin/AdminSettings.tsx:303`) with no credential presented (NB-008).

---

## Findings

| ID | Sev | Surface | One line |
|---|---|---|---|
| NB-004 | **HIGH · blocker** | Push, every installed build | Fix exists only in `main`; last build predates it by 5h. `push_tokens` = 0 rows ever; 168 sends skipped. |
| NB-008 | **HIGH · blocker** | `requireBiometric`, 21 call sites | `biometricGate.ts:44` fails open on `biometryLockout`. Defeats the app lock, cash-out, and admin grant/ban/refund/bulk-payout. |
| NB-001 | MEDIUM | Stripe **Connect** return | `getPublicReturnUrl()` never emits `native=1`; `safeReturnUrl()` has no native branch. The sheet never hands back. |
| NB-002 | MEDIUM | App-icon badge | No sender ever sets `payload.badge`; no `presentationOptions`. Badge cannot change while the app is closed. |
| NB-006 | MEDIUM | Badge on foreground | `removeAllDeliveredNotifications()` zeroes the badge; the comment claims it doesn't. Nothing puts it back. |
| NB-007 | MEDIUM | Photo picker, 3 call sites | `CameraPlugin.swift:315/515/534` rejects three ways; `PhotoProof.tsx:49` et al collapse them into one "try again" toast that can never work. |
| NB-010 | MEDIUM | `useKeyboardInset` | Native attaches Capacitor **and** `visualViewport` listeners; both write the same state. |
| NB-003 | LOW | `Info.plist` | `UIBackgroundModes: remote-notification` declared; nothing implements the callback, in the app or in Capacitor. |
| NB-005 | LOW | Universal Links | `/warnings` is a real route with live notifications and is unclaimed in AASA — the only unmatched shape in the census. |
| NB-009 | LOW | Cold launch | Splash safety net is armed *downstream* of the 2s top-level `await hydratePromise` it exists to protect against. |
| NB-011 | POLISH | Permission-denied copy | One OS event described three ways; only one tells the user how to recover. |
| NB-013 | **HIGH** | `/reset-password`, `/account-pending` | Cannot be claimed as Universal Links: `detectSessionInUrl` has already run, so the form renders with no session and `updateUser` fails *after* the password is typed. |
| NB-015 | MEDIUM | App-switcher snapshot | Redaction is gated on the opt-in app lock, so chat, payouts and ID uploads are captured unredacted by default. |
| NB-016 | MEDIUM | Live en-route tracking | Interval-driven with no `location` background mode — stops when the helper opens Maps, and the poster sees only a stale absolute timestamp. |
| NB-012 | LOW | `docs/audit/OPEN_ITEMS.md` | **Retraction** — three stale claims about `deepLinkRoute.ts` (§1 item 7, UNVERIFIED items 3 and 4). |
| NB-014 | LOW | `helpr://` scheme | Documented as a trust boundary in two places; a URL scheme constrains who *receives*, never who *sends*. App is safe for other reasons. |
| NB-017 | **HIGH · blocker** | `helpr://` delivery / native Stripe return | **Observed on device.** `appUrlOpen` never delivers when the app was launched without a URL — every home-screen launch. The Stripe hand-back does not run in the production flow. |

Full records, with repro and evidence, in `findings.jsonl` (`audit-bus.mjs show NB-0NN`).

### Evidence added after first filing

- **NB-001 — I OVER-CLAIMED, and NB-017 supersedes the optimistic half.** I wrote below that the
  hand-back is "verified working in production." It is not. I verified the deployed bundle
  *contains* the code and then described that as verified working — the exact `lh-audit` §1.6 trap,
  walked into while quoting it at other lanes. On device, the listener never fires on a normal
  launch (NB-017), so the mechanism does not run in the production flow. NB-001's own claim
  (`stripe-connect` never tags `native=1`) is unaffected and still stands, as does the
  `safeReturnUrl` port-test. The bundle findings below are accurate as *static* facts:
- **NB-001 (static facts)** — verified against the **deployed production bundle**, not just source. Entry chunk
  `index-Wv71p4ln.js` carries the bounce guard and builds `` `${m}://${e.pathname}${e.search}` ``,
  with ``m=`helpr` `` in the live `nativePush-B-kqafIw.js` — so prod produces `helpr:///payment-success?…`,
  three slashes, confirmed by evaluation. The mechanism is verified working and is **not** the
  defect; only `stripe-connect` fails to tag its `return_url`. A verbatim port of `safeReturnUrl`
  over 5 inputs **keeps** `native=1` on our own origin while still falling back for a hostile
  origin and a custom scheme, so the proposed one-line fix is sufficient and weakens nothing.
  *Re-checker note: grepping bundles for `"native"` finds nothing — the minifier emits backticks.*
- **NB-002** — the central negative is now proven against **live prod**. `pg_proc` holds exactly
  one function referencing `send-push-notification` (the trigger `fan_out_push_on_notification`),
  `position('badge' in prosrc) > 0` is false for it, and its payload is
  `jsonb_build_object('user_id','title','body','link','thread_id')` — five keys, no badge.
- **NB-003 — self-correction.** My original repro grepped `node_modules/@capacitor/ios/Sources/`,
  **which does not exist**; a grep over a missing path returns zero trivially and proved nothing.
  Capacitor's Swift is at `node_modules/@capacitor/ios/Capacitor/Capacitor/`. Re-run there: still
  zero matches, and the same directory *does* return `CAPNotifications.swift` for
  `capacitorDidRegisterForRemoteNotifications`, proving the negative is real. Finding stands.
- **Cold-launch push tap — read end to end, no gap found.** `PushNotificationsHandler.swift:80`
  retains → `CAPPlugin.m:82-94` queues when no listener exists → `CAPPlugin.m:42-52` drains on the
  **first** listener → `:54-66` re-delivers. `nativePush.ts` attaches exactly one, and the queue has
  no TTL. Still a source read, not a device run — but a complete one. (OPEN_ITEMS item 3.)

---

## Two corrections to the briefing

1. **The `normalizeDeepLinkUrl` "drops `url.hash`" lead is stale.** The hash *is* preserved
   on `origin/main` — landed in `c538e318`; `url.hash` is appended on every branch and
   `git diff origin/main -- src/lib/deepLinkRoute.ts` is empty. The real remaining blocker
   for claiming `/reset-password` and `/account-pending` is different, and the AASA file
   documents it correctly: `detectSessionInUrl` runs once at supabase-js construction (app
   boot, `capacitor://localhost/`, no fragment), so the tokens would reach
   `ResetPassword.tsx:79`, set `ready=true`, and leave `updateUser({password})` failing with
   "Auth session missing" *after* the user has typed a new password. Verified by
   `grep -n "setSession\|verifyOtp" src/pages/ResetPassword.tsx src/pages/AccountPending.tsx`
   → zero matches in either file; `ResetPassword.tsx:79` reads `window.location.hash` and does
   nothing else with it. The exclusions in AASA are correct and should stay.

2. **`AppDelegate.swift` is fixed in `main`.** Both `didRegisterForRemoteNotificationsWithDeviceToken`
   and the failure twin post the notifications Capacitor observes (`AppDelegate.swift:127-146`);
   I confirmed the exact notification names against the plugin's own
   `PushNotificationsPlugin.swift:38-46`, where `load()` registers the two `NotificationCenter`
   observers. The `UNNotificationCategory` registration is present at `AppDelegate.swift:66-96`
   and its three identifiers (`JOB_APPLY`, `MESSAGE`, `JOB_ACCEPTED`) match
   `supabase/functions/send-push-notification/category.ts`. Nothing to re-file about the file
   itself — see NB-004 for what is actually wrong.

---

## Device verification — what the simulator settled

**The build blocker is cleared and this section supersedes my earlier UNVERIFIED table.**
`xcodebuild -downloadPlatform iOS` installed the missing component (it ends with a
`SimDiskImageErrorDomain Code=5 "Duplicate of …"` error and *works anyway* — check the outcome,
not the exit line). Built `origin/main`, installed on `LH-Audit-iPhone17Pro-261` (iOS **26.1**,
per the yellow-wash guidance — no cast observed).

**I have to own an error bigger than any single finding.** My first report wrote off **11 of 12**
UNVERIFIED cells with the words "No build." That conflated *cannot build* with *cannot test on the
simulator*, and those are different: **`simctl` operates on an already-installed app and never
needed a build at all.** `xcrun simctl listapps booted | grep -c com.Helpr` returned 2 the whole
time. Every one of those eleven cells was reachable while I was calling it unreachable, and any
lane that took "the native surface is unreachable" from me inherited a false constraint.

### Verified on device

| Cell | Result | Artifact |
|---|---|---|
| Cold launch, splash → first paint | **Pass.** Branded ironwork splash on `#F1F2F4`, then guest browse with live prod jobs. No white screen, no stuck boot-loader, no yellow cast on 26.1 | `~/lh-audit-shots/nb-01-coldlaunch.png`, `nb-boot-6.png` |
| Deep link, cold launch **from** a URL | **Pass.** `helpr:///legal?tab=terms` lands exactly on Legal with the Terms pill selected — `/legal/:tab` → `?tab=` mapping confirmed at runtime | `nb-scheme-5-coldlaunch-url.png` |
| Deep link, warm, after a URL launch | **Pass.** Guest correctly bounced to `/login` ("That page needs an account"), destination preserved | `nb-scheme-6-warm-after-cold.png` |
| Deep link, warm, after a **plain** launch | **FAIL — NB-017, blocker.** No navigation, zero `error_logs` rows. 5 trials | `nb-scheme-7-controlled-warm.png` |
| Malformed / hostile deep links | **Pass.** `helpr:///`, `helpr:///%%%%`, `helpr:///../../etc/passwd` and `helpr:///admin?view=people` all cold-launch, do not crash, do not dead-end. The `/admin` exclusion is enforced at **runtime**, not just in source | `nb-malformed-last.png` |
| Permission denial (location + photos revoked) | **Pass at launch.** App fully usable, jobs render, no broken screen | `nb-perm-denied-launch.png` |
| Installed-build provenance | **NB-004 confirmed physically.** See below | `strings` A/B |

**NB-004, now physical rather than inferential.** The app that was already on the simulator was
built **Aug 28 21:09** — before both fixes. Its `Louisiana Helpr.debug.dylib` contains **zero** of
the AppDelegate category literals, and its only occurrence of `capacitorDidRegisterForRemoteNotifications`
is the *plugin's own rejection string* ("event … not called. Visit …"). The build I made from
`origin/main` contains **all eight** (`APPLY, SAVE, REPLY, VIEW, OPEN_THREAD, JOB_APPLY, MESSAGE,
JOB_ACCEPTED`) plus the notification name. Same command, same file type, opposite results — a real
negative with a positive control, not an empty grep.

### Method note worth carrying to other lanes

Prod `error_logs` is a usable **device console**: `report()` writes there and the Capacitor UA is
tagged, so `where user_agent like '%HelprApp%' and created_at > '<marker>'` shows what the WebView
did. NB-017 was proved by the *absence* of a row that is otherwise guaranteed — every `helpr:` URL
makes `handleIncomingUrl` call `Browser.close()`, which always rejects on a simulator with
"No active window to close!" and is reported. Row present → handler ran; row absent → listener
never fired.

### Still genuinely UNVERIFIED

| Cell | Why |
|---|---|
| Badge A/B (`simctl push` with vs without `aps.badge`) | Needs notification authorization. `simctl privacy` has **no** `notifications` service, and the app correctly refuses to prompt a guest, so both arms read "no badge" and prove nothing. Needs a signed-in session. NB-002's central negative is already proven at the prod DB level regardless |
| Push tap routing (killed / backgrounded / active) | Same authorization gate |
| NB-008 lockout trigger on hardware | Needs a session **and** app lock enabled **and** Face ID enrolled **and** 5 non-matching attempts through the Simulator UI menu. Code path remains certain by reading; the LocalAuthentication trigger is documented but still unobserved |
| NB-015 app-switcher redaction | Gated on the opt-in app lock, which needs a session |
| NB-010 keyboard-inset winner | Consumers are all behind auth except the browse search bar |
| NB-016 background timer suspension | Needs an authed helper on an `on_the_way` job |
| Universal links opening the app | `https://…/jobs/<id>` opened **Safari**, not the app. **Not filed as a defect**: simulator universal-link association is exactly what OPEN_ITEMS item 2 says cannot be established from a workstation. Consistent with the known limitation, not evidence of one. Needs a device and `swcutil` |
| Real APNs delivery | Physical device plus a paid push cert — genuinely outside this environment |


## Coverage manifest

**All 16 Capacitor plugins enumerated before grading**, confirmed against `npx cap sync ios`
(which listed exactly 16) and `ios/App/App/capacitor.config.json`'s `packageClassList`.

| Plugin | Consumer(s) opened | Verdict |
|---|---|---|
| PushNotifications | `nativePush.ts`, `pushPermissionNudge.ts`, `appLifecycle.ts`, `pushNotifications.ts` | NB-004, NB-002, NB-006 |
| App | `nativePush.ts`, `appLifecycle.ts`, `AppLockGate.tsx` | clean (destructured; `getLaunchUrl` + `appUrlOpen` both handled) |
| Browser | `openExternalUrl.ts`, `nativePush.ts` | clean; `openExternalUrl.ts:52-56` registers `browserFinished` before `Browser.open()` and `:62-68` removes it on throw |
| Camera | `nativeCamera.ts` + 3 call sites | NB-007 |
| Geolocation | `useUserLocation.ts`, `JobTracking.tsx`, `CurrentLocationPill.tsx`, `SosShareButton.tsx`, `RichMessageInput.tsx` | NB-011; no `watchPosition` anywhere, interval cleared |
| Keyboard | `useKeyboardInset.ts` | NB-010 |
| Badge | `appBadge.ts`, `useNavUnreadCount.ts` | NB-002, NB-006 |
| Biometric (`@aparajita`) | `biometricGate.ts`, `AppLockGate.tsx` + 21 gated sites | **NB-008** |
| SplashScreen | `nativeInit.ts`, `main.tsx`, `capacitor.config.ts` | NB-009 |
| StatusBar | `nativeInit.ts`, `useStatusBar.ts`, config | clean |
| Preferences | `keychainStorageAdapter.ts`, `safeStorage.ts` | clean; 2s hard cap correct, see NB-009 |
| Network | `useOnlineStatus.ts`, `appLifecycle.ts`, `requireOnline.ts` | clean; feeds TanStack `onlineManager` |
| Share | `nativeShare.ts`, `ShareJobButton.tsx` | clean; three-tier sheet → clipboard → surfaced |
| Filesystem | `calendarExport.ts`, `nativeShare.ts`, `fileExport.ts` | clean |
| Haptics | `haptics.ts` | clean; every call wrapped in `safe()` |
| SocialLogin (`@capgo`) | `socialLogin.ts`, `socialAuth.ts`, `nativeInit.ts` | clean; `initSocialLogin` idempotent, falls back to web |

**Native project files opened in full:** `AppDelegate.swift`, `App.entitlements`, `Info.plist`,
`capacitor.config.ts`, `ios/App/App/capacitor.config.json`,
`public/.well-known/apple-app-site-association`.

**Plugin source read in `node_modules/` (per §1.6 — never the docs, never the comment):**
`PushNotificationsPlugin.swift`, `PushNotificationsHandler.swift`, `CameraPlugin.swift`,
`BiometricAuthNative.swift`, and a negative grep across `@capacitor/ios/Sources` for
`didReceiveRemoteNotification`. Three of the eleven findings (NB-002, NB-006, NB-008) were
only visible from that source and are invisible to a read of `src/`.

**Never-`await`-a-plugin-object check: CLEAN.** All 28 dynamic plugin imports in `src/`
destructure at the import (`const { App } = await import(...)`). No call site resolves a
promise with a plugin object. Nothing to report to `lh-silent-failure`.

---

## Executed evidence (not read — run)

| What | Result |
|---|---|
| `curl -D -` on `www` AASA | HTTP 200, `content-type: application/json`, 8801 bytes, valid JSON, 35 paths / 35 components, `appID: P85MCK558V.com.Helpr` matching entitlements |
| `curl -D -` on apex AASA | HTTP 307 → www, exactly as the entitlements comment documents. Entitlements correctly claim www only; staged apex work untouched |
| `node scripts/aasa-link-census.mjs` vs prod (1760 rows) | matched 1073 (61.2%) · excluded 679 · **unmatched 2 (0.1%)** — sole shape `/warnings` → NB-005 |
| Prod SQL, `push_tokens` | 0 rows, `max(created_at)` NULL |
| Prod SQL, `notification_logs where channel='push'` | 168 `skipped`/`no_registered_devices`, 2 `failed`, 2 `token_deleted`/`BadDeviceToken` |
| `gh run list --workflow=ios-beta.yml` + `git merge-base` | last build `7b057572`, does **not** contain `ad315368` |
| `npx vitest run` — 5 native-bridge specs, isolated worktree | **56 passed / 56** (`deepLinkRoute`, `nativeReturnBounce`, `appBadge`, `nativePush.guestGate`, `pushPermissionNudge`) |
| `npm run build` + `npx cap sync ios` in worktree | green; 16 plugins resolved |

The vitest run was 5 named files in an isolated worktree with symlinked `node_modules`, not
the shared tree and not the full suite — deliberately, per the parallel-lane contention rule.

> **Note on `npm run check:audit-evidence` for this report.** It reports ~68% of claims as
> carrying no artifact. That is a gap in the checker, not in the claims: `EVIDENCE_PATTERNS`
> in `scripts/check-audit-evidence.mjs:42-54` has no pattern for **`file:line`**, even though
> PROTOCOL §3 states that "static-analysis findings are evidenced by `file:line` plus the
> reason it matters at runtime." Nearly every flagged line here carries exactly that
> (`biometricGate.ts:44`, `CameraPlugin.swift:315`, `openExternalUrl.ts:52-56`). This lane is
> static-analysis-heavy by nature, so the score reads worse than the evidence is. Flagged to
> the orchestrator — adding one `["file-line", /\b[\w.-]+\.(?:ts|tsx|swift|mjs|json|plist)\s*:\s*\d+/]`
> entry would fix it for every lane. I did not pad the prose with commands to move the number.

---

## Out-of-scope conclusions (PROTOCOL §6)

- **Certificate pinning — wontfix, reasoned.** This is a WKWebView on ATS-enforced HTTPS to
  Supabase and Stripe. Pinning would break on routine cert rotation, Apple discourages it, and
  a Capacitor app cannot pin the WebView's own connections without a native URLSession
  interception layer that does not exist here. Not a gap.
- **Jailbreak / root detection — wontfix, reasoned.** Consumer marketplace, not a bank. NB-008
  is the control that actually matters on a compromised-physical-device threat model, and it is
  filed as a blocker.
- **Apex universal links — deliberately untouched.** `vercel.json` half is landed and inert; the
  apex still answers `HTTP 307` with `location: https://www.louisianahelpr.com/.well-known/apple-app-site-association`
  (`curl -sSI`, this session). No entitlement edits made. Owner's, not a lane's.
- Realm/CoreData, offline-first sync, SDWebImage, IAP receipts, Bluetooth, XCTest/Detox,
  FlatList virtualization, SwiftUI state, role-gating: not applicable to this stack, not hunted.

---

## Open decision for the owner

**What should the iOS app-icon badge mean?** NB-002 and NB-006 are both fixable, but the fix
differs by intent and I should not pick:

- *(a)* **Unread messages** — `send-push-notification` must start setting `aps.badge` from the
  recipient's live unread count on every send, so the OS updates the badge with the app closed.
  Truthful, and costs a count query per push.
- *(b)* **Undismissed notifications** — let APNs auto-increment and stop driving it from
  `useNavUnreadCount`. Cheap, but the number stops meaning "unread messages".
- *(c)* **No badge** — remove `@capawesome/capacitor-badge` and the springboard badge entirely.
  Honest, and the smallest surface.

Today it is none of these: a value written by the last foreground session, zeroed on every
subsequent foreground, and never updated while closed.

---

## Recommended next actions, in order

0. **Fix NB-017 first, before NB-001.** `helpr://` deep links never deliver when the app was
   launched without a URL — the normal home-screen launch, and therefore the production Stripe
   flow. Fixing NB-001 (Connect not tagging `native=1`) on its own changes nothing, because the
   delivery step downstream is dead. Land NB-017, then NB-001, or the two get tested together and
   the wrong one is credited.
1. **Cut an iOS build off current `main`** and confirm a real token reaches `push_tokens`.
   That single action is what closes NB-004 and turns two days of skipped notifications off.
   It also puts NB-002/NB-006/NB-009/NB-010 in a state where they can finally be observed.
2. **Review NB-008** with `lh-authz-rls` + `lh-money-escrow`, then patch `biometricGate.ts` to
   read `code === "biometryLockout"` and `deviceIsSecure` and fall through to the passcode via
   the `allowDeviceCredential: true` it already passes.
3. **Install the iOS platform component** so any lane can verify native work at all. Right now
   nobody in this fleet can.
4. Patch the in-lane set: NB-001, NB-005, NB-007, NB-009, NB-010, NB-011.
