import { MONTHLY_FREE_BOOSTS, TIER_PERKS, type SubscriptionTier } from "@/lib/subscriptionTiers";
import { identityCheckOn } from "@/lib/identityCheckSwitch";
import { earlyAccessHeadStartMinutes } from "@/lib/earlyAccess";
// The escrow clock is owned by the cron that actually moves the money, not by
// this file. Same import the legal pages, PaymentSuccess and the activity cards
// use; `escrowTiming.copyParity.test.ts` fails if this answer ever goes back to
// restating the numbers as literals.
import {
  APPROVAL_WINDOW_HOURS,
  STANDARD_PAYOUT_PHRASE,
} from "../../../../supabase/functions/_shared/escrowTiming";
// Cancellation percentages and the standard payout window are binding money
// figures with one owner each. Same rule as legal/CommunitySection: derive,
// never retype.
import { STANDARD_PAYOUT_WINDOW } from "@/lib/payoutTiming";
// Which categories actually render the "Who can apply?" credential control.
// Derived from the form's own set, in the picker's canonical order, so adding a
// category there updates this answer instead of leaving it quietly wrong — this
// sentence was hand-typed as "handyman, painting, moving, and assembly" and went
// stale the moment Storm Prep and Yard Work were added (2026-09-06).
import { CREDENTIAL_TIER_CATEGORIES } from "@/components/postjob/detailsSection/detailsSectionConstants";
import { JOB_CATEGORY_LABELS, JOB_CATEGORY_VALUES } from "@/lib/jobCategories";

// The early-access ladder, DERIVED — every tier that gets a head start, in
// ascending order, with the minute count from `earlyAccess.ts`.
//
// The membership FAQ used to hand-type "20-minute early job access (Pro gets
// 10, Basic 5)". That sentence had no Plus in it: the tier ships, is sold on
// this very page's fee answer, and gets 15 minutes — so the one place a reader
// goes to compare plans silently pretended a plan did not exist. It is the same
// class of drift `earlyAccess.ts` was extracted to end ("COPY MUST DERIVE FROM
// THIS, NEVER RETYPE IT"), and deriving from TIER_PERKS' own keys means a tier
// added later cannot go missing from this sentence either.
const EARLY_ACCESS_TIERS = (Object.keys(TIER_PERKS) as SubscriptionTier[])
  .filter((tier) => earlyAccessHeadStartMinutes(tier) > 0)
  .sort((a, b) => earlyAccessHeadStartMinutes(a) - earlyAccessHeadStartMinutes(b));

/** e.g. "Basic 5 minutes, Pro 10, Plus 15, Elite 20". */
const EARLY_ACCESS_LADDER = EARLY_ACCESS_TIERS
  .map((tier, i) =>
    `${TIER_PERKS[tier].name} ${earlyAccessHeadStartMinutes(tier)}${i === 0 ? " minutes" : ""}`)
  .join(", ");

/** "handyman, painting, moving, assembly, storm prep, and yard work" — built. */
const CREDENTIAL_CATEGORY_PHRASE = (() => {
  const names = JOB_CATEGORY_VALUES
    .filter((value) => CREDENTIAL_TIER_CATEGORIES.has(value))
    // AUD31-58: an acronym keeps its capitals ("HVAC", not "hvac").
    .map((value) => (/^[A-Z0-9]+$/.test(JOB_CATEGORY_LABELS[value]) ? JOB_CATEGORY_LABELS[value] : JOB_CATEGORY_LABELS[value].toLowerCase()));
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
})();

// Q1842 (roadmap F3, owner 2026-10-14/15): the jobs fee, read from the same
// constants every payout path prices with (src/lib/helprFlatFee.ts), so this
// page cannot drift from what a Helpr is paid. The poster pays the job price
// only; the Helpr pays 5% + 70c; a plan never changes it. (The tier ladder
// that used to be quoted here, FEE_FLOOR, applies only to jobs paid for
// before the change; the Terms read the same phrase since 2026-10-20.)
// What a Helpr is really sent on a $100 job: every transfer is floored to the
// whole dollar (roundPayoutDownCents, Q236), and the app's take-home figures
// floor the same way (floorPayoutDollars). lh-money-escrow review of
// 7166349cd #1: "$94.30" was the unrounded figure; the transfer is $94.

