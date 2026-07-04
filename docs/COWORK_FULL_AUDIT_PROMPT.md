# Louisiana Helpr — Independent Full-App Audit (Cowork brief)

You are auditing **Louisiana Helpr** as an independent, fresh set of eyes —
**from the running product, NOT from the source code.** Do not read the repo to
form your judgments. Use the app the way a real customer and a real Helpr would,
on a phone, and grade what you actually see and do. Where you must reference
code to confirm a money/security claim, do so only to *verify* a finding you
already reached experientially — never to substitute for actually driving the
app.

## What the app is (context only)

Louisiana Helpr is a local-services **marketplace** (like TaskRabbit, for
Louisiana). One account can BOTH post jobs AND do jobs — it is never role-based;
every feature is visible to everyone. It ships as a phone app (iOS/Android) and
as the website louisianahelpr.com from one codebase, so it must feel like a
native app on a phone and a real website on desktop. Money is held in **escrow**
until a job is done, then released to the Helpr. Membership tiers are **Free /
Pro / Elite**. Support email is `admin@louisianahelpr.com`.

The core loop, from BOTH sides, is:
**Post a job → browse/apply → accept → pay (escrow) → do the work → mark
complete → release payout → review (both directions) → tip.**

## The mandate — judge against THREE lenses on every screen

The whole app must feel like ONE person with impeccable product taste and
engineering discipline built every screen, and it must be safe to charge real
people real money today. Grade everything against:

1. **Cohesion** — is this one product, or a pile of screens? Every screen should
   feel like a sibling of every other: same header style, same spacing rhythm,
   same buttons, same words for the same thing, same money formatting. Anything
   that reads as "a different person built this one" is a defect, even if nothing
   is broken.
2. **Product sense** — does every screen earn its place in the core loop? Count
   the taps/fields between intent and done; flag needless steps, buried primary
   actions, and clutter. Every screen should have exactly ONE obvious primary
   action the eye lands on first.
3. **Trust** — is it safe to charge money here? Money, escrow, auth, and safety
   are the load-bearing walls; a crack there outranks any polish item.

## Method — all three, on every surface

- **Look at it** — actually render/open every screen on a phone-sized view AND a
  desktop browser. Check spacing, alignment, overflow, that content fits the
  screen with no dead gutters, that text is readable, that nothing is clipped.
- **Operate it** — click every button, open every modal/sheet/tab, submit every
  form (valid AND invalid), toggle every switch. Never assume something works
  because it looks right — exercise it and watch what happens.
- **Both surfaces** — the phone app and the website do NOT render identically.
  Check both. Note which surface a problem affects.
- **Every state** — loading, empty, error, populated, and over-full (long names,
  long lists). A route is not one screen; every modal/tab/confirmation it opens
  is its own screen to check.

Self-provision: create your own test account through the signup flow (this also
audits signup). Don't treat login as a blocker. Never touch a real user's data.

## Scope — everything, not just the marketing pages

- All public/marketing pages (home, how-it-works, pricing/membership, parish
  pages, help center, legal).
- Signup → complete-profile → dashboard.
- The whole core loop above, driven from BOTH the poster's and the Helpr's side.
- Every bottom-nav tab (Home, Posts, Jobs, Messages, Profile) and the Post
  button.
- Every profile tab (edit profile, earnings, payment/payout, security,
  notifications, reviews, referrals, membership, saved Helprs, credentials…).
- Messaging: send and receive a real conversation both directions — does it
  arrive, does the unread badge work, can you retry a failed send, is
  off-platform contact-sharing (phone numbers, "pay me on Venmo") blocked?
- Every account state: pending approval, denied, banned, must-complete-profile.
- The business surface (/business/*: team, billing, contracts, exports, reports).
- Safety: can you report a user, block a user, file a dispute? Are those
  reachable and do they work?

## What to grade hardest (money & trust — release-blocking if wrong)

- **The money always adds up.** Subtotal + fee = total; the amount shown equals
  the amount charged; escrow clearly shows held → released → refunded. Fees and
  tier prices must read identically on every screen. A "$0.00", "NaN", or an
  amount that disagrees between two screens is a serious finding.
- **The unhappy paths.** Cancel a job after accepting, a no-show, a dispute — who
  gets charged vs refunded, and does escrow reconcile to exactly one party with
  no money stranded?
- **Auth & safety gates.** Protected screens actually block guests; a
  pending/banned account is routed to its gate screen, not the dashboard.
  Report/Block/Dispute exist and work. There's an EULA/agreement at signup and
  an 18+ age gate.
- **Nothing fails silently.** Every action gives visible feedback (a toast, a
  spinner, a haptic). Errors are human and actionable — never a raw code,
  `undefined`, or `[object Object]`, never a blank white screen or an infinite
  spinner.

## Deliverable

A findings list where each item is:
`screen · surface (phone/web) · what's wrong · how bad · the fix`

Severity: 🔴 Blocker · 🟠 High · 🟡 Medium · 🟢 Polish. Group by severity.

Start with a plain-language overview: what you covered, headline counts by
severity, and the top things to fix first. Then the full list. Call out anything
you could NOT verify and why. Don't pad — an honest, smaller audit beats a broad
hand-wavy one. And proactively suggest improvements, not just defects: anything
that could be clearer, tighter, faster, or more cohesive.
