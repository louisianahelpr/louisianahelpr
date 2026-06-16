# Louisiana Helpr — Cowork Re-Audit Prompt

You're auditing **Louisiana Helpr** — a Capacitor app shipping React/TypeScript inside an iOS shell. Same code runs as a web app at louisianahelpr.com.

**Mission:** find anything that's visually inconsistent, broken, half-finished, or feels less polished than a flagship consumer app. Every screen. Every sub-screen. Every popup. Don't ignore "small" stuff — that's exactly what we're hunting.

You're testing on **three surfaces**. Each surface has its own quirks; please rotate through them.

---

## 0. Setup

### iOS Simulator (primary)
- Open Xcode → Window → Devices and Simulators → boot an iPhone 17 Pro on iOS 26.x
- The latest TestFlight build of "Louisiana Helpr" should be on it; if not, ask the maintainer for an `.ipa` or for fastlane access
- Sign in as `lexilombas05@gmail.com` (audit account)

### Chrome desktop
- https://louisianahelpr.com — sign in with the same audit account
- Open DevTools → Console open the whole session; flag anything red

### Safari mobile (real device or Responsive Design Mode)
- https://louisianahelpr.com → "Add to Home Screen" if testing as installed PWA
- This is where iOS Safari quirks show (status-bar overlap, keyboard push, scroll-bounce)

### Test data
The repo has a re-runnable seed: `scripts/seed-cowork-test-jobs.sql`. When run, the audit account will have:
- **5 jobs they posted** in varied states (open · open-with-pending-apps · accepted · in-progress · completed)
- **5 jobs they applied to** in varied application states (pending ×2 · accepted · rejected · pending-bid)
- **5 extra browse-feed variety jobs** from another helper

So Posts, My Jobs, and Browse should all have populated states to inspect.

---

## 1. The audit lenses

Rotate through these three lenses on every screen — don't audit one screen against all three; audit one lens across all screens first, then the next lens.

### A) Visual consistency
- Does this screen's **header, footer, padding rhythm, card shape, button style, typography** match the rest of the app?
- Does the **back button** look identical to every other page's back button?
- Are **empty states** styled like the canonical "Nothing today, neighbor." pattern, or is this one bare text?
- Are **loading states** content-shaped skeletons or just a spinner?
- Do colors come from brand tokens (sage / olive / parchment / bark / burnt-sienna) — or do you see a "random" gray or blue or pure white that doesn't belong?

### B) Polish & feel
- Tap a button. Does it have **press feedback** (scale/haptic)? Or does it feel inert?
- Animations: are entries smooth or do they pop?
- **Haptic feedback** on iOS: does a successful action feel like success (a soft thud)? A destructive action feel weighty? An info action feel light?
- Long-press: does anything reveal a useful menu? Any double-binding (long-press AND tap both fire)?
- Pull-to-refresh: feels right? Or fights the scroll?
- Keyboard: does it push content correctly, or does it cover the input field on small phones?

### C) Functionality
- Does the **happy path** work? Post a job, apply to a job, send a message, hire, complete, review.
- Does the **error path** show something useful? (Lose wifi mid-action; deny a permission; submit an invalid field.) Or does it silently fail / spin forever?
- Does the **empty path** show something useful? (A fresh account with no posts/jobs.)
- Does data reload when you come back to the app from background? (iOS only — was a latent bug.)

---

## 2. Per-platform checklist

### iOS sim / device
- Status bar glyphs visible on every screen (no white-on-white or dark-on-dark)
- Safe-area insets respected (no content under the home indicator; no content under the dynamic island)
- Bottom-nav (or floating "+") doesn't clip content
- Keyboard pushes the focused field above the keyboard (every form, every textarea)
- Pull-to-refresh works on Dashboard, Messages, Activity
- Long-press menus appear on job cards / messages
- Swipe-back from any screen returns correctly
- Push notification banners clear from Notification Center when you open the app
- Deep links: tap a shared job URL → lands on that job, not the dashboard
- Background → foreground: dashboard / messages / balances are fresh (not stale)
- Image upload: photo library multi-pick completes in reasonable time
- Video upload: 60-sec 4K video gets a clear "trim under 30 MB" toast (not a silent fail)
- Splash → app handoff: no color flash at boot

### Chrome desktop
- Console: zero red errors during normal navigation
- Network tab: no 4xx/5xx during normal use (except expected 401 on signed-out endpoints)
- Responsive: shrink window to 375 × 812 and confirm mobile layout looks right
- Tab focus: every interactive element is reachable via Tab; Enter activates; focus rings visible

### Safari mobile / PWA
- Add-to-home-screen → opens in standalone mode
- No mobile-Safari quirks: no double-tap-to-zoom (we disabled zoom), no input bounce
- Sticky elements behave (no jumpy position)

---

## 3. Per-feature checklist

Walk every screen. For each, run the three lenses above plus the feature-specific checks.

### Sign-in / sign-up
- [ ] Sign in with email/password
- [ ] Sign in with Apple (iOS only) — full account creation if new email
- [ ] Sign in with Google
- [ ] Reset password flow — link in email, lands on reset page, confirms
- [ ] Sign out → returns to landing/login
- [ ] Account-pending state (post-signup, pre-approval)

