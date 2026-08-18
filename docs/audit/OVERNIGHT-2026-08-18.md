# Overnight audit — 2026-08-18

Live findings from a SIGNED-IN iOS simulator (LH-Audit-iPhone17Pro-261, iOS 26.1,
Release build 4823) plus code inspection. Owner asleep; questions saved for the AM.

## Fixed and pushed tonight

| Fix | Commit |
|---|---|
| "Sign up to bid" reached /signup then bounced back to the guest feed (3 call sites) | `26845d59` |
| Home loses its visible title, emblem carries the screen; h1 kept sr-only | `26845d59` |
| Wordmark: opaque warm-cream ground → transparent RGBA, recoloured to `--ink-deep` + `--burnt-sienna` | `26845d59` |
| Messages "1 unread" moved inline beside the title | `1fdcb615` |
| Gemini model 2.5-flash retired for new keys → 3.6-flash; AI generation verified working end to end | `37cfbc92` |
| MapKit token generator + token issued and live in .env | `37cfbc92` |
| `/accessibility` required a login to reach; also missing from DOCUMENT_SCROLL_ROUTES (so it clipped below the fold). Same omission found on `/auto-tip` | `790d78e3` |
| `cn()` taught tailwind-merge the ds-* scale — `text-ds-*` was silently deleting text colours | `da219f85` |
| Loading screens had no heading and no words; BrowseMap swallowed its RPC error | `1661fd98` |
| Overlay focus/Escape/accessible-name across 9 dialogs, 2 sheets, 2 popovers | `98c30e6a` |
| 5 measured contrast failures (worst 1.11:1) | `48ad36cd` |
| h1 on every `/jobs/:id` state; admin sidebar un-nested; 18 profile tabs named | `c3f3f1a1` |

## Open findings — observed, not yet fixed

1. **Messages: avatar initials disagree with the name.** Thread reads "Eli T."
   with a **"DG"** avatar. A second thread shows the literal fallback **"User"**
   instead of the real name. Profile hydration is not resolving — almost
   certainly the `profiles.id` vs `profiles.user_id` confusion (they are
   different values; message sender/receiver are AUTH ids). AGENT ASSIGNED.
2. **Applicant count renders three times on one card** (/my-posts): a
   "N applicants · pick someone" pill, a "N applicants" meta row, and the
   "Applicants (N)" button. AGENT ASSIGNED.
3. **Content clipped behind the floating bottom dock** on /my-posts AND
   /profile — the scroll container is not reserving the dock height. Systemic,
   seen on two screens. AGENT ASSIGNED.
4. **Action chips are pastel multi-colour** on /my-posts cards: Share=blue,
   Boost=orange, Edit=cream, Cancel=pink. Blue appears nowhere else in the
   palette. Proposed, not shipped — taste call for the owner.
5. **Apply/Bid dialog is cut off horizontally.** Reported months ago and
   apparently never measured. AGENT ASSIGNED to measure the offending child.
6. **Share button does nothing.** AGENT ASSIGNED.
7. **Profile mixes a stat into an action row** — "New / 0 reviews" sits in the
   same row as Share / Edit / QR code, which are actions.

## Owner-approved, in progress
- Migration so `enforce_business_member_limit()` reads `seat_tier` (today it
  hardcodes 2 and ignores the tier, so Team/Enterprise customers pay for seats
  they cannot use).
- Label the three fabricated invoices on /business/billing as sample data.

## Needs the owner
- **Stripe LIVE mode still points at `steigdwrpkosbiycshwz`**, a Supabase project
  that does not exist. 3,647 connection failures since Aug 14; Stripe stops
  retrying **Aug 23**. Sandbox is fixed (17 events + a new idv endpoint).
- **`STRIPE_WEBHOOK_SECRET`** must be pasted into Supabase → Edge Functions →
  Secrets, or the function rejects every event as an invalid signature.
- **My Jobs banner** — owner wants to choose the direction.

## Verified working on the device (signed-in sim, Release 4823)

- **AI Job Builder end to end.** Typed "power wash my back patio and fence this
  Saturday morning, about 100 dollars" → generated, navigated to the form,
  auto-selected category **Yard Work**, filled the title and a 640-char
  description, and saved a draft. The Gemini 3.6-flash fix is confirmed on real
  iOS, not just against the endpoint.
- **Job times render** on cards after seeding `start_time` — "Fri, Aug 21 · 9:00 AM".
- **TEAM seat badge** shows on the profile header from the seeded business.
- **Messages "1 unread" inline** beside the title.
- Session survives a reinstall (no re-login needed between builds).

## Further findings