// Roadmap F4/F4a (owner 2026-10-14/15): memberships are switched off for
// members (feature_switches 'memberships' = testers, measured on prod
// 2026-10-17), and every paid perk is off with them: instant-payout refuses
// with "Instant cash-out isn't available right now", early access and plan
// boosts read the same switch, and SubscriptionTab's subscribe button says
// "Memberships aren't available right now." Every answer on this page that
// describes a plan or a paid perk opens with this sentence, so the page never
// promises a member something the app refuses. Exported for its guard
// (helpCenterPricingCopy.test.ts). When the owner turns memberships back on,
// remove it here and in the answers in the same change.
export const MEMBERSHIPS_PAUSED = "Memberships aren't available right now.";

// ─── Topic blurbs ─────────────────────────────────────────────────────────────
//
// WAS a `TOPICS` array of {icon, label, desc, color, bg} feeding a card grid at
// the top of /help. That grid was deleted (HelpCenter.tsx:41-50, 185-194) and
// only `.desc` survived as the per-section blurb — so `icon`, `color` and `bg`,
// plus the seven lucide imports and the `LucideIcon` type that existed only to
// type them, had ZERO consumers. Dead structure on a Help Center is its own
// small lie: it tells the next reader there is a card grid to maintain, and it
// invites "fixing" a colour nobody renders. The `label` keys must still be
// byte-identical to the FAQ_SECTIONS `topic` values below — see the lookup note
// on "Payments & how your money is held".
export const TOPICS: { label: string; desc: string }[] = [
  { label: "Getting Started", desc: "New to Helpr? Start here." },
  { label: "Posting a Job", desc: "Write a great post and get results." },
  { label: "Finding Work", desc: "Apply, get hired, and grow your income." },
  {
    // Must be byte-identical to the FAQ_SECTIONS `topic` below. The lookup is
    // `TOPICS.find(t => t.label.toLowerCase() === topic.toLowerCase())`, so
    // this said "Payments & How Funds Work" against a topic of "Payments &
    // Escrow" and silently resolved to undefined — the section rendered with
    // no description at all, with nothing to indicate a miss.
    label: "Payments & how your money is held",
    desc: "How money is held, released, and paid.",
  },
  { label: "Trust & Safety", desc: "Verification, disputes, and reporting." },
  { label: "Account & Settings", desc: "Email, password, deletion, bigger text." },
  // The seventh FAQ topic had no blurb entry, so it rendered bare next to
  // six that carry one.
  { label: "Membership & Billing", desc: "Plans, upgrades, and cancelling." },
];

// ─── FAQ data ─────────────────────────────────────────────────────────────────

interface FaqItem {
  q: string;
  a: string;
}

export interface FaqSection {
  topic: string;
  items: FaqItem[];
}

