# Louisiana Helpr outreach campaign — October 2026 (draft for the owner)

Owner ask (2026-10-15): use the same method a Lafayette roofing company described in a Facebook
post (build a list of local referral sources, message each one personally, follow up, keep score)
to grow Louisiana Helpr itself. This is that plan, written our way. Nothing here copies that post.

Rules this follows: `.claude/skills/lh-marketing/SKILL.md` §2 (voice), §3 (no claim without a
source), §4 (compliance, §4.5 fee wording). Every product claim used in a message is listed in
section 6 with its file:line, read on origin/main b9f7cc6fa (2026-10-15). Nothing is sent by
Claude; the owner sends every message by hand. Owner questions and the review items are tracked on
docs/OPEN.md as the "Business outreach" item (the product version is docs/specs/business-outreach.md).

No numbers are promised or estimated here. The roofing company's own day-one figures are his
self-reported claims, not ours, and are not a target.

---

## 1. Who to reach, and why each would actually post a job

Every account on Helpr both posts and takes jobs (one signup). These are people who regularly need
small local jobs done for someone else's property, on a deadline. Categories are the real labels in
`src/lib/jobCategories.ts:23-50`.

| Contact type | Why they would post | Categories that fit | Strength |
|---|---|---|---|
| **Realtors / listing agents** | A listing needs to look ready before photos and showings, often for an out-of-town or elderly seller | Cleaning, Yard Work, Pressure Washing, Handyman, Painting, Moving, Assembly | Strong: frequent, small, deadline-driven jobs |
| **Property managers** | Every turnover needs cleaning, paint, small repairs, yard upkeep; maintenance calls between turnovers | Cleaning, Painting, Handyman, Yard Work, Pressure Washing, Plumbing, Electrical, HVAC, Appliance Repair, Flooring & Tile | Strong: repeat work. Many already have vendors; pitch as backup when a vendor is booked |
| **Small landlords (a few doors)** | Same turnover and repair work, usually without a vendor list | Cleaning, Handyman, Yard Work, Painting, Plumbing, Appliance Repair | Strong, but harder to list from public business directories (many are individuals: business listings only, section 2) |
| **Home builders / remodelers** | Final cleanup before closing, punch-list items, assembly, hauling | Cleaning, Assembly, Moving, Handyman, Pressure Washing, Fencing, Concrete & Masonry | Medium: most use their own subs; smaller jobs and overflow only |
| **Insurance adjusters** | They do not hire for the homeowner. At most they might mention it to a homeowner | Storm Prep, Roofing, Handyman (homeowner posts, not the adjuster) | **Weak: referral only, and adjusters may have employer or licensing limits on recommending anyone (NOT VERIFIED). Recommend leaving them out of the first round** |

Do NOT mention Rentals, Declutter, Shops or Quotes: none is live for members (each is behind a
hidden switch or on an unlanded branch, docs/specs/build-queue.md). Do NOT say "download the app":
build 1.0.4 is the first store build and was in App Review on 2026-10-15
(`supabase/migrations/20261015033658_memberships_switch_off.sql` header). Send people to the website.

## 2. Building the list (public business listings only)

Sources (business contact details only, as published by the business for business use):
- Brokerage websites' agent rosters (office phone, business email, listing area).
- The Louisiana Real Estate Commission's public license lookup, to confirm someone is an active
  licensee and which brokerage they are with (do not copy personal home addresses).
- Property-management company websites ("Contact us", leasing office line).
- Home Builders Association member directories for the parish's area (company, main line, business
  email).
- Adjusters: leave out for round one (section 1).

Never: personal Facebook profiles or personal phone numbers found in groups, home addresses,
anything behind a login, bought lists, or contact details of anyone who has already said no.
If a site's terms forbid copying its directory, do not copy it (needs owner review, docs/OPEN.md
"Business outreach" item).

Spreadsheet layout (one row per contact; a Google Sheet or Excel file the owner keeps privately):

| Column | What goes in it |
|---|---|
| id | 1, 2, 3 ... |
| date_found | YYYY-MM-DD |
| contact_type | realtor / property_manager / landlord / builder |
| business_name | as published |
| contact_name | as published on the business page |
| parish | exact `src/lib/parishes.ts` name, no "Parish" (e.g. Lafayette, Vermilion) |
| city | |
| business_phone | as published; mark mobile/landline if known |
| business_email | as published |
| source_url | the page it came from |
| channel_first | text / email |
| first_sent | date |
| followup_1 | date |
| followup_2 | date |
| replied | date or blank |
| reply_kind | interested / question / not_now / no / stop / wrong_person |
| do_not_contact | yes once anyone says no or stop; never message again |
| signed_up | date confirmed (they told you, or their account shows in Admin) |
| first_job_posted | date of their first real (non-seed) job |
| notes | |