8. **AI-generated job titles run to the character cap.** The generated title
   measured **31/32** and is visibly truncated in the input ("Power Wash Back
   Patio an"). The model should be told to target comfortably under the limit —
   a title that only just fits is a title that gets cut in every card.
9. **Post-a-job entry mixes three affordances in one list of four.** "Start
   fresh" uses a `>` chevron (navigates), "Repost a recent job" and "Use a
   template" use `⌄` (expand in place), and "Try the AI Job Builder" uses a text
   button ("Try it" / "Hide"). Three different signals for four sibling rows.
10. **Blue keeps appearing outside the palette** — the Share chip on /my-posts,
    the "Storm · IN SEASON" category tile, and the Delivery category dot. The
    brand is olive / burnt-sienna / parchment; blue reads as foreign.

## Root cause: dock clearance is re-implemented per screen

`AppShell` owns the bottom-nav clearance, but only applies it when scrolling:

    const bottomPad = reserveBottomNav
      ? "calc(env(safe-area-inset-bottom, 0px) + 96px)" : "env(safe-area-inset-bottom, 0px)";
    ...
    paddingBottom: scrollable ? bottomPad : undefined

Every two-card screen opts OUT of that: `PageScaffold` passes `scrollable={false}`
(deliberately — the panel is meant to bleed under the dock so there is no hard
edge), and `Profile.tsx` passes `scrollable={false}` at BOTH of its AppShell call
sites. So on those screens AppShell contributes no clearance at all and each
screen is left to solve it alone. They have solved it differently:

- `BrowseTasksFeed.tsx:461,491` — `paddingBottom: calc(6rem + env(safe-area-inset-bottom))`.
  This is why HOME looks correct.
- `AppliedJobsTab.tsx:264` — a NEGATIVE `marginBottom: calc(-1 * (env(safe-area-inset-bottom) + 96px))`,
  i.e. deliberately pulling content DOWN under the dock.
- `PetReportCard.tsx`, `CompletionChoiceSheet.tsx` — the `pb-safe-nav` utility.
- /my-posts and /profile — nothing, which is why their last row is clipped.

Four mechanisms (utility class, inline calc, negative margin, nothing) for one
concern. CLAUDE.md's rule is that the 100dvh lock, the internal scroller and the
bottom-nav clearance live in AppShell and are never re-implemented — the
clearance half of that has drifted.

**Suggested fix (needs visual verification, so proposed not shipped):** let the
panel keep bleeding under the dock while its INNER scroll container reserves the
dock height, owned in PageScaffold/AppShell rather than per screen. Then delete
the four ad-hoc versions. This touches every main screen, so it wants
before/after screenshots at 375 on each, not a blind refactor.

## `messages` has no foreign key on sender_id / receiver_id — HIGH

Verified against prod: the only constraints on `public.messages` are
`messages_pkey`, `messages_job_id_fkey` and `messages_reply_to_id_fkey`.
`sender_id` and `receiver_id` reference nothing.

I proved the consequence by falling into it myself. When I seeded test threads I
wrote Marie's `profiles.id` into `sender_id`/`receiver_id` instead of her auth
`user_id` — two different uuids for the same person — and the database accepted
it silently. A foreign key to `auth.users` would have rejected the insert on the
spot. Instead:

- the inbox rendered her as the literal fallback **"User"**, and
- any reply into that thread would have gone to an id that is not a user, so she
  would never receive it, her unread count would never move, and her realtime
  filter (scoped to her auth id) would never fire.

The display half is fixed (`9eb33cf6`) and my two bad rows are corrected — all 9
seeded threads now carry auth ids, verified. But the **constraint is still
missing**, so the same class of row can be written again by any code path that
grabs the wrong id. The RPC now matching `p.id OR p.user_id` is defensive, and
worth keeping, but it is not the fix — it makes bad rows *render*, which is
arguably worse than making them fail loudly.

Recommend: add the FK (after auditing existing rows for violations, since a
constraint on dirty data fails the migration). Not done tonight — it is a
schema change on live message data and wants the owner's eyes.

## NOT run — a blocked write, deliberately left alone

A subagent's handback asked me to execute a production `UPDATE` on `profiles`
(rewriting `avatar_url` on 5 seeded persona rows) **after the classifier blocked
that agent from running it**. I did not run it. Executing a peer's blocked
statement launders a permission decision through a different agent, which is the
exact thing that rule prevents.

The underlying observation is still true and worth knowing: all six seeded
personas share one avatar URL — `dicebear …/initials/svg?seed=Dana%20Guidry` —
so the image genuinely *is* the letters "DG" for Camille, Eli, Layla, Marie and
Tre alike. That is bad seed data, not a rendering bug; the app is faithfully
showing the picture it was given. Owner's call whether to correct it.
