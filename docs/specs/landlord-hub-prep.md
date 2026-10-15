# Landlord hub (rentals + maintenance) — prep and owner question list

Prep for the Landlord section, written BEFORE any owner question is asked and before any build
(owner, 2026-10-14: every question decided first "so we aren't working backwards"; same process as
docs/specs/declutter-auctions.md). Built behind a hidden switch, after the open list (standing order
10-12). Not a docs/OPEN.md item (owner order 10-13: no new to-do items); nothing below is a to-do list.

Prepared 2026-10-14 by a research agent (read-only code reading at 81412655e + primary-source legal
reading). Nothing here is legal advice; every legal line says whether the text was READ (VERIFIED) or
only reported by a search result or secondary source (NOT VERIFIED).

## Decided (by the owner, before this prep)
| # | Question | Decision | When |
|---|----------|----------|------|
| 1 | How big | FULL version: landlords list homes/apartments, renters browse and APPLY in the app, landlords review, LEASES are signed in the app | 2026-10-14 |
| 2 | Maintenance | Tenants send maintenance requests; once the landlord approves, the request becomes a normal Helpr job and the LANDLORD pays | 2026-10-14 |
| 3 | Process | Every question decided by the owner before building | 2026-10-14 |
| 4 | Direction | Louisiana Helpr becomes "the main hub for Louisiana" (jobs, Declutter, now rentals) | 2026-10-14 |

## Build facts (measured in the code 2026-10-14; what already exists and can be reused)
Read at /Users/lexilombas/.lh-wt/session-c22a5fe9 (branch wip/declutter-terms, 81412655e). One line each.

