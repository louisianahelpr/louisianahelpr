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