export const FAQ_SECTIONS: FaqSection[] = [
  {
    topic: "Getting Started",
    items: [
      {
        q: "Do I need an account to browse jobs?",
        // "You'll need an account" understated the gate by two steps and sent
        // people into a flow they could not finish. A new account must also
        // confirm its email (ProtectedRoute.tsx holds it on /signup-pending)
        // and verify their ID when posting (useJobSubmit.ts gates on it). Discovering
        // that after writing a job post is the worst moment to learn it. There is no
        // approval from our team any more (Q193: every signup is
        // auto-approved), so the answer no longer promises one.
        // AUD31-57: the ID check is the `identity_check` switch (off since owner
        // 2026-10-23), so the answer reads it like the Terms do; HelpCenter
        // subscribes (useIdentityCheckOnStore) so the getter is re-read.
        // Owner 2026-10-30 (ID check details): once per person, when posting, when hired or at the first payout,
        // and on Declutter at listing, buying, a free claim or taking a delivery (B49, ported 10-31).
        get a() {
          return identityCheckOn()
            ? "No, you can browse without signing up. To post a job or apply for one you'll need an account with a confirmed email. We ask for your ID once: when you post a job, when you're hired, or before your first payout, and on Declutter when you list, buy, claim a free item or take a delivery."
            : "No, you can browse without signing up. To post a job or apply for one you'll need an account with a confirmed email.";
        },
      },
      {
        q: "Is Helpr available everywhere in Louisiana?",
        a: "We're growing across Louisiana's 64 parishes. If your area isn't busy yet, posting a job is the best way to attract local Helprs.",
      },
      {
        q: "Can I both post jobs and do them?",
        a: 'Yes — every account can do both. There\'s no separate "poster" or "Helpr" mode.',
      },
      {
        q: "Can I give things away on Declutter?",
        a: 'Yes. When you list an item, tick the box to give it away free on the price step. Neighbors tap "Ask for it", you pick who gets it, and they pick it up from your porch or at your door. Nothing is charged to either of you, and each person can ask for or hold up to 3 free items at a time.',
      },
    ],
  },
  {
    topic: "Posting a Job",
    items: [
      {
        q: "What should I write in my job description?",
        a: "The more specific, the better. Include the exact job, how long you expect it to take, any equipment needed, and whether parking is available.",
      },
      {
        q: "How is the price determined?",
        // WAS "a range from local market data for your category and parish".
        // There is no market data and no parish dimension: src/lib/pricingGuide.ts
        // is a hardcoded table of fixed min/max per category and getSmartPrice()
        // returns the midpoint rounded to $5. The word "parish" does not appear
        // in that file. Describing a static table as local market data is the
        // same defect class as a stat nothing computes.
        a: "You set the price. We suggest a typical range for the category, and you can take the suggested amount in one tap.",
      },
      {
        q: "Can I cancel after someone applies?",
        // WAS: "Yes, before accepting an applicant. Once you accept and payment
        // is held securely, a cancellation fee applies." FALSE — the fee is
        // gated on TIME TO THE JOB, not on acceptance.
        // `_shared/cancellationFee.ts:22-30`: no helper → 0%, 24+ hours out →
        // 0%, under 24h → LATE_CANCEL_PERCENT, under 2h →
        // VERY_LATE_CANCEL_PERCENT; enforced server-side in
        // `void-cancelled-payments/index.ts:258`. A poster cancelling an
        // accepted job two days out was told they owed a fee they do not owe,
        // which is the version of this error that costs the platform a job.
        a: `Yes. It's always free before you accept anyone. After you accept a Helpr it is still free 24 or more hours out. It isn't a strike either. Closer to the start, part of the job goes to the Helpr, because by then they have held the slot for you, and it counts as a strike; the cancel screen shows the exact amount before you confirm.`,
      },
    ],
  },
  {
    topic: "Finding Work",
    items: [
      {
        q: "How do I get my first application accepted?",
        a: "A complete profile (photo, bio, skills) helps people trust you faster. Respond fast — they notice quick turnaround.",
      },
      {
        q: "When do I get paid?",
        // WAS: "Same-day transfer to your bank if your payout account is set
        // up." Instant Payout is a PAID membership feature — enforced
        // server-side to Basic/Pro/Elite in
        // supabase/functions/instant-payout/index.ts (`entitled`, 403
        // `membership_required`) — and it charges a fee. A free Helpr reading
        // the old sentence expected same-day money that does not exist for
        // them, which is the worst possible thing to be wrong about on the
        // "When do I get paid?" question.
        // "standard payouts are always free" was false for the FIRST one:
        // `process-scheduled-payouts/index.ts:103-111` deducts a one-time
        // onboarding fee (`platform_settings.onboarding_fee_cents`) from a
        // helper's first payout. Deliberately unnumbered here — it is a live
        // DB setting, so any figure typed into this file would be a hardcode
        // that can silently go stale, which is the whole defect class this
        // file's guards exist to stop. "The standard schedule" is now named:
        // STANDARD_PAYOUT_WINDOW, the same constant InstantPayoutDialog and
        // PayoutHistory interpolate.
        a: `Payment is sent to your Helpr account ${STANDARD_PAYOUT_PHRASE}, once the person who posted it approves the work, then transfers to your bank ${STANDARD_PAYOUT_WINDOW}. A one-time account setup fee comes out of your first payout, unless you already paid it on a job you posted or on Declutter; every standard payout after that is free. Instant Payout (cashing out the same day) is a membership feature. ${MEMBERSHIPS_PAUSED} For now, every payout goes on the standard schedule.`,
      },
      {
        q: "What if the person who posted the job doesn't confirm completion?",
        // Owner 2026-10-23: nothing is released on a timer. Both numbers come
        // from `_shared/escrowTiming.ts` (APPROVAL_WINDOW_HOURS, then the payout
        // STANDARD_PAYOUT_PHRASE after the approval), never retyped.
        a: `Your payment stays held. If the person who posted the job hasn't approved it or asked for a change within ${APPROVAL_WINDOW_HOURS} hours of you marking the work done, Helpr support steps in to resolve it. Once it's approved, your payout is sent ${STANDARD_PAYOUT_PHRASE}.`,
      },
    ],
  },
  {
    // JOBS-28 (lead 10-31): no "Escrow" in member copy. Was "Payments & Escrow" /
    // "What is Helpr Escrow?"; the old #faq-payments-escrow anchor still opens this
    // topic (LEGACY_TOPIC_ANCHORS in HelpCenter.tsx).
    topic: "Payments & how your money is held",
    items: [
      {
        q: "How does Louisiana Helpr hold my payment?",
        // WAS: "When a poster accepts your application, their payment is held
        // securely…". FALSE, and about the single most important fact on the
        // page. Since card_hold_at_post (Q2399) a card is held or saved at posting and charged
        // at the Helpr's accept (src/lib/cardHoldCapture.ts); a bank payment or gift is paid at
        // posting (JOBS-15). Either way nobody starts work on an unfunded job.
        a: `A card is held or saved when the job is posted and charged when a Helpr accepts the offer; a bank payment or gift is paid when the job is posted. Louisiana Helpr holds that money (via Stripe) until the job is done, and you're paid ${STANDARD_PAYOUT_PHRASE}. Neither side can touch it mid-job.`,
      },
      {
        q: "What fees does Helpr charge?",
        // Q1842: WAS "you pay the job budget plus a service fee that only
        // covers card processing … the platform fee drops as your plan tier
        // rises" (12% Free down to 8% Elite). Since 2026-10-15 (F3) there is no
        // service fee and no tier ladder on a new job.
        // lh-money-escrow review of 7166349cd: "nothing on top" was false
        // (create-payment adds Louisiana sales tax on TAXABLE_CATEGORIES' labor,
        // and the one-time setup fee on a first funded job), the take-home was
        // unrounded, and the refund sentence left out the kept setup fee and
        // crew block fees (refundToPayerCents). The setup fee stays unnumbered:
        // it is a live DB setting (see "When do I get paid?").
        a: `When you post a job, you pay the job price (including any urgent bonus you add), plus Louisiana sales tax on the labor for taxable job types such as handyman, assembly and the trades. Your first paid job also carries a small one-time account setup fee, unless you already paid it on a job you did or on Declutter. When you do a job, every job shows exactly what you will take home before you apply. Job payouts are rounded down to the whole dollar (tips are paid in full). If a paid job is cancelled, the cancel screen shows exactly what you will get back before you confirm. If the mistake was ours, you get everything back.`,
      },
      {
        q: "What if there's a dispute?",
        // The 72-hour deadline was omitted entirely. `auto-resolve-disputes`
        // moves the money with NO human review once `dispute_deadline` passes
        // — which is precisely the fact someone opening a dispute needs to
        // know, and the old answer implied a person always looks at it.
        // WAS: "Open a dispute from the job detail screen." There is no
        // dispute control on the job detail screen — grep finds none in
        // JobDetailDialog or JobDetail. It lives on the Activity job card
        // (the poster's Dispute chip, gated by `shouldShowDisputeLink`; the old
        // `<DisputeLink>` component was deleted in Q904), and its
        // visibility rules were undisclosed: a poster must request a REVISION
        // first and let that window lapse (shouldShowDisputeLink). Sending
        // someone to the wrong screen to file a time-limited money claim is the
        // worst possible shape for this answer to be wrong in.
        // WAS: "It stays available for 7 days after completion." FALSE since
        // VN-28 (owner, 2026-09-14: "they can't report a job once it's done"):
        // a completed job has no dispute or Report a Problem control on either
        // card (shouldShowDisputeLink, ActiveJobSection `showReport`). The
        // Helpr's chip runs from On the way until the job is marked done.
        // WAS: "Once a job is done, there's no dispute option on the card —
        // contact Support instead." Owner, 2026-09-14: "if the job is done,
        // its done. period. too late to ask for help. no link". The server
        // refuses a dispute on a completed job too (job_already_completed,
        // 20260915025607), so the answer says done is final and sends no one
        // to Support about a finished job.
        a: "Open a dispute from the job's card — in My Jobs for a job you're doing, or My Posts for a job you posted — not the job detail screen. Report a Problem is available while the job is in progress: on a job you're doing, the button is there from On the way until the job is done, including during a revision. On a job you posted, request a revision first and give the person doing it their window to fix it; the dispute link appears once that window has run. Once a job is marked done, it's final and can't be disputed. While a dispute is open, our team reviews both sides and can release the payment to either party or split it. Disputes have a 72-hour window: if it isn't settled or escalated in that time, our team decides it, and the payment stays on hold until we do.",
      },
    ],
  },
  {
    topic: "Trust & Safety",
    items: [
      {
        q: "How are Helprs verified?",
        // WAS: "Every Helpr submits a government-issued ID. Licensed trade
        // work (electrical, plumbing) requires matching verified license."
        // Neither is enforced. ID verification is an OPTIONAL profile badge,
        // and the credential requirement is chosen per job BY THE POSTER,
        // defaulting to `credentialTier = 0` — open to anyone
        // (usePostJobForm.ts). This was the most load-bearing trust claim on
        // the page and it described a platform that does not exist. The
        // replacement describes the control the poster actually has, which is
        // the useful answer anyway.
        // WAS: "…open to anyone, ID-verified only, licensed, or licensed and
        // insured…". FALSE twice.
        //   (1) There is no "ID-verified only" option. CREDENTIAL_TIERS
        //       (detailsSection/detailsSectionConstants.ts:39-43) ships exactly
        //       three: Open / Licensed / Licensed + Insured. Tier 1 exists in
        //       get_user_credential_tier but is unreachable from the form, and
        //       the constant's own comment explains why it was dropped.
        //   (2) The selector renders for a SUBSET of categories; every other
        //       one has no picker and stays tier 0, so "when you post a job you
        //       choose" was untrue for most posts. The list is no longer typed
        //       here at all — `CREDENTIAL_CATEGORY_PHRASE` derives it from
        //       CREDENTIAL_TIER_CATEGORIES, because the hand-typed version
        //       ("handyman, painting, moving, and assembly") went stale the
        //       moment Storm Prep and Yard Work were added. Also corrected:
        //       identity verification is required to post or accept
        //       (useJobSubmit.ts gates on it), not the optional "can verify"
        //       the old sentence implied.
        // 2026-10-23: ID verification is off (switch `identity_check`, owner:
        //       "just remove the verify id entirely"), so the answer no longer
        //       says an ID check is required. Licenses and insurance are unchanged.
        a: `Helprs can upload trade licenses and insurance, and verified badges show on their profile. On trade jobs (${CREDENTIAL_CATEGORY_PHRASE}) you also choose who may apply: open to anyone, licensed pros only, or licensed and insured. Only Helprs who meet what you set can apply — it's enforced by the database, not just hidden in the app. Other categories are open to any Helpr.`,
      },
      {
        q: "What is the cancellation rate?",
        // WAS "…once they've completed 5+ jobs". The threshold is `jobs_total
        // >= 5`, and `jobs_total` is COUNT(*) over every job where the user is
        // customer OR helper, in ANY status
        // (20260901002325_…sql:221-231) — not completions, and not helper-side
        // only. A Helpr with four cancelled jobs and one open one is over the
        // line; a Helpr with four completions is not.
        a: "We show a Helpr's cancellation history on their profile once they've been part of 5 or more jobs, counting both sides and any outcome. Low cancellation is a strong trust signal.",
      },
      {
        q: "Can I report the other person on a job?",
        // Dropped "within 24 hours" — an SLA nothing in the product measures,
        // tracks or guarantees. Promising a review window we don't instrument
        // is a trust claim we can only ever break.
        a: 'Yes — the "Report" option is in every job detail and profile. We review every report.',
      },
    ],
  },
  {
    topic: "Account & Settings",
    items: [
      {
        q: "How do I change my email or password?",
        // AUD31-58: the app's screens are You › Settings › Account and security (TAB_TITLES.security).
        a: "Go to You › Settings › Account and security.",
      },
      {
        q: "Can I delete my account?",
        // There is no "···" menu — the control is an outlined pill in the
        // Profile landing's settings section (SettingsSection.tsx).
        // Nor is there a "Settings" GROUP to scroll to: the landing's groups are
        // Work / Money / Account / Legal (useProfileLandingDerived.tsx), and the
        // pill sits below all of them, labelled "Delete Account"
        // (SettingsSection.tsx:148). The earlier fix corrected the "···" half of
        // this sentence and left the other half naming a screen region that does
        // not exist. Also added: `delete-own-account/index.ts:56-105` REFUSES
        // deletion while the account holds an active job or escrowed funds, so
        // "Yes." on its own was an answer some readers could not act on.
        a: "Yes. Go to You › Settings: \"Delete account\" is under Your account. We ask for your password, or a code we email you, to confirm it's you. Finish or cancel any active job first: we can't delete an account while money is still being held. We retain transaction records per Louisiana law but remove all personal data.",
      },
      {
        q: "How do I make the text and buttons bigger?",
        // There is no Settings TAB. Senior Mode lives on the Accessibility tab
        // (AccessibilityTab.tsx). A help answer that names a screen the app
        // does not have sends the reader looking for it.
        // AND: "enables a trusted family member to monitor jobs on your behalf"
        // described a feature that was DELETED —
        // 20260829083842_drop_family_care.sql ("Permanently remove the Family &
        // Care feature") dropped `care_relationships`. Grepping src/ for
        // caregiver / trusted contact / guardian / family member hit this FAQ
        // answer and nothing else: the only place the feature still existed was
        // the page telling people they had it. What Senior Mode actually does is
        // enlarge type and tap targets (index.css:2683-2694, 2747-2749) — it
        // enlarges, it does not remove or simplify anything, so "simplifies" is
        // corrected too.
        // AUD31-58: the switch is "Bigger text and buttons" in You › Settings (SettingsTab), not "Senior Mode".
        a: "Turn on Bigger text and buttons in You › Settings. It makes the app easier to read and tap: larger type and bigger touch targets throughout.",
      },
    ],
  },
  {
    topic: "Membership & Billing",
    items: [
      {
        q: "What does a membership do?",
        // Q1842: WAS "It lowers the commission Helpr deducts … from 12% down
        // to as low as 8%". Since F3 a plan never changes a job's fee.
        // Memberships are off for members (F4/F4a): say so first, in plain words.
        a: `${MEMBERSHIPS_PAUSED} When they come back, a plan adds visibility perks like priority placement and a featured badge. It does not change what you take home.`,
      },
      {
        q: "How am I billed for a membership?",
        // WAS "…from Manage membership." No control is called that: grep finds
        // the string only in this answer. The tab is "Membership"
        // (profile/types.ts:35) and the button on it is "Manage"
        // (SubscriptionTab.tsx:664), which opens the Stripe billing portal. A
        // navigation instruction has to name what is actually on screen.
        // Measured 2026-10-25 (prod, read-only): no profile holds a paid tier
        // (294 profiles, subscription_tier all null). Explaining how a
        // membership is billed read as if one could be bought, beside the
        // Terms' "There are no paid memberships right now." Say what is
        // charged today instead (Terms, Fees).
        a: `${MEMBERSHIPS_PAUSED} There are no paid memberships right now, so nothing is billed for one. What you can be charged today: the price of a job you post (plus sales tax where it applies) and the one-time account setup fee, both shown before you pay.`,
      },
      {
        q: "Can I cancel my membership anytime?",
        // WAS "Your paid perks stay active through the end of your billing
        // period": while memberships are off no paid perk is active (F4a).
        a: `${MEMBERSHIPS_PAUSED} No one has a paid membership right now, so there is nothing to cancel. When memberships come back, you will be able to cancel at any time.`,
      },
      {
        q: `What's the difference between ${TIER_PERKS.pro.name} and ${TIER_PERKS.elite.name}?`,
        a: `${MEMBERSHIPS_PAUSED} When they come back: ${TIER_PERKS.elite.name} adds the gold crown badge (visible to everyone browsing for someone to hire), unlimited free Job Boosts, the longest head start on new jobs, and priority support — on top of everything ${TIER_PERKS.pro.name} offers. Head start on a new job, measured against a free account: ${EARLY_ACCESS_LADDER}.`,
      },
      {
        // Plus was absent from this section entirely while the fees answer
        // above already listed it — a reader comparing plans on this page could
        // not learn that the tier exists, let alone what it does.
        q: `Where does ${TIER_PERKS.plus.name} fit in?`,
        a: `${MEMBERSHIPS_PAUSED} When they come back: ${TIER_PERKS.plus.name} sits between ${TIER_PERKS.pro.name} and ${TIER_PERKS.elite.name} at $${TIER_PERKS.plus.price}/month. It keeps everything ${TIER_PERKS.pro.name} gives you, moves your head start on new jobs to ${earlyAccessHeadStartMinutes("plus")} minutes, and adds the featured crown badge, priority support and ${MONTHLY_FREE_BOOSTS.plus} free Job Boosts every month (${TIER_PERKS.pro.name} includes ${MONTHLY_FREE_BOOSTS.pro}). ${TIER_PERKS.elite.name} keeps all of that and makes the badge gold and Job Boosts unlimited.`,
      },
    ],
  },
];