## 3. Messages (owner's own words; edit freely, keep the facts)

Replace every [bracket]. Use your real name and real town ("my people are from [town]" is better
than "I'm local", lh-marketing §3). One message at a time, from your own phone or email.

### First text (realtor; swap the job examples for the contact type)
> Hi [first name], this is [your name] with Louisiana Helpr. It's a Louisiana site where you post a
> local job, like a make-ready clean or yard work before photos, and people nearby apply. You pick
> who does it, and the payment is held until you confirm the work is done. Would that help on your
> [parish] listings? louisianahelpr.com
> If it's not for you, just say so and I won't text again.

Property manager version, middle sentence: "...post a local job, like a turnover clean, paint
touch-up or a small repair, and people nearby apply."
Builder version: "...post a local job, like a final clean before closing or furniture assembly, and
people nearby apply."

### First email
Subject: Help with [listing make-readies / turnovers / final cleans] in [parish]

> Hi [first name],
>
> I'm [your name], and I run Louisiana Helpr. It's a Louisiana site for local jobs: you post what
> you need, set a budget and pick a date, and local applicants come to you. You compare their
> profiles and reviews and pick who does it. The payment is held securely and released when you
> confirm the work.
>
> I thought of you because [listings / turnovers / closings] in [parish] usually need [cleaning,
> yard work, small repairs] on a deadline. Posting is at louisianahelpr.com. The checkout screen
> shows every charge before you pay, including any fee.
>
> If it's useful, I'm glad to walk you through your first post. If not, no problem.
>
> [your name]
> Louisiana Helpr · [phone]
>
> ---
> You're getting this because your business contact is listed on [source]. If you don't want to hear
> from me again, reply "no" and I won't email you again.
> Louisiana Helpr · [business postal address: OWNER DECISION, see section 5]

### Second message (about 4-5 days after the first, only if no reply)
> Hi [first name], [your name] from Louisiana Helpr again. Just checking whether a local person for
> [make-readies / turnovers] would be useful. If not, say so and that's the last you'll hear from me.

### Third and last message (about a week after the second, only if no reply)
> Last note from me, [first name]. If you ever need a [cleaning / yard / repair] job done in
> [parish], you can post it at louisianahelpr.com and local people apply. Take care.

After the third message with no reply: stop. Mark the row done.

### Replies to the common answers
| They say | You answer |
|---|---|
| "What does it cost?" | "Posting is at louisianahelpr.com. Before you pay, the checkout screen lists every charge, including any fee, so you see the exact number first. The payment is held until you confirm the work." (Do NOT say free, small, or quote a number: §4.5.) |
| "Who are these people? Are they insured / licensed / background-checked?" | "You see each applicant's profile and reviews before you pick, and you choose who does it." Do NOT promise checks, licensing, insurance or safety (§4.1). If they need a licensed trade, say "I'd post it and look at each applicant's profile." |
| "How fast do people apply?" | "I can't promise a time. Local applicants come to you, and you pick." (No unsourced numbers, §3.) |
| "Send me more info" | Link louisianahelpr.com (the How it works section is on that page) and offer to walk them through a first post. |
| "We already have our people" | "Makes sense. If one of them is booked up, it's there." Then stop; mark not_now. |
| "Can my crew / vendors find work on it?" | "Yes, the same account can take jobs too. They sign up at louisianahelpr.com and see their take-home before they apply." |
| "We need [something not listed]" | "There's an Other category for anything not on the list." |
| "No" / "Stop" / "Take me off" / no interest | "Understood, I won't contact you again." Mark do_not_contact = yes the same day. Never message them again from any number or address. |
| "Who is this? Is this real?" | Your full name, that you run Louisiana Helpr, your town, and the website. |
| Anything angry | Apologise once, mark do_not_contact, stop. |

## 4. Sending rules

- The owner sends personally, one message at a time, from the owner's own phone and email. No
  bulk texting tool, no mail-merge, no auto-dialer, no scheduled sends until compliance is checked
  (TCPA for texts, CAN-SPAM for email: needs owner + legal review, docs/OPEN.md "Business outreach" item).