### Dashboard / Browse Tasks
- [ ] Empty state (use a fresh account, or filter to a category with nothing)
- [ ] Populated state — scroll the feed, pull to refresh
- [ ] Category filter sheet: pick a category → chip row appears under the toolbar
- [ ] Search: type a query, get results, clear it
- [ ] Saved Search: create one, see it persist
- [ ] Map view toggle: works without crashing
- [ ] Long-press a job card: quick-action sheet appears
- [ ] Double-tap a job card: saves it with a heart-pop animation
- [ ] Apply to a job (default mode + bid mode)
- [ ] "N applied" / "Verified" badges visible on appropriate cards

### Post a job
- [ ] Start from FAB "+" — wizard flows through all steps
- [ ] Photo upload (camera + library)
- [ ] Location picker (parish + ZIP)
- [ ] Pricing modes (fixed / bid / urgent)
- [ ] Group job (helpers_needed > 1)
- [ ] Recurring job
- [ ] Direct-offer to a specific helper
- [ ] Payment step (Stripe Connect)
- [ ] Success moment animation

### My Posts (Activity → Posts)
- [ ] Open post with no applicants — shows empty applicant state
- [ ] Open post with pending applicants — see N applied, tap to view
- [ ] Accepted post — helper-on-the-way view
- [ ] In-progress post — proof photos / completion confirm
- [ ] Completed post — review the helper

### My Jobs (Activity → Jobs)
- [ ] Application pending — see status
- [ ] Application accepted — see "you got it"
- [ ] Application rejected — see "not this time" with no shame
- [ ] In-progress (you accepted) — tracking + check-in flow
- [ ] Completed — review the poster, payout status

### Messages
- [ ] Empty inbox
- [ ] Open a thread — typing indicator, read receipts, message status
- [ ] Send a message, attach a photo
- [ ] Search threads from the list
- [ ] Long-press a message — actions
- [ ] Cancelled-job chip in conversation row → tap shows reason
- [ ] Block / report user from chat header

### Profile
- [ ] Edit profile — name, avatar, bio
- [ ] Skills manager
- [ ] Hourly rate
- [ ] ID verification flow
- [ ] Intro video upload — large file rejected with toast, small file succeeds
- [ ] Earnings tab — sparkline + history
- [ ] Stats tab — completed jobs, ratings
- [ ] Reviews tab
- [ ] Saved helpers
- [ ] Credentials
- [ ] Settings — dark mode, notifications, safety
- [ ] Sign out → returns home

### Notifications
- [ ] Bell icon in header — shows panel
- [ ] Notification panel — read / unread, mark all, settings
- [ ] In-app banners for live events (message, application, hired)
- [ ] iOS push notification permission flow

### Admin (if you have admin access)
- [ ] Each admin tab loads — broadcasts, credential queue, partner applications, payouts, referrals, audit log, notification logs, parish activity
- [ ] Empty states show illustrations, not bare text
- [ ] Loading states show skeletons, not bare "Loading…"
- [ ] Error states show retry, not a confusing empty list

### Modals & sheets
- [ ] OnboardingTour — runs on first visit, can skip, can resume
- [ ] BirthdayPopup — appears on user's birthday (or mock via DB)
- [ ] Apply confirm dialog — Stripe flow
- [ ] Report dialog — submit, see confirmation
- [ ] Dispute dialog
- [ ] Counter-offer dialog (bid mode)
- [ ] Cancellation dialog — fee disclosure
- [ ] Each modal closes on Esc, on backdrop tap, and on its own X
- [ ] Focus trap inside the modal (Tab cycles within)

### Legal / settings / static pages
- [ ] Terms, Privacy, Data Rights — readable, links work
- [ ] About / Help / Support — content correct

---

## 4. How to file findings

For each issue, capture:
1. **Where**: Platform (iOS sim / Chrome desktop / Safari mobile), screen name, exact step to reproduce
2. **What you saw**: Screenshot or short video clip
3. **What you expected**: One sentence
4. **Severity**:
   - **High** — broken, looks wrong, blocks a flow
   - **Med** — inconsistent, feels unfinished, minor functional issue
   - **Low** — nit, polish

File in the team's tracker (Linear / GitHub Issues / Notion — whichever you use). Tag with `cowork-audit-{date}` so they cluster.

If you see **a pattern** across many screens (e.g. "every business tab has a different empty state"), file ONE issue with a list, not 8 issues — easier to prioritize.

---

## 5. Stretch — exploratory testing

Beyond the checklist:
- Try the app on a slow network (Charles Proxy throttle to 3G).
- Try the app on low battery (Low Power Mode on iOS).
- Try the app with VoiceOver / TalkBack — does every interactive element have a label?
- Try with Dynamic Type at the largest setting on iOS — does layout still work?
- Try with dark mode — every screen renders correctly?
- Try with a senior_mode account — does the senior-mode class apply correctly?

---

## 6. After the audit

Send the issue list + your top-5 high-impact picks to the maintainer. We'll triage and ship fixes. A re-audit happens after the next polish wave.

Thanks for the second pair of eyes — this is how we go from "ships" to "loved."