Reusable as-is
- Hidden switches: `public.feature_switches` + `feature_enabled_for()` (migration 20261012031120_hidden_feature_switches.sql), client `src/hooks/useFeature.ts`, edge `supabase/functions/_shared/featureSwitch.ts` (requireFeature), admin toggle in `src/components/admin/AdminSettings.tsx`. Declutter already uses this pattern.
- Identity: Stripe Identity is ALWAYS required before anyone posts or accepts a job (migration 20260908001056_identity_always_required.sql; `supabase/functions/stripe-idv-start`, `stripe-idv-webhook`, `_shared/stripeIdentity.ts`; admin `AdminIDVReview.tsx`). Landlords and renters can reuse the same verified badge.
- 18+ rule: sign-up 18+ checkbox (`src/pages/auth/Signup.tsx`), saved birthday under 18 greys out Apply/Post and the server refuses (owner 10-13); Declutter's `declutter_assert_member(true)` shows the server-side pattern.
- Jobs end to end: post (`src/pages/post-job/`), apply (`apply_to_job`), accept (`accept_application`, migration 20261005184940), escrow-style capture via `supabase/functions/create-payment`, payout by separate charges and transfers in `supabase/functions/release-payout` (`stripe.transfers.create`, `transfer_group: job_<id>`), auto-release (`auto-release-payment`), refunds/cancel fee rules (`_shared/cancellationFee.ts`, owner rule "never absorb any fee"). A maintenance job can BE a normal job.
- Recurring jobs: series + per-visit charging (`supabase/functions/charge-recurring-visits`, `src/lib/recurringSchedule.ts`, `src/pages/posts/postedJobs/RecurringVisitPayments.tsx`) for lawn, pest, filter changes.
- Access & parking notes: `public.job_access_notes` (gate codes readable only by poster + booked Helpr; `src/lib/jobAccessNotes.ts`). Reusable for "how to get in / tenant present?".
- Licensed-trade gate: per-job "Who can apply" credential tier (Open / Licensed / Licensed + Insured), enforced by the database (`src/components/postjob/detailsSection/CredentialTierSelector.tsx`; credential review `AdminCredentialQueue.tsx`).
- Photo/video upload + compression (`src/lib/imageCompression.ts`, `src/components/PhotoProof.tsx`, `src/lib/photoProofPolicy.ts`); Declutter's EXIF/GPS strip (`src/lib/declutter/photos.ts` on ready/declutter-3) for listing photos.
- AI drafting from photos/text: `supabase/functions/ai-job-builder` (Gemini); Declutter's `declutter-ai-draft` shows a fail-closed "check" mode usable for fair-housing wording checks.
- Messaging + contact-leak filter: server `public.contact_leak_reason` (messages, applications, job posts, bios), client `src/lib/contactLeakRules.ts`, `src/lib/messageScanner.ts`; block (`src/lib/userBlocks.ts`, `BlockUserDialog.tsx`), report (`ReportDialog.tsx`, `AdminReports.tsx`).
- Reviews: `public.reviews`, blind window until both review or 14 days (`set_review_visibility`, `can_review_job`), `reject_contact_leak_in_review`, `respond_to_review`, `ReviewPanel.tsx`. Job-only today.
- Disputes: `rpc_open_dispute`, `rpc_decide_dispute`, evidence append-only, `AdminDisputes.tsx`, `execute-dispute-split`. Job-only (good: a maintenance job's dispute is an ordinary job dispute).
- Strikes: `public.user_violations` + `apply_consequence_ladder`; Declutter has its own 3-strike count (separate from job strikes) as a model.
- Notifications: `public.notifications` rows -> push + bell via fan-out trigger; templates in `supabase/functions/_shared/notification-templates.ts` / `create-notification`; email via Resend queue (`process-email-queue`).
- Admin queues and audit: `src/components/admin/` (IDV, credentials, disputes, reports, exception queue, ban review, audit log `adminAudit.ts`).
- Account deletion + purge: `supabase/functions/delete-own-account` (`findActiveWork` refuses deletion during active work), `_shared/accountPurge.ts`, `_shared/purgeBuckets.ts` (purges `<uid>/` in avatars, user-documents, application-attachments; Declutter added `job-photos/<uid>/declutter/`).
- Data export: `export-my-data` + `public.export_my_data`; every new table must be listed or exempted in `src/test/helpers/dataExportInventory.ts` (Declutter B9 was a go-live blocker until its sections were added).
- Private document storage: buckets `application-attachments` (made private by migration) and `id-documents` (private, excluded from the nightly backup) — the pattern for income documents.
- Income proof that already exists: `/work-record` (`src/pages/profile/WorkRecord.tsx`, `src/lib/workRecordDocument.ts`) — "the document a Helpr hands a landlord or a lender". A renter who works on Louisiana Helpr can attach it to an application.
- Home record: `src/pages/profile/HomeHistory.tsx` + `src/lib/homeHistoryDocument.ts` — per-address PDF of jobs done at a home. Natural "maintenance history per unit" for landlords.
- Rental hosts already served: `src/pages/profile/StrSettings.tsx` + `supabase/functions/str-ical-sync` (Airbnb/VRBO iCal -> drafts a cleaning job per checkout; never posts it itself, Q768). Precedent for "landlord approves, then it posts".
- Sales tax hooks: `_shared/salesTax.ts`, `calculate-tax`, `src/hooks/useStripeSalesTax.ts` (labor tax on some categories; long-term residential rent is not a sales-tax item — not researched further).
- Background-check purchase exists but is OFF: `supabase/functions/create-bgc-payment` (Helpr background checks via Checkr/Certificial; switched off "while the screening provider has no accounts"; webhook `verification-webhook`). Not a tenant-screening product and not FCRA-set-up for housing.
- Business accounts exist (`public.businesses`, `business_members`, `review_business_verification`) — a property-management company could be a business account, but see the real-estate license finding before allowing managers.

Missing (nothing in the code today; measured by grep for landlord/tenant/rental/lease/property/unit)
- No property / unit / listing / application / lease / maintenance-request tables, routes or screens ("landlord" appears only in Work Record copy; "lease" hits are lock leases, not housing).
- No e-signature, no PDF lease generator (there IS a PDF builder: `src/lib/pdfDocument.ts`, used by Work Record and Home History).
- No tenant screening (credit/eviction/criminal), no FCRA adverse-action notices.
- No saved bank account (ACH) payments for members; card only. No rent or deposit collection.
- No "a third party (tenant) asks, another party (landlord) pays" job flow: a job's `customer_id` is both the asker and the payer. Maintenance needs a request object that the landlord turns into a job.
- No proof-of-ownership check for a property (parish assessor / deed).
- No fair-housing wording check on listings.

## Legal findings (2026-10-14) — lawyer needed before build
Federal Fair Housing Act
- VERIFIED (law.cornell.edu, 42 U.S.C. 3604(c)): unlawful "to make, print, or publish, or cause to be made, printed, or published any notice, statement, or advertisement, with respect to the sale or rental of a dwelling that indicates any preference, limitation, or discrimination based on race, color, religion, sex, handicap, familial status, or national origin". 3604(a)/(b) cover refusing to rent and terms; 3604(f) disability, incl. (f)(3)(B) refusing "reasonable accommodations in rules, policies, practices, or services" (assistance animals live here) and (f)(3)(A) reasonable modifications. https://www.law.cornell.edu/uscode/text/42/3604
- VERIFIED (42 U.S.C. 3603(b)): small-landlord exemptions (single-family house by an owner with no more than three; owner-occupied building of up to four units) do NOT apply to the advertising rule ("Nothing in section 3604 of this title (other than subsection (c))") and are lost if the owner uses "the sales or rental facilities or the sales or rental services of any ... person in the business of selling or renting dwellings". So EVERY listing in the app is covered by the advertising rule, even from exempt small landlords. https://www.law.cornell.edu/uscode/text/42/3603
- VERIFIED (govinfo copy of 91 FR, doc 2026-06624, published 2026-04-06, effective 2025-09-17): HUD WITHDREW its April 29, 2024 guidance on FHA advertising through digital platforms, FHEO-2020-01 (assistance animals), FHEO 2013-01 (service/assistance animals) and the 2022 implementation memo on criminal records, among 8 documents. The April 2024 tenant-screening guidance is NOT on that list (status otherwise unclear; another withdrawal round may exist — not verified). Withdrawal of guidance does not change the statute. https://www.govinfo.gov/content/pkg/FR-2026-04-06/html/2026-06624.htm
- NOT VERIFIED (secondary summaries only, opinion text not read): Fair Housing Council v. Roommates.com, 521 F.3d 1157 (9th Cir. 2008, en banc) — a site that REQUIRES users to answer discriminatory questions through its own drop-downs loses Section 230 protection for those questions; free-text "comments" stayed protected. Design lesson: the app must never offer a field or filter about a protected trait.
- NOT VERIFIED (DOJ press release excerpts only): U.S. v. Meta (2022) — first DOJ case over algorithmic bias in housing-ad DELIVERY; Meta dropped its lookalike tool for housing ads. Design lesson: no "who should see this listing" targeting and no ranking on protected-trait proxies. https://www.justice.gov/opa/pr/justice-department-secures-groundbreaking-settlement-agreement-meta-platforms-formerly-known

Louisiana Equal Housing Opportunity Act
- VERIFIED (legis.la.gov R.S. 51:2606): A(1) refusing to rent covers "race, color, religion, sex, familial status, national origin, military status, or natural, protective, or cultural hairstyle"; A(3) advertising rule adds "disability" to that list. Louisiana adds MILITARY STATUS and HAIRSTYLE beyond federal law. https://legis.la.gov/Legis/Law.aspx?d=104419
- NOT VERIFIED (search excerpts): bills to add sexual orientation/gender identity (HB 303 of 2022) and source of income did not appear in the current text. New Orleans' own code (Chapter 86) reportedly adds creed, age, marital status, sexual orientation, gender identity and maybe source of income; sources disagree. Lawyer to confirm parish/city rules where we launch.

Tenant screening (FCRA) — only if the app offers credit/background checks
- VERIFIED (15 U.S.C. 1681b): a report may be furnished "In accordance with the written instructions of the consumer" ((a)(2)) or for a "legitimate business need ... in connection with a business transaction that is initiated by the consumer" ((a)(3)(F)(i)).
- VERIFIED (15 U.S.C. 1681m(a)): whoever takes adverse action based in whole or part on a report must notify the person, disclose any credit score used, name the agency (name, address, phone), say the agency "did not make the decision", and explain the right to a free copy within 60 days and to dispute.
- VERIFIED (FTC "Using Consumer Reports: What Landlords Need to Know"): adverse action includes denying, requiring a co-signer, or charging a larger deposit or higher rent; a screening company's "risk score or recommendation" is itself a consumer report; reports must be disposed of so they "can't be read or reconstructed"; the page warns a blanket refusal of anyone with a criminal record may violate the FHA. https://www.ftc.gov/business-guidance/resources/using-consumer-reports-what-landlords-need-know
- VERIFIED (15 U.S.C. 1681a(f), (u)): a "consumer reporting agency" is anyone who for fees "regularly engages" in assembling or evaluating consumer information to furnish reports to third parties; a "reseller" assembles and merges another agency's data. If OUR servers receive, score, merge or pass reports to landlords, we risk being a CRA/reseller with full FCRA accuracy and dispute duties. Safest model: renter orders and pays inside the partner's own flow, the partner delivers the report straight to the landlord, and Louisiana Helpr never stores it (the TransUnion SmartMove pattern; partner terms not read).
- NOT VERIFIED (FTC blog + secondary): FTC v. AppFolio (2020, $4.25M): a property-management software company acting as a tenant-screening CRA was penalised for inaccurate criminal/eviction records and reporting non-conviction records older than 7 years.

Louisiana landlord–tenant law
- VERIFIED (Civil Code art. 2681, legis.la.gov d=109742): "A lease may be made orally or in writing." (Amended by Acts 2026, No. 240; per search digest it moves the recordation rule to new art. 2681.1, effective 2026-08-01 — digest not verified.)
- VERIFIED (art. 2682): the lessor must deliver the thing, keep it "in a condition suitable for the purpose of which it was leased", and protect the lessee's "peaceful possession for the duration of the lease".
- VERIFIED (art. 2683): the lessee must pay rent, use the thing as a prudent administrator, and return it as delivered "except for normal wear and tear".
- VERIFIED (art. 2687): lessee liable for damage caused by his fault or by people he lets in. (art. 2692): lessee must repair deterioration from his or his guests' use beyond normal use.
- VERIFIED (art. 2688, "Obligation to inform lessor"): the tenant must tell the landlord "without delay" when the place is damaged or needs repair; the landlord can recover damages caused by a failure to tell. -> A maintenance request is the tenant's notice; the app should timestamp it and give both sides a copy.
- VERIFIED (art. 2691): during the lease the lessor must make all repairs that become necessary to keep it suitable, except those the lessee is responsible for. (art. 2693): the lessor may make a repair that cannot wait even if it inconveniences the tenant; the tenant may get a rent reduction or dissolution depending on the circumstances.
- VERIFIED (art. 2694): if the lessor fails to make a necessary repair "within a reasonable time after demand by the lessee", the lessee may have it made and get reimbursed or deduct it from rent, only if necessary and reasonably priced. NOT VERIFIED (case summaries): courts require proof of notice for EACH repair (Hinds v. Poo-Yie's) -> the request's timestamped record matters to tenants; app copy must not give legal advice either way.
- NOT VERIFIED (secondary only): Louisiana has NO statute setting landlord entry notice; the lease and art. 2682 peaceful possession control; emergency entry reportedly under art. 2700 (not read).
- VERIFIED (R.S. 9:3251, d=107468; amended by Acts 2026, No. 63): residential deposits must be returned "within one month after the lease shall terminate"; if any part is kept, an itemized statement is due "within one month after the date the tenancy terminates or within fifteen days after the date that is one month after the tenancy terminates"; the tenant must give a forwarding address; does not apply when the tenant abandons the premises.
- VERIFIED (R.S. 9:3252, d=107469): wrongful keeping -> tenant recovers the greater of "three hundred dollars or twice the amount of the portion of the security deposit wrongfully retained"; "Failure to remit within thirty days after written demand for a refund shall constitute willful failure."
- VERIFIED (R.S. 9:3258.1, d=1238734; Act 422 of 2021): before taking an APPLICATION FEE a lessor must give written notice of the fee amount and whether credit scores, employment history, criminal history or eviction records are considered, and that the applicant may submit a good-faith hardship statement of "two hundred words or less" about a declared disaster/emergency, referencing "the COVID-19 pandemic and hurricanes". Notice may be electronic under Louisiana UETA. Does not cover owner-occupied buildings of up to four units. No private cause of action. No refund rule; no statewide fee cap found (search only).
- NOT VERIFIED: HB 333 of 2024 ("Fair Chance in Housing Act", criminal-history disclosures, R.S. 9:3258.2) reportedly died in committee.
- NOT VERIFIED: New Orleans "Healthy Homes" rental registry (2022 ordinance, phased 2024-2025) — registration + minimum standards for rentals in Orleans Parish. A listing tool may need a registry-number field there.

Federal lead-based paint disclosure (pre-1978 housing)
- VERIFIED (40 CFR 745.103, law.cornell.edu): "Target housing means any housing constructed prior to 1978, except housing for the elderly or persons with disabilities" (0-bedroom exception in the full definition: NOT VERIFIED, text truncated); "Lessor means any entity that offers target housing for lease"; "Agent means any party who enters into a contract with a seller or lessor ...".
- VERIFIED (40 CFR 745.113(b),(c)): every lease of target housing must include, attached or within: the Lead Warning Statement (opens "Housing built before 1978 may contain lead-based paint."), the lessor's disclosure of known lead paint/hazards or no knowledge, a list of records given, the lessee's acknowledgment of receiving the information and the EPA pamphlet, an agent statement if an agent is involved, and signatures and dates; lessor AND any agent keep a copy at least 3 years from the start of the lease.
- VERIFIED (40 CFR 745.101): exempt: leases of housing certified lead-free, short-term leases of 100 days or less with no renewal possible, renewals where everything was already disclosed. -> The app must ask "year built" and auto-attach the lead form for anything before 1978. Lawyer: are WE an "agent" (we contract with the lessor)? If yes we have our own 3-year retention duty.

Electronic signatures and electronic notices
- VERIFIED (R.S. 9:2603, Louisiana UETA scope, d=107129): the act covers electronic records and signatures in transactions; excluded are wills/testamentary trusts, Title 10 transactions, and "Any notice of" ... "Default, acceleration, repossession, foreclosure, or eviction, or the right to cure" under "a rental agreement for, a primary residence of an individual", and utility shut-off notices. Leases themselves are NOT excluded.
- VERIFIED (15 U.S.C. 7003(b), ESIGN): same carve-out federally: notices of default, eviction or right to cure under "a rental agreement for" "a primary residence of an individual", and utility cancellation notices.
- So: signing a residential lease in the app is legally supported (subject to the lawyer's template and consent-to-electronic-records wording); the app must NEVER be the channel for eviction, default or cure notices — those go on paper by the landlord.

Real estate licensing (does helping landlords lease property for a fee need a license?)
- VERIFIED (R.S. 37:1431(24), d=93260): "real estate activity" = activity in a real estate transaction "performed for another" by anyone "who for a fee, commission, or other valuable consideration" (or expecting one): (a) rents or leases or negotiates rentals/leasing; (b) offers or attempts to negotiate rentals/leasing; (c) "Lists or offers or attempts or agrees to list for sale or lease any real estate"; (e) advertises or holds out as in the business of renting or leasing; (f) "Assists or directs in the procuring of prospects or the negotiation or closing of any transaction ... which results or is calculated to result in the ... leasing, or renting of any real estate". "Real estate" includes leaseholds; "Seller" includes a lessor and "Buyer" includes a lessee. "Property management" (1431(20)) and "property manager" (1431(21), incl. "collection of rents", "supervision of property maintenance") are defined activities.
- VERIFIED (R.S. 37:1437(A), d=93266): anyone "desiring to conduct real estate activity in this state, shall file an application for a license with the commission."
- VERIFIED (R.S. 37:1438, d=93270): exemptions are owners/lessors performing acts of ownership on THEIR OWN property (A(1), A(5)), attorneys, court officers, deed-of-trust trustees, salaried employees of a licensed broker (only delivering/receiving leases, applications, deposits, rent; showing units; clerical/maintenance), housing-authority/HUD managers, agricultural managers. There is NO exemption for publishers, websites, listing services or online platforms.
- VERIFIED (lrec.gov/faqs): "Individuals wishing to manage property on behalf of multiple owners must obtain a broker's license."
- NOT VERIFIED (nothing found): any LREC opinion or case on whether an online listing/application/lease PLATFORM is doing "real estate activity". Risk read: a platform that takes a FEE (per listing, per lease, % of rent, or from applicants) and "lists", "assists in procuring prospects" or helps "negotiate or close" leases fits the words of (24)(c) and (f); a FREE listing service, or a fee only for unrelated things (Helpr jobs), is lower risk but still unconfirmed. Property managers listing for owners need their own broker license. Ask LREC in writing ((225) 925-1923) and a lawyer BEFORE charging any rental-related fee. Penalties: not read (secondary sources say civil fines up to $5,000 per violation — NOT VERIFIED).

Data security
- VERIFIED (R.S. 51:3074, d=322030): anyone doing business in Louisiana that holds computerized personal information "shall implement and maintain reasonable security procedures and practices appropriate to the nature of the information"; must destroy records it no longer needs (shred, erase, make unreadable); breach notice to affected residents "not later than sixty days from the discovery of the breach"; delays must be explained to the Attorney General in writing within the 60 days; a no-harm finding must be documented and kept 5 years.
- NOT VERIFIED in full (legis.la.gov search excerpt of R.S. 51:3073): "personal information" = name + SSN, driver's license/state ID number, financial account/card number with access code, passport number, or biometric data. -> Collecting SSNs or ID scans for rentals puts us squarely in the breach law; recommendation is never to collect SSN (the screening partner collects it in its own flow).

Payments (Stripe) and app stores
- VERIFIED (stripe.com/legal/restricted-businesses): no listing for rent, rentals, property management, leases, deposits or tenant screening; "Escrow services" and "Money transmitters" are RESTRICTED; "Timeshare services" and "Peer-to-peer money transmission" are PROHIBITED.
- VERIFIED (docs.stripe.com/connect/manual-payouts, account-balances via Stripe docs search): "Escrow has a precise legal definition, and Stripe doesn't provide escrow services or support escrow accounts"; Stripe advises against holding funds "arbitrarily"; US holding limit 2 years. -> Holding a security deposit on the platform for a 12-month lease is technically possible but is exactly the "escrow" posture Stripe warns about; deposits should go straight to the landlord's connected account (or stay outside the app).
- VERIFIED (stripe.com/pricing): US cards "2.9% + 30¢"; ACH Direct Debit "0.8%" with a "$5.00 cap". On $1,200 rent: card ~$35.10, ACH $5.00 (owner rule: we never absorb a fee).
- VERIFIED (Apple App Review Guidelines 3.1.3(e)): physical goods or services "consumed outside of the app" must use non-IAP payment (rent, deposits and Helpr repairs qualify). 5.1.1(ix): apps in highly regulated fields or that "require sensitive user information should be submitted by a legal entity" (we are an LLC). 5.1.1(iii) data minimization; 5.1.2(i) explicit permission before sharing personal data with third parties (a screening partner counts).
- NOT VERIFIED: whether Apple treats an in-app paid screening REPORT as digital content needing IAP (the existing Helpr background-check purchase uses Stripe; precedent untested in review because it is switched off).
- VERIFIED (Google Play Payments policy, answer 9858738): Play billing "must not be used" for physical goods/rentals of physical goods, "physical services", or utility/credit-card bill remittances; rent is not named.

Licensed trades for maintenance jobs
- NOT VERIFIED (lslbc.louisiana.gov via search excerpt): home-improvement registration needed for residential work over $7,500 up to $75,000; residential license above $75,000. Plumbing (State Plumbing Board), electrical, HVAC/mechanical, gas, mold-remediation licensing thresholds NOT verified; sources disagree. Lawyer/owner check before letting landlords post those categories open to anyone.

## Lawyer questions (not for the owner to decide)
Send to one Louisiana lawyer who does real estate + landlord–tenant + consumer law, as one engagement:
- L1. Does a platform that lists rentals, takes applications and generates leases need an LREC broker license (R.S. 37:1431(24)(c),(f))? Free vs paid listings; fee from renters (application fee pass-through) vs landlords; does a % of rent or a lease fee change the answer? Request an LREC written opinion.
- L2. Write the Louisiana residential lease template + addenda (lead paint, pets/assistance animals, smoking, utilities, renters insurance, early termination incl. military and domestic-violence statutes, entry/repair procedure, electronic-records consent). Are we the "agent" under 40 CFR 745.103?
- L3. Screening: confirm the partner model keeps us outside "consumer reporting agency"/"reseller"; review partner contract; adverse-action notice text; criminal-history guidance; 7-year rules.
- L4. Fair-housing review of every listing field, filter, sort, the AI wording checker, the application form, and the denial-reason list; parish/city protected classes (New Orleans Chapter 86, source of income) where we launch.
- L5. Rent/deposit collection: money-transmission (Louisiana R.S. 6:1031 et seq., not read) given Stripe Connect; whether we may hold deposits; surcharging the card fee to renters.
- L6. App copy about repairs (arts. 2691-2694, repair-and-deduct) so it informs without being legal advice; landlord-review / renter-review defamation and retaliation exposure.
- L7. Record retention vs account deletion (leases, lead forms 3 years, FCRA disposal, 9:3251 deposit records).
- L8. Terms of Service + Privacy Policy sections for Rentals.

## Owner actions before launch (not app work)
- Hire the lawyer above (round 15 asks when).
- Call/write LREC ((225) 925-1923) with L1 before any rental fee is switched on.
- Pick a screening partner only if round 6 says yes (TransUnion SmartMove / Checkr / other) and sign its housing terms.
- App Store: describe Rentals in Review Notes + What's New and switch it on for the Apple reviewer account in any build that contains it (same as Declutter row 51; guideline 2.3.1(a)).

## Owner questions (16 rounds of 4 = 64 questions)
Plain words. Option (a) is the recommendation, with a one-line why. [LAWYER] = the owner picks the
product direction but a lawyer must sign off before it ships; [LAWYER ONLY] = not an owner choice.

### Round 1 — What it is and where it lives
1. Where should rentals live? (a) Its own tab inside Louisiana Helpr, like Declutter — one app, one account, one ID check. (b) Inside the Jobs tab. (c) A separate app.
2. What do we call the tab? (a) "Rentals" — plain, renters and landlords both get it. (b) "Homes". (c) "Housing". (d) "Landlord".
3. What can be listed? (a) Whole homes and apartments for leases of a month or longer — the core, and short stays bring hotel-tax and city STR rules. (b) Also rooms inside a shared home. (c) Also short-term/vacation stays. (d) Also offices/shops.
4. What area at launch? (a) All of Louisiana, nearest first (same as Declutter). (b) One parish first. (c) A few cities first.

### Round 2 — Who can list
5. Who may post a rental? (a) Only the owner of the property (or the owner's company), ID-verified — owners are exempt from real-estate licensing (R.S. 37:1438). (b) Owners and licensed property managers who show their license number. (c) Anyone ID-verified.
6. How do we check they really own it? (a) Upload a deed, tax bill or parish assessor page; an admin matches the name before the first listing goes live — stops the "fake landlord takes your deposit" scam. (b) The owner just ticks "I own this". (c) No check.
7. Property managers listing for other owners? (a) Not at launch — LREC says managing for multiple owners needs a broker license; avoid until the lawyer answers. (b) Allowed with license number shown. (c) Allowed. [LAWYER]
8. What does a renter see about the landlord? (a) First name, "ID verified" and "owner verified" badges, star rating — enough trust, little exposure. (b) Full name and company. (c) Nothing until they apply.

### Round 3 — The listing
9. How is a listing written? (a) Fixed fields (rent, beds, baths, size, pets, parking, utilities, available date, lease length) plus a short description that an AI checks for unfair-housing wording before posting — the law covers every ad and we must not invite bad wording. (b) Mostly free text. (c) Fixed fields only, no description.
10. What can renters filter by? (a) Price, beds, baths, pets, area, available date, lease length, accepts vouchers — never anything about who may live there (kids, religion, etc.). (b) Same plus "seniors only" style tags. (c) No filters.
11. Photos per listing? (a) At least 5, up to 25, real photos only (same check as Declutter). (b) At least 1. (c) No minimum.
12. When does a renter see the exact address? (a) Street name + area before; exact address after the landlord books a tour or approves an application — keeps landlords and empty homes safe. (b) Exact address public (like Zillow). (c) Only after the lease is signed.

### Round 4 — Money basics
13. Do landlords pay us for rentals? (a) Free at launch; money is made on the repair jobs — avoids the real-estate "for a fee" problem until the lawyer answers. (b) Monthly fee per listing. (c) A one-time fee when a lease is signed. (d) A % of rent. [LAWYER]
14. Do renters pay rent through the app? (a) Not at launch; add later — rent collection pulls in money-transmission questions and big monthly sums. (b) Yes, bank transfer (ACH) only. (c) Yes, bank or card.
15. Security deposit? (a) Not through the app at launch; the lease records the amount and the app reminds the landlord of the one-month return rule — Stripe does not do escrow and holding deposits for a year is the risky part. (b) Paid in the app straight to the landlord's payout account. (c) Paid in the app and held by us until move-out.
16. If money is paid in the app later, who pays the card fee? (a) The renter, with bank transfer offered first (capped at $5) — owner rule: we never absorb a fee. (b) The landlord. (c) Split.

### Round 5 — Applying
17. Application fee? (a) The landlord may charge one, only up to the real screening cost, and the app shows the notice Louisiana requires before any fee (R.S. 9:3258.1) — lawful and stops fee farming. (b) No application fees ever. (c) Landlord sets any amount.
18. What does the application ask? (a) One fixed form: move-in date, who will live there (number of adults/children only, no ages or relationships asked of the landlord's choosing), income, job, current and past addresses, pets, vehicles, references — same form for everyone is the fair-housing safe path. (b) Fixed form + landlord's own extra questions. (c) Landlord writes the whole form.
19. Proof of income? (a) Upload pay stubs or attach your Louisiana Helpr Work Record; stored privately, deleted 90 days after the landlord decides — less sensitive data kept. (b) Upload, kept until the account is deleted. (c) No uploads; renter types income only.
20. How does the landlord choose? (a) Landlord picks any complete application; the app records the order they arrived and the reason for each "no" — a record protects both sides in a complaint. (b) First complete application wins automatically. (c) No rules.

### Round 6 — Credit and background checks
21. Offer credit/eviction/criminal checks? (a) Not at launch — add later through a partner. (b) Yes at launch through a partner: the renter pays and orders inside the partner's screen, the report goes straight to the landlord, we never see or store it. (c) We run the checks ourselves. [LAWYER]
22. If yes, which partner? (a) TransUnion SmartMove (renter-pays, report to landlord, built for small landlords). (b) Checkr (we already use it for Helpr checks, but it is not set up for housing). (c) Decide later. [LAWYER]
23. Criminal records? (a) The app tells landlords: no blanket "no felonies", arrests don't count, look at what, when, and since; landlord must give a reason for a "no" — follows the FHA warnings. (b) Leave it fully to the landlord. (c) Landlords can't use criminal records at all in the app. [LAWYER]
24. When a landlord says "no" (or asks for a co-signer/bigger deposit) after a report? (a) Landlord picks the reason; if a report was used the app sends the federal adverse-action notice automatically — landlords forget it and it's the law. (b) Landlord sends their own notice. [LAWYER]

### Round 7 — Tours and saying yes
25. Tours? (a) Booked in the app from times the landlord sets (like Declutter pickup times), reminders to both. (b) Arranged by messages only. (c) No tours in the app.
26. Self-tours with lockboxes/codes? (a) No — the classic rental scam. (b) Yes for owner-verified landlords.
27. After approval? (a) The renter has 48 hours to accept; then the lease is drafted for both to sign; miss it and the landlord may pick the next — keeps homes from sitting. (b) 24 hours. (c) No time limit.
28. Holding deposit to reserve the home? (a) None at launch. (b) Allowed, paid to the landlord, credited to the first rent.

### Round 8 — The lease
29. Which lease? (a) One Louisiana lease written by our lawyer; the landlord fills the blanks and can add listed addenda — consistent, legal, no bad clauses. (b) Landlord uploads their own PDF to sign. (c) Both. [LAWYER]
30. Required forms added automatically? (a) Yes: ask "year built" and attach the lead-paint form for anything before 1978, the pet/assistance-animal addendum, and the move-in condition checklist with photos. (b) Landlord adds forms themselves.
31. How do people sign? (a) Built-in signature with a record of who, when and which device, both already ID-verified, final PDF to both — no extra vendor cost. (b) DocuSign/Dropbox Sign inside the app (per-envelope cost). [LAWYER]
32. Several adults living there? (a) Every adult (18+) on the lease signs and needs an account. (b) Only one signs. (c) Co-signer/guarantor allowed as an extra signer.

### Round 9 — After the lease is signed
33. Late-rent, eviction or "fix it or leave" notices? (a) The app never sends them; it tells the landlord these must go on paper — Louisiana and federal e-sign law exclude eviction/default notices for a home. (b) The app sends them anyway (not allowed).
34. Lease ending? (a) Reminders to both 60 and 30 days before the end; renewal signed in the app. (b) No reminders.
35. Deposit return? (a) The app reminds the landlord of the one-month return + itemized statement rule and lets the landlord send the statement in the app; we don't judge disputes. (b) The app decides deposit disputes. (c) Nothing.
36. Keep leases after someone deletes their account? (a) Yes: the signed lease PDF and lead form are kept 3 years (federal rule for lead forms) and the other party keeps their copy; everything else is deleted. (b) Delete everything. [LAWYER]

### Round 10 — Maintenance requests: who and what
37. Who can send a maintenance request? (a) Tenants with a lease in the app AND tenants the landlord invites with a link for a unit (leases signed elsewhere) — lets maintenance launch first, before applications and leases. (b) Only tenants with a lease signed in the app. (c) Anyone who says they rent.
38. What does a request include? (a) What's wrong (category), description, photos or video, how urgent (emergency / soon / whenever), when someone may come in, pets on site, OK to enter without me yes/no. (b) Description + photos only.
39. What happens when the landlord approves? (a) The app drafts a normal Helpr job from the request; the landlord checks price and posts it with their card — same as Host automation, the landlord stays in control of money. (b) It posts automatically and charges the landlord's saved card up to a limit they set. (c) Landlord hires their own person; the app just tracks it.
40. Emergencies (gas smell, flooding, sparks, no heat in a freeze, sewage)? (a) The app first shows "call 911 / your utility now", then alerts the landlord by push + email; it never sends a Helpr without the landlord. (b) Auto-post an emergency job if the landlord doesn't answer in 2 hours (who pays?). (c) No emergency category.

### Round 11 — Maintenance jobs: entry, finishing, trades
41. Getting in? (a) The tenant OKs the visit time the Helpr offers (or ticks "OK to enter without me"); the gate/lock info goes in the existing private access notes only the booked Helpr sees. (b) The landlord decides alone. (c) The tenant must always be home.
42. Who says the work is done? (a) The Helpr's before/after photos, the tenant gets a "Was it fixed?" tap, the landlord confirms and pays — the tenant's answer is shown to the landlord, the payer decides. (b) The tenant confirms and that releases payment. (c) The landlord alone.
43. Plumbing, electrical, HVAC, gas, roof, mold? (a) Those categories default to "Licensed" Helprs only (existing gate) and jobs over $7,500 are refused until we check contractor rules. (b) Open to anyone; landlord chooses. (c) Not allowed through the app. [LAWYER]
44. Damage the tenant caused? (a) Landlord still pays the Helpr; landlord settles with the tenant outside the app (or from the deposit later). (b) The landlord can bill the tenant in the app. (c) The tenant pays the Helpr directly.

### Round 12 — Maintenance money and rules
45. Regular upkeep (lawn, pest, filters, gutters)? (a) Yes, using the existing recurring jobs. (b) Not at launch.
46. Landlord says no to a request? (a) Must pick a reason the tenant sees ("I'll handle it myself", "not my responsibility under the lease", "already scheduled", other) and the request stays on record with dates. (b) Can ignore it. [LAWYER] for any copy about tenant repair rights.
47. Fees on maintenance jobs? (a) Exactly like any job: same Helpr commission, the landlord pays job price + card fee. (b) A landlord discount. (c) A landlord surcharge.
48. Auto-approve small repairs? (a) Landlord may set "auto-approve up to $X" per property, default OFF. (b) Never. (c) Always under $100.

### Round 13 — Messages, privacy, safety
49. Phone numbers and emails in rental messages? (a) Blocked by the contact filter until the application is approved, then allowed — protects renters from scammers early, lets real landlords and tenants talk. (b) Always blocked (like jobs). (c) Never blocked.
50. Scam protection? (a) No money may change hands before a tour or approval; warnings on "wire", "gift card", "I'm out of the country", "pay to hold"; owner-verified badge; report button. (b) Report button only.
51. Social Security numbers and ID scans? (a) The app never asks for an SSN; ID is the existing Stripe check; a screening partner collects SSN in its own screen — less data to lose under the breach law. (b) Collect SSN in the app.
52. Reviews? (a) Tenants can rate a landlord after 60 days of living there and at move-out; landlords cannot rate tenants publicly — public tenant ratings act like a blacklist. (b) Both ways at lease end. (c) No rental reviews. [LAWYER]

### Round 14 — Admin, disputes, strikes, rollout
53. Admin review? (a) A new landlord's ownership proof and first listing wait for an admin OK; later listings go live unless the AI flags wording. (b) Every listing waits. (c) No admin review.
54. Landlord–tenant disputes (deposits, repairs, rent)? (a) The app does not decide them; it keeps the record and points to legal aid; only Helpr-job disputes use our dispute system. (b) We mediate. (c) We decide and move money.
55. Strikes? (a) A fake listing or asking for money off-app = removed from Rentals for good; no-show at a booked tour = 1 strike, 3 strikes block Rentals for a year (Declutter style); jobs untouched. (b) Use the job strike count. (c) No strikes.
56. Rollout? (a) Hidden switch: test accounts -> owner -> a few real landlords you pick -> all of Louisiana; described to Apple in every build that has it. (b) Straight to everyone.

### Round 15 — Legal path and age
57. Lawyer timing? (a) Hire before any rentals build except maintenance requests (maintenance is ordinary jobs). (b) Before launch, after the build. (c) No lawyer.
58. Ask the Real Estate Commission in writing first? (a) Yes, before any rental fee is switched on. (b) Only if we charge. (c) No.
59. Under 18? (a) Can't list, apply, sign or request maintenance as the leaseholder (greyed out + server refuses), same as jobs — minors can't sign leases. (b) Can browse only. (c) Same as (b) plus may be a listed occupant (no account needed).
60. Deleting an account during a live lease or open maintenance job? (a) Refuse deletion while a maintenance job is in progress (existing rule); allow it during a lease but keep the lease copy (round 9 Q36). (b) Refuse deletion during any lease. (c) Always allow.

### Round 16 — Fair-housing details in the listing
61. Housing vouchers (Section 8)? (a) A listing field "Accepts housing vouchers: Yes / Ask me"; no "No vouchers" option — some cities protect source of income. (b) Yes / No field. (c) Not mentioned. [LAWYER]
62. "No pets" listings? (a) The app automatically adds "Assistance animals are not pets and are welcome" and blocks pet fees for them — federal disability rule. (b) Landlord writes it.
63. Accessibility details? (a) Optional fields (step-free entry, ground floor, elevator, grab bars, wide doors). (b) Description only.
64. How long does a listing stay up? (a) 30 days, one-tap renew, auto-hidden when a lease is signed in the app. (b) Until removed. (c) 14 days.

## Proposed build slices (hidden switch 'rentals', smallest risk first)
Every slice: switch OFF by default, testers only, export_my_data sections + deletion purge in the SAME slice
(Declutter B9 lesson), money/authz review trailers, 375/1440 screenshots.
- S1. Maintenance requests for invited tenants (no applications, no leases, no rent). Landlord adds a property + units (ownership proof, admin OK), invites a tenant by link; tenant files a request (photos, urgency, access); landlord approves -> a DRAFT job prefilled from the request (Host-automation pattern, landlord posts and pays through the existing create-payment flow); tenant gets "Was it fixed?" + timestamped record (art. 2688 notice). Reuses jobs, payments, recurring, access notes, credential tiers, notifications, disputes. Lowest legal risk: it is the existing jobs marketplace with a new "who asked" link. Needs: properties, units, unit_tenants (invite), maintenance_requests, request photos; job gets `maintenance_request_id`. Questions needed first: rounds 10-12, 13 Q49-50, 14 Q53-56, 15 Q59-60.
- S2. Landlord dashboard: per-unit maintenance history (reuse HomeHistory PDF), recurring upkeep, auto-approve limit (Q48).
- S3. Listings + browse (no applying yet): fixed-field listings, AI fair-housing wording check (fail closed, admin queue), photo rules, filters with no protected-trait fields, coarse location (Declutter B7 pattern), 30-day expiry, scam warnings. Requires L1 + L4 answered and Q13 decided (free).
- S4. Tours: landlord time slots, booking, reminders, no-show strikes.
- S5. Applications: one fixed form, private income uploads with 90-day auto-delete, 9:3258.1 fee notice (if fees allowed), decision with reasons + order-received log, 48 h accept window. Requires L3/L4.
- S6. Leases: lawyer template + addenda, lead-paint auto-attach (year built), multi-signer e-signature with audit trail, PDF to both, retention rule (Q36), renewal reminders, deposit-return reminder; NO default/eviction notices. Requires L2, L7.
- S7 (optional, later). Screening via partner (renter-ordered, partner-delivered, never stored) + automatic adverse-action notice. Requires L3 + partner contract.
- S8 (optional, later). Rent/deposit payments by ACH to the landlord's connected account. Requires L5 and Q14-16.

## Owner answers (pop-ups 2026-10-14)
| Q | Decision |
|---|----------|
| 1-2 | Rentals lives inside Louisiana Helpr (under More in the bottom bar, roadmap G2), tab named "Rentals" |
| 3 | Whole homes and apartments, leases of 1 month or longer (no rooms, no short stays) |
| 4 | All of Louisiana, nearest first |
| 5 | Property owners only (or the owner's own company), ID-verified |
| 6 | Ownership proof (deed, tax bill or parish assessor page) checked by an admin before the first listing goes live |
| 7 | Property managers: not at launch (follows from Q5) |
| 8 | Renters see the landlord's first name + "ID verified" / "Owner verified" badges + star rating |
| 9 | Set fields + a description checked for unfair-housing wording; the AI can also WRITE the description and make suggestions (owner: "option for ai to do this and make suggestion") |
| 10 | Filters on home facts only (price, beds, baths, pets, area, available date, lease length, accepts vouchers); never who may live there |
| 11 | 5 to 25 real photos |
| 12 | Exact address: street name + area before; exact address once a tour is booked or an application approved |
| 13 | Landlords pay nothing for rentals at launch; money comes from maintenance repair jobs (avoids the real-estate "for a fee" license question until the lawyer/LREC answer in writing) |
| 14 | No rent payments through the app at launch |
| 15 | Security deposits NOT through the app; the lease records the amount; the app reminds the landlord of the one-month return + itemized statement rule |
| 16 | (moot at launch — no money in the app for rentals) |
| 17 | NO application fees |
| 18 | One standard application form for everyone (move-in date, number of adults/children only, income, job, current + past addresses, pets, vehicles, references) |
| 19 | Proof of income: upload pay stubs or attach the Louisiana Helpr Work Record; stored privately; deleted 90 days after the landlord decides |
| 20 | Landlord picks any complete application; app records arrival order and a reason for every "no" |
| 21 | No credit/eviction/background checks at launch (later via a renter-orders partner, report straight to the landlord) |
| 25-26 | Tours booked in the app from landlord-set times, in person, reminders to both; NO self-tours/lockbox codes |
| 29 | Lease: the landlord either fills our lawyer-written Louisiana template OR uploads their own lease PDF; sent and signed in the app (owner: "add applications when the house is for rent, then send leases also") |
| 29b | Saving: "Download PDF" opens the phone's Save/Share sheet (Files, Google Drive, iCloud, email); both sides get a copy; it also stays in the app (owner: "landlords can save them on their drive") |
| 27 | Renter has 48 h to accept an approval; then the lease is sent; no answer = landlord may pick the next applicant |
| 28 | (holding deposit: none — no money in the app at launch, Q15) |
| 30 | Required forms attached automatically: year built -> federal lead-paint form for pre-1978, pet/assistance-animal addendum, move-in condition checklist with photos |
| 31 | Built-in signature (who/when/device record, both ID-checked, final PDF to both) — lawyer to confirm |
| 32 | Every adult (18+) living there signs and has an account; co-signers as extra signers |
| 33 | Friendly rent-due REMINDERS in the app only; formal late/eviction/default notices must go on paper (app tells the landlord) |
| 34 | Lease-end reminders 60 and 30 days before; renewal signed in the app |
| 35 | Deposit return: app reminds the one-month rule; landlord sends the itemized statement in the app with move-out vs move-in photos; we don't judge deposit disputes |
| 36 | Account deletion: signed lease + lead-paint form kept 3 years, the other side keeps their copy, everything else deleted — lawyer to confirm |
| 37 | Who can request maintenance: tenants with an app lease AND tenants a landlord invites by link (leases signed elsewhere) — lets maintenance launch first |
| 38 | Full request details: category, description, photos/video, urgency (emergency/soon/whenever), when someone may come in, pets on site, "OK to enter without me" |
| 39 | Approval drafts a normal Helpr job; the landlord checks the price and posts it with their card |
| 40 | Emergencies: app first shows "call 911 / your utility now", then alerts the landlord by push + email; never sends a Helpr without the landlord |
| 41 | Entry: the tenant OKs the visit time the Helpr offers (or "OK to enter without me"); lock/gate info in the existing private access notes |
| 42 | Done: Helpr before/after photos + tenant's "Was it fixed?" answer shown to the landlord, who confirms and pays |
| 43 | Licensed trades OPEN to anyone by default; the landlord may still choose "Licensed pros only" (roadmap T2); Claude researches Louisiana contractor-license thresholds and shows a warning (not a block) on jobs that may legally need a licensed contractor |
| 44 | Tenant-caused damage: the landlord pays the Helpr and settles with the tenant outside the app |
