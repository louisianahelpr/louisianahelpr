# Business outreach (Shops add-on) — decision record

Owner ask (2026-10-15): add an outreach service for businesses on Louisiana Helpr to the hub build
queue. Helpr builds a business's local referral list (realtors, property managers, landlords,
builders, insurance adjusters), sends first messages and follow-ups in the business owner's own
voice, tracks every reply, and shows the business a scoreboard with every number.

Where the idea came from: the owner saw a Facebook post (2026-10-15, "Louisiana Contractors" group)
by a Lafayette roofing company's sales/ops person who runs this as a paid service for other trades.
This file takes the idea only. Nothing here copies that post's wording, name, offer or brand. His
day-one results (104 messages, 11 replies, 1 job) are his own self-reported claims, unverified, and
are not used anywhere below as an expected result.

Process: the owner's rule for every hub section (roadmap, 2026-10-14): every question is decided
BEFORE building. Nothing in "Still to decide" is decided here. Tracked on docs/OPEN.md as the
"Business outreach" item; build queue row in docs/specs/build-queue.md (wip/declutter-terms).

Written 2026-10-15 by a spec agent: docs only, no code, no migrations, no prod reads. Code read at
origin/main b9f7cc6fa and origin/wip/shops-1 6379781d6.

## Decided
| # | Question | Decision | When |
|---|----------|----------|------|
| 1 | Is it a product feature? | Yes: an outreach service for businesses that have a Shops business profile, queued after Shops slice 1 | 2026-10-15 |
| 2 | Also used for our own growth? | Yes, separately and by hand first: docs/marketing/outreach-campaign-2026-10.md | 2026-10-15 |

Everything else is in "Still to decide" (OD1..OD12) and "Compliance blockers" (C1..C6).

## Words used in this file (plain meanings)
- **Referral source**: a local business person who sends work to trades (realtor, property manager,
  landlord, builder, adjuster). Their BUSINESS contact details only.
- **Sender**: the business that bought outreach. Messages go out in its name and voice.
- **Territory**: one trade in one parish. Exclusivity (if chosen) means one sender per territory.
- **Scoreboard**: the sender's counts: contacts found, messages sent, replies, interested, jobs.

---

## 1. How it fits what already exists (measured in the code 2026-10-15)

| Piece | Where | Use for outreach |
|---|---|---|
| Shop = the business profile, one per member, free, never role-based | origin/wip/shops-1 `supabase/migrations/20261015123029_shops_profiles.sql:1-13` (table `shops`, :158) | Only a member with a shop can buy outreach; the shop's name, category and parishes seed the setup |
| Shop categories (fixed list, a table so it can grow) | same migration `shop_categories`, :58-154 | The sender's trade. Covers every trade in the source post: painting, hvac, electrical, concrete_masonry, fencing, plumbing, flooring, lawn_landscaping, pest_control, roofing (generators: no category; would need I1 "Suggest a category" or an owner add) |
| Parishes served (exact `profiles.parish` / `jobs.parish` strings) | same migration `parishes_served`, :164-166; `src/lib/parishes.ts` | The sender's area; the territory key for exclusivity |
| No phone, email or website on a shop page (owner L49); contact-leak trigger | same migration :11-13, `reject_contact_leak_in_shop` :369 | CONFLICT to decide (OD6): outreach messages must carry a way to reach the sender |
| Job categories (24, incl. the 12 trades of roadmap T1) | `src/lib/jobCategories.ts:23-50` | What a referral source could post as a Helpr job (link back into Jobs) |
| Hidden switch machinery | `src/config/featureSwitches.ts`, `.claude/AGENT-BRIEF.md` "How to ship a hidden feature" | New key (e.g. `business_outreach`), created at testers or off |
| Memberships (Pro) switched OFF for members | roadmap F4/F4a; `supabase/migrations/20261015033658_memberships_switch_off.sql` (switch `memberships` at 'testers'); `create-pro-checkout` refuses via requireFeature | The ONLY Stripe subscription code we have is Pro's, and it is switched off. Outreach billing (OD1) would be the first live subscription |
| Boosts sell on the website only, not inside the iPhone app | roadmap F5; Q1796 (Job Boost sold through Stripe inside iOS, guideline 3.1.1) | Same question for an outreach subscription (OD2) |
| Commercial email sender (Resend) with signed one-click unsubscribe | `supabase/functions/_shared/resend.ts`, `supabase/functions/email-unsubscribe/index.ts` | Reusable for email, but built for OUR members, not third parties |
| No postal address configured for marketing mail | `supabase/functions/_shared/resend.ts:97` (`POSTAL_ADDRESS_LITERAL = ""`); `send-marketing-blast/index.ts:108-125` (owner 2026-08-31 accepted sending without one) | Blocker C3 for any outreach email |
| Marketing opt-in covers our own members only | `profiles.marketing_consent` (`supabase/migrations/20260708011322_profiles_marketing_consent.sql:1-16`) | Says nothing about third parties a sender wants to text or email (C4) |
| No SMS provider in the codebase | grep of `supabase/functions` for twilio/sms/10dlc on b9f7cc6fa: no sender | New provider and new account (C1) |
| Social auto-poster channels | `marketing_channel` enum = instagram, facebook only | Not reusable for SMS/email; different table |
| Planned business dashboard (B2) | roadmap B2/B2a | The scoreboard belongs there once B2 exists |
| Planned "Request a quote" from Shops (L53, Q1-Q8) | roadmap Q2; build queue row 7 | A referral source who replies could be sent to request a quote from the sender inside Helpr |