- Business contact details from public business listings only (section 2).
- Every email carries the opt-out line and a business postal address (section 3 footer; the
  address is an owner decision, section 5).
- Stop on any "no", "stop" or equivalent: same day, permanently, every channel.
- At most the first message plus two follow-ups per person.
- Weekdays, business hours only.
- No sends into an active named-storm watch or warning, and no storm-urgency or price talk
  (lh-marketing §5).
- Never mention a person, job or customer by name; never quote a number that is not in section 6.

## 5. Scoreboard

One tab in the same spreadsheet, one row per send day:

| date | contact_type | parish | channel | sent | replied | interested | signed_up | first_job_posted |
|---|---|---|---|---|---|---|---|---|

- `sent`: first messages sent that day (follow-ups counted in a separate `followups_sent` tab or
  column if the owner wants them).
- `replied`: any reply, including no.
- `interested`: asked a question or said yes/maybe.
- `signed_up`: confirmed new account (the person told you, or you found their account in Admin).
- `first_job_posted`: their first real, non-seed job posted.

Funnel to report each week, from the rows (never estimated): sent -> replied -> interested ->
signed up -> first job posted, as counts and as each step's share of the step before, split by
contact_type and by parish. Also report opt-outs (do_not_contact added that week). A count read from
this sheet is fine to share with the owner; it is NOT approved for public posts until the owner says
so (§3).

## 6. Every claim in the messages, with its source (origin/main b9f7cc6fa, read 2026-10-15)

| Claim in the copy | Source |
|---|---|
| You post a job, set a budget, pick a date | `src/components/landing/HowItWorksSection.tsx:30-31` ("Tell us what you need, set a budget, and pick a date.") |
| Local applicants come to you; compare profiles and reviews; you pick | `HowItWorksSection.tsx:34-35` |
| Payment is held and released when you confirm the work | `HowItWorksSection.tsx:38-39`; Helpr side `src/components/dashboard/applyConfirmDialog/ApplyEarningsBreakdown.tsx:170` ("Held securely, released when the job is marked complete.") |
| The checkout screen lists every charge, including any fee, before you pay | `src/components/postjob/CheckoutStep.tsx:460-478` (Job Budget row; a Service Fee row only if one applies; Urgent Bonus; One-Time Account Setup (First Job Only)); sales tax row follows. Underlying model: poster pays the job price, Helpr pays 5% + $0.70 from their pay, `src/lib/helprFlatFee.ts:4-9, 24-28` (PR #3147). Per §4.5 the copy says only that a fee may apply and where it is shown |
| The same account can take jobs; they see their take-home before they apply | `HowItWorksSection.tsx:15-18` (one account both posts and works), `:55`; `ApplyEarningsBreakdown.tsx:151` ("Take-home") |
| Job examples (cleaning, yard work, repairs, paint, pressure washing, assembly, moving, trades) and "Other" | `src/lib/jobCategories.ts:23-50` |
| louisianahelpr.com is the site | `public/sitemap.xml:10` |

Not used, on purpose:
- **Anything about ID verification.** Identity verification stopped gating posting or hiring on
  2026-10-01 (`supabase/migrations/20261001222911_remove_idv_requirement.sql:1-14`;
  `src/components/job-card/activityActions/useOfferHandlers.ts:37-38`). The landing page still says
  "Verify your ID once, then work" (`HowItWorksSection.tsx:59`) and lh-marketing §0/§4.1 still
  describe the old gate; filed as docs/OPEN.md (item "The landing page still says Verify your ID once").
- Any fee amount, "free", or "small": §4.5.
- Any count of members, jobs, Helprs or replies: §3.
- Background checks, insurance, licensing or safety: §4.1.

## 7. OPEN OWNER QUESTIONS (tracked in docs/OPEN.md, "Business outreach" item)

1. Which parish or parishes to start in? (Context, not a decision: roadmap G5 measured most members
   in Acadiana on 2026-10-14: Vermilion, Iberia, Lafayette.)
2. How many first messages per day?
3. Which phone number and which email address send them (personal, or a business line/address)?
4. Which business postal address goes in the email footer? (Our app's marketing mail has none
   configured, `supabase/functions/_shared/resend.ts:97`, by owner choice 2026-08-31.)
5. Texts, emails, or both for round one, after the TCPA / CAN-SPAM review?
6. Leave insurance adjusters out of round one (recommended), or include them?
