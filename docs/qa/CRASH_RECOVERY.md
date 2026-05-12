# Crash recovery test plan

Force-quit the app at each scenario below and verify the user lands somewhere sensible without losing data or money. Run on a real device — the simulator masks several issues (especially Stripe redirect + push token lifecycle).

## Setup
- TestFlight build of the target version
- Two devices OR two test accounts on one device (poster + helper roles)
- Stripe test mode enabled

## Scenario 1: Force-quit mid-Stripe-checkout (PostJob)

**Trigger:** Start a job post, fill the form, tap Review & Pay → on the Stripe Checkout screen, swipe up and force-quit.

**Expected:**
- App relaunches to /dashboard (last route) or /
- The draft job is NOT created on the backend (Stripe webhook only fires on capture)
- Form draft is preserved in safeStorage — reopening /post-job shows the "Draft restored" banner
- No orphan job row in the database

**Verify:**
- [ ] Job draft banner appears
- [ ] No new row in `jobs` table for this user
- [ ] Tapping the draft pre-fills the form

## Scenario 2: Force-quit after Stripe success redirect, before return

**Trigger:** Complete payment on Stripe Checkout. The moment Stripe shows "Success" but before /payment-success loads, force-quit.

**Expected:**
- Job row IS created (Stripe webhook fired server-side)
- Reopening the app: the job appears in My Posts with status "open"
- No duplicate notification, no double-charge

**Verify:**
- [ ] Single job row exists
- [ ] No duplicate notification to the poster
- [ ] Payment ledger shows one capture, not two

## Scenario 3: Force-quit during application submit

**Trigger:** Open a job's apply dialog, type a message, tap Apply now → force-quit before the toast appears.

**Expected:**
- Application either fully created OR not at all (atomic — verified by RLS + upsert)
- Reopening: My Jobs shows the application IF the insert completed pre-crash, otherwise not
- No half-state in the UI

**Verify:**
- [ ] Single application row OR zero — never duplicate
- [ ] Job's `applicationCount` matches the actual row count

## Scenario 4: Force-quit mid-chat send

**Trigger:** Type a message, tap send, force-quit before the bubble appears in the thread.

**Expected:**
- The message either sends OR doesn't — no zombie outbox
- Returning to chat shows either the bubble (sent) or the original draft (didn't send)

**Verify:**
- [ ] No duplicate message in the thread
- [ ] Draft persistence (current behavior: drafts NOT persisted across crash — acceptable since send is instant)

## Scenario 5: Push notification deep link with cold launch

**Trigger:** Kill the app. Send a "Match for you" push from another account. Tap the push on the lock screen.

**Expected:**
- App cold-launches to /dashboard?quickApply=\<jobId\>
- The QuickApplyHandler triggers within ~2 seconds and surfaces the apply dialog
- If the user wasn't logged in, lands on /login first, then deep-links after

**Verify:**
- [ ] Deep link param `quickApply` survives the cold launch
- [ ] Apply dialog opens automatically for the right job
- [ ] No "Job not found" toast (data was preloaded)

## Scenario 6: Background → foreground after long sleep

**Trigger:** Background the app, leave it for 1 hour, then foreground.

**Expected:**
- Tokens may have refreshed silently (Supabase handles this)
- Dashboard re-fetches via React Query staleTime
- No "Logged out" surprises

**Verify:**
- [ ] User still authenticated
- [ ] Job list refreshed (stale data not displayed indefinitely)
- [ ] Pull-to-refresh works without an auth error

## Scenario 7: Network drop mid-payment-release (helper "Mark Complete")

**Trigger:** Toggle airplane mode the moment you tap "I'm done — request payout".

**Expected:**
- Error toast: "Failed to complete job" or similar
- No state change on the job (still in_progress)
- Reconnect + retry succeeds

**Verify:**
- [ ] Job status unchanged after the failed attempt
- [ ] Retry path works (no permanent "stuck" state)
- [ ] No partial payment release

## Scenario 8: Force-quit during photo proof upload

**Trigger:** Start uploading 5 before-photos. Force-quit mid-upload (when progress bar is ~50%).

**Expected:**
- Whichever photos finished uploading are stored
- The rest are silently dropped
- Reopening: photo grid shows the completed uploads

**Verify:**
- [ ] proof_before_urls contains the uploaded subset
- [ ] No corrupt/half-uploaded files in storage
- [ ] User can re-upload the failed ones

## Scenario 9: iCloud Keychain restore on a new device

**Trigger:** Sign in on Device A. Set up Device B with iCloud restore. Open the app on Device B.

**Expected:**
- Push token re-registers on Device B
- Device A push token is invalidated server-side
- Notifications go to Device B going forward

**Verify:**
- [ ] Only one device receives push for the test account
- [ ] No "device unregistered" errors in Sentry

## Scenario 10: App version skew (stale chunk after deploy)

**Trigger:** Open the app, then deploy a new version while it's still open. Tap a lazy route.

**Expected:**
- ErrorBoundary detects the chunk-load error
- Auto-reloads with cache-bust query param
- User lands on the same intended route post-reload

**Verify:**
- [ ] No "Update available — Reload" red error stays on screen
- [ ] Reload completes within 5 seconds
- [ ] Service worker caches purged on reload

---

## Severity scale

- **P0** (block release): scenarios 1, 2, 3, 5, 10 — these involve money, deep linking, or onboarding
- **P1**: scenarios 4, 6, 7, 8 — data integrity but recoverable
- **P2**: scenarios 9 — edge case, fixable post-launch

## Sign off
Tested by: ____________
Build: ____________
Date: ____________
P0 issues open: ____________