**What this does NOT reuse:** the removed `businesses` / `business_members` seat backend (Shops prep:
"Do not resurrect"). Team accounts are on hold (roadmap B3): one person per business.

## 2. What it is (proposed shape, for the question round — not decided)

1. **Setup.** A shop owner opens "Outreach" from their shop. Picks the trade (shop category), the
   parishes, and the kinds of referral source to reach. Writes or records a few lines about how
   they talk and what they want to say (the "voice"). Confirms who sends (OD3) and from which
   number/address.
2. **The list.** Helpr builds a list of referral sources in those parishes from PUBLIC business
   listings (brokerage rosters, property-management company sites, home builder association member
   directories, adjuster firm pages). Business contact details only. The sender reviews the list and
   can strike anyone (an existing customer, a competitor's relative).
3. **Messages.** First text and/or email, then follow-ups, in the sender's voice. The sender approves
   the templates before anything goes out (OD3/OD4). Every message names the sender's business and
   says how to stop further messages. A "stop"/"no"/opt-out ends all messages to that person.
4. **Replies.** Replies are tracked and either handed to the sender or worked toward a booked job
   (OD3). An interested reply can become a Helpr job (posted by the referral source) or a quote
   request to the sender's shop.
5. **Scoreboard.** Per sender, per week and per month: contacts on the list, messages sent (by
   channel), delivered, replies, interested, opted out, jobs posted/booked, and the money those jobs
   carried where they went through Helpr. Counts come from the tables, never typed in.
6. **Territory (optional, OD5).** One sender per trade per parish while subscribed.

## 3. Layers it crosses (each named, none built)

| Layer | What it needs | Notes |
|---|---|---|
| Client | Outreach tab on the shop (setup, voice, list review, template approval, scoreboard); admin queue to review lists and templates | Behind a new hidden switch; `useFeature` literal; 375 and 1440 proof of fit; AppShell/PageScaffold primitives |
| RPCs | `outreach_*` create/update setup, approve list rows, approve templates, pause/cancel, read scoreboard | Every RPC starts `PERFORM public.require_feature('<key>')`; owner gate reuses `shops_assert_owner_eligible` (shops-1 migration :405); REVOKE FROM PUBLIC, anon |
| Tables | outreach subscriptions; territories (unique trade + parish if OD5 = yes); contacts (third-party business data, source URL and date found); messages (channel, status, provider id); replies; opt-outs (suppression); scoreboard view | Contacts are third-party data: deletion, export (`dataExportInventory`), retention rule (OD10) and who can read them (sender only? admin?) |
| Edge functions | send (SMS + email providers), inbound reply webhooks (SMS inbound, email inbound/bounce), STOP/opt-out handling, list-builder helper (if any part is automated, OD3) | Each calls `requireFeature(...)` and returns its 403; provider webhooks verify signatures |
| Stripe | A monthly subscription product (OD1); webhook handling in `stripe-webhook`; cancel and refund rules | Stripe is LIVE on prod; nightly journeys never complete a live payment; memberships code is switched off, not deleted |
| Cron | Send pacing and quiet hours (C2), follow-up scheduling, weekly scoreboard email/notification, subscription-lapse pause | Pause switch for storms (lh-marketing §5: no promo sends into an active storm watch/warning) |
| Email provider | Resend today (our domain). Sending AS the business needs its own domain verification or a reply-to model (OD3) | CAN-SPAM footer + postal address (C3) |
| SMS provider | None today. Needs a provider account and carrier registration (C1) | Per-sender brand registration if Helpr sends on behalf of many businesses |
| Deployed artifact | Web first (roadmap F5 precedent for paid things inside iOS) | App Store rules for selling it in the iPhone app: OD2 |

## 4. Still to decide (owner) — OPEN OWNER DECISIONS, tracked as docs/OPEN.md ("Business outreach" item)

None of these is decided here.

| # | Question | Notes for the question round |
|---|----------|------------------------------|
| OD1 | Price and billing: monthly price? setup fee? contract or month to month? free trial? | Memberships (Pro) are switched OFF for members (roadmap F4; switch `memberships` at testers, migration 20261015033658), so no subscription is sold today. The outside offer the owner saw charged $149/month, no setup fee, no contract (his public post; reference only, not a recommendation) |
| OD2 | Sold inside the iPhone app or on the website only? | F5 put boosts on the website only; Q1796 is the open Apple 3.1.1 question for Stripe sales inside iOS |
| OD3 | Who does the work: Helpr staff by hand, AI drafting with staff review, AI end to end, or the business itself sending from the app? | Decides most of the build and most of the compliance load (C1, C2). "In the owner's voice" via AI needs the sender to approve templates |
| OD4 | Does the sender approve every message, only the templates, or nothing? | Recommendation to put to the owner: templates approved before the first send |
| OD5 | Exclusivity: one sender per trade per parish? per city? for how long? what happens on cancel or non-payment? waitlist? | Shops boosts use "max 3 per section per parish" (L59); exclusivity would be a new rule |
| OD6 | How a referral source reaches the sender: the sender's own phone/email in the message (conflicts with L49 "no phone, email or website on shop pages" in spirit), or replies come into Helpr messages first? | The contact-leak filter blocks contact details inside the app today |
| OD7 | Which areas first? | Roadmap G5 measured (2026-10-14, prod, non-seed) most members in Acadiana (Vermilion, Iberia, Lafayette) |
| OD8 | Which trades are eligible (any shop category, or trades only)? | The source post's list maps to shop categories except generators |
| OD9 | Which referral-source types (realtors, property managers, landlords, builders, adjusters)? | Adjusters may have employer or licensing rules about recommending contractors (NOT VERIFIED; C6) |
| OD10 | How long contact lists and message logs are kept, and whether a sender keeps "their" list after cancelling | Third-party data; affects deletion and export |
| OD11 | What the scoreboard promises: counts only, no job guarantee (the source post's own line is "no guarantee of jobs") | Any outcome claim in our sales copy falls under lh-marketing §3 |
| OD12 | Does one opt-out stop ALL senders from contacting that person through Helpr, or only that sender? | A shared suppression list is the safer reading; needs C2 review |

## 5. Compliance blockers — must be resolved before any build (needs owner + legal review)

Stated as facts about what the rules cover, NOT legal advice and NOT settled law for this product.
Each needs the owner and a lawyer. Tracked with OD1-OD12 under docs/OPEN.md ("Business outreach" item).

| # | Blocker | Status |
|---|---------|--------|
| C1 | **SMS carrier registration (A2P 10DLC).** US mobile carriers require business text messages sent through an application over ordinary 10-digit numbers to be registered (a brand plus a campaign) through the carriers' registry, usually via the SMS provider. A platform sending for many businesses typically registers each business as its own brand. Unregistered traffic is filtered or blocked by carriers. | Needs owner + legal review; provider's current rules not read |
| C2 | **TCPA and texts to cell phones.** The federal Telephone Consumer Protection Act and FCC rules govern calls and texts to mobile numbers, including consent requirements for marketing texts, opt-out handling and calling-time limits; many realtor and property-manager "business" numbers are personal cell phones. Louisiana also has its own telephone-solicitation and do-not-call rules (Louisiana Public Service Commission; NOT read). Whether and how consent rules apply to a first text from a platform on a business's behalf is the core question. | Needs owner + legal review |
| C3 | **CAN-SPAM for commercial email.** Commercial email, business-to-business included, must carry a working opt-out honoured promptly, a valid physical postal address of the sender, non-deceptive From/Subject lines, and identification as an advertisement where required. Our code has no postal address configured (`_shared/resend.ts:97`), by owner choice on 2026-08-31 for our own mail. | Needs owner + legal review; an address decision is required |
| C4 | **`profiles.marketing_consent` covers only our own members** opting in to OUR mail (migration 20260708011322). It gives no consent for a sender to contact third parties, and no consent for Helpr to contact non-members. | Fact from the code |
| C5 | **Third-party contact data.** Building lists from public listings means storing other people's business contact details and where they came from; scraping some sites can break their terms of use. Deletion/export on request and retention (OD10) need a rule. | Needs owner + legal review |
| C6 | **Licensed-profession rules for recipients and claims.** Realtors (LREC), insurance adjusters (Louisiana Department of Insurance) and contractors (LSLBC) each have their own rules; e.g. whether an adjuster may refer a homeowner to a contractor, and what a contractor's ads may say. NOT VERIFIED. | Needs owner + legal review |

## 6. Build facts (measured in the code 2026-10-15, not owner decisions)
- Shops slice 1 is NOT on main: origin/wip/shops-1 @ 6379781d6, switch `shops` created OFF.
  Outreach cannot start before it lands.
- Memberships: `FEATURE_SWITCH_KEYS` includes `memberships` (`src/config/featureSwitches.ts`),
  created at 'testers' by 20261015033658 so the App Review account keeps Pro during the 1.0.4
  review; every other member has memberships off.
- Jobs fee today: the poster pays the job price; the Helpr pays a flat 5% + $0.70 out of their pay
  (`src/lib/helprFlatFee.ts:4-9, 24-28`; PR #3147). A job that comes from outreach is an ordinary job
  on that model.
- No SMS sender exists in `supabase/functions`; email goes through Resend (`_shared/resend.ts`).

## 7. Slices (proposal, after every OD and C is answered)
1. Manual pilot with no code: Helpr staff run outreach for one or two real shops by hand, the way
   docs/marketing/outreach-campaign-2026-10.md runs our own, to learn the reply and job numbers for
   real before anything is built or priced.
2. Scoreboard + list review + template approval screens; sending stays manual.
3. Email sending (after C3, C5).
4. SMS sending (after C1, C2).
5. Billing (after OD1, OD2) and territories (after OD5).
