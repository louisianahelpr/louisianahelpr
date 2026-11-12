import { identityCheckOn } from "@/lib/identityCheckSwitch";
// The escrow clock is owned by the cron that actually moves the money, not by
// this file. Same import the legal pages, PaymentSuccess and the activity cards
// use; `escrowTiming.copyParity.test.ts` fails if this answer ever goes back to
// restating the numbers as literals.
import {
  APPROVAL_WINDOW_HOURS,
  STANDARD_PAYOUT_DAYS_AFTER_APPROVAL,
  STANDARD_PAYOUT_PHRASE,
} from "../../../../supabase/functions/_shared/escrowTiming";
// Cancellation percentages and the standard payout window are binding money
// figures with one owner each. Same rule as legal/CommunitySection: derive,
// never retype.
import { STANDARD_PAYOUT_WINDOW } from "@/lib/payoutTiming";
// F089/F105 (owner 2026-11-09): what a cancelled or expired job gives back, shared with Receipts.
import { NO_HIRE_REFUND } from "@/lib/refundWords";
// Which categories actually render the "Who can apply?" credential control.
// Derived from the form's own set, in the picker's canonical order, so adding a
// category there updates this answer instead of leaving it quietly wrong — this
// sentence was hand-typed as "handyman, painting, moving, and assembly" and went
// stale the moment Storm Prep and Yard Work were added (2026-09-06).
import { CREDENTIAL_TIER_CATEGORIES } from "@/components/postjob/detailsSection/detailsSectionConstants";
import { JOB_CATEGORY_LABELS, JOB_CATEGORY_VALUES } from "@/lib/jobCategories";
// F236/F258 (audit 11-10): the Declutter buyer's fee, from the numbers checkoutAmounts charges (never retyped).
import { DECLUTTER_BUYER_FEE_WORDS } from "@/lib/declutter/money";
// F411 (audit 11-10): the "Common problems" steps name the controls by the labels the job card renders.
import { NOT_RIGHT_LABEL, RELEASE_ACTION } from "@/lib/releaseCopy";


/**
 * F036 (owner UI audit 2026-11-09): the ONE finality rule every Help answer states. A job becomes
 * `completed` only when the poster approves it (rpc_helper_mark_done stamps helper_completed_at and
 * leaves the status live; completed is set on release), and open_dispute_as refuses a completed job
 * (job_already_completed). "Once a job is marked done, it's final" contradicted the 24-hour approval
 * window, because the Helpr marking it done is not the end. Guard: src/test/helpDisputeRuleOneVoice.test.ts.
 */
export const DONE_IS_FINAL = "Once the person who posted the job approves it, it's final and can't be disputed.";

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


/**
 * F236/F258 (audit 11-10, lead confirmed live: Help showed no fee amounts). Every answer that names the one-time setup
 * fee says SETUP_FEE_PHRASE; HelpCenter swaps in the amount read live from platform_settings (useOnboardingFeeCents, the
 * number pay-onboarding-fee charges) through withSetupFeeAmount. Never a literal: the setting is admin-editable.
 */
export const SETUP_FEE_PHRASE = "a one-time account setup fee";

/** One answer (or step) with SETUP_FEE_PHRASE swapped for the live amount; unchanged while the amount is unknown. */
export function fillSetupFeeAmount(text: string, feeLabel: string | null): string {
  if (!feeLabel || !text.includes(SETUP_FEE_PHRASE)) return text;
  return text.split(SETUP_FEE_PHRASE).join(`a one-time ${feeLabel} account setup fee`);
}

/** "a one-time $2 account setup fee" once the amount is known; the plain phrase while it loads or on a failed read. */
export function withSetupFeeAmount<T extends { topic: string; items: { q: string; a: string }[] }>(sections: T[], feeLabel: string | null): T[] {
  if (!feeLabel) return sections;
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => (item.a.includes(SETUP_FEE_PHRASE) ? { ...item, a: fillSetupFeeAmount(item.a, feeLabel) } : item)),
  }));
}

// ─── Common problems (F411) ───────────────────────────────────────────────────
//
// F411 (audit 11-10, High): someone with a problem in hand had to guess which of seven topics held the answer.
// The top of /help now shows four cards for the problems people actually arrive with; each opens three steps.
// Every step names a real control by the label the card renders (Cancel job, Report no-show, NOT_RIGHT_LABEL,
// RELEASE_ACTION) and states only rules the code enforces: cancellationFee.ts (free 24+ hours out, part to the
// Helpr inside 24 hours), ActivityDialogs.tsx (Report no-show), escrowTiming.ts (APPROVAL_WINDOW_HOURS, the
// 72-hour dispute deadline) and the fee answer above (what a charge is made of).
export interface CommonProblem {
  /** Stable slug: the card's id and the step panel's anchor. */
  id: string;
  /** The card's words, the finding's exact wording. */
  title: string;
  /** Exactly three steps, in order. */
  steps: readonly [string, string, string];
}

export const COMMON_PROBLEMS: readonly CommonProblem[] = [
  {
    id: "cancel-a-job",
    title: "Cancel a job",
    steps: [
      "Open the job under Jobs › Posted and tap Cancel job.",
      "Read what you get back before you confirm. With a Helpr hired, there is no charge to cancel up to 24 hours before the start; closer than that, the Helpr gets part of the price for holding the time, and it counts as a strike.",
      `Confirm. ${NO_HIRE_REFUND} Every refund shows under You › Money › Receipts.`,
    ],
  },
  {
    id: "helpr-did-not-show-up",
    title: "My Helpr did not show up",
    steps: [
      "From 30 minutes after the start time, open the job and tap Report no-show.",
      "The Helpr comes off your job and it goes on their record. Our team is told about every no-show.",
      "To hire someone else, change the date right away; otherwise the job is cancelled and refunded.",
    ],
  },
  {
    id: "dont-like-the-work",
    title: "I don't like the work",
    steps: [
      `Don't tap ${RELEASE_ACTION}. Under the job, tap ${NOT_RIGHT_LABEL} and describe what needs to be redone; you can add photos.`,
      `The Helpr gets time to fix it, and the money stays on hold. You have ${APPROVAL_WINDOW_HOURS} hours after the work is marked done to approve it or ask for a change.`,
      "If it still isn't right once that time has run out, open a dispute from the job's card. Our team reviews both sides and can release the payment to either party or split it; if the two of you don't settle it in the dispute window, our team decides it.",
    ],
  },
  {
    id: "charged-too-much",
    title: "I was charged too much",
    steps: [
      `Open You › Money › Receipts and find the charge. A job charge is the job price (plus any urgent bonus you added), Louisiana sales tax on the labor for taxable job types, and, on your first paid job, ${SETUP_FEE_PHRASE}.`,
      `On Declutter, the buyer pays the item price plus a buyer's fee of ${DECLUTTER_BUYER_FEE_WORDS}, once per checkout.`,
      "If the receipt doesn't match what you were told, contact support below with the receipt. If the mistake was ours, you get everything back.",
    ],
  },
];

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
  { label: "Declutter", desc: "Buying, selling, pickup, delivery and refunds." },
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
  // Audit 11-10 W5 F470: the card says it is where a job that went wrong is handled.
  { label: "Trust & Safety", desc: "Something went wrong with a job? Disputes, reporting, and ID checks." },
  { label: "Account & Settings", desc: "Email, password, deletion, bigger text." },
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
            ? "No, you can browse without signing up. To post a job or apply for one you'll need an account with a confirmed email. We ask for your ID once: when you post a job, when you're hired, or before your first payout, and on Declutter before your first payout as a seller, or when you buy, claim a free item or take a delivery."
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
    // F041 (owner UI audit 11-09): second, after Getting started (a main feature, shown on the home page).
    // AUD31-23 (Legal, help, rules): Help had no Declutter section. Every answer restates the Declutter terms
    // (src/pages/info/legal/TermsSection.tsx, "Declutter"), which are the rule set; change them together.
    topic: "Declutter",
    items: [
      {
        q: "How do I buy something on Declutter?",
        a: "Tap Buy now to pay the price, or send the seller a private offer of at least half of today's price. It isn't an auction: the item goes to the first buyer whose purchase or offer is accepted and who then pays. After you tap Buy now the item is held for you for 30 minutes while you check out; when your offer is accepted you have 24 hours. You see one total before you pay, delivery included. Missing the checkout on an accepted offer is a Declutter strike; a Buy now you don't pay for just goes back on sale.",
      },
      {
        q: "How do I sell?",
        a: `List your own used household things with 1 to 12 photos you took, a price from $1 to $1,000 and a private lowest price you'll accept. The listing goes live when you post it. Buyers see your area name, never your address. Price drops are off unless you turn them on; then an unsold item's price drops each evening by the step you pick (5% to 20%), stopping above your lowest price. You set up payouts with Stripe at your first paid sale, and you receive the whole item price: the buyer pays a buyer's fee of ${DECLUTTER_BUYER_FEE_WORDS} on top, once per checkout.`,
      },
      {
        q: "How do I get the item?",
        a: "Each listing says which of these it offers, with the same names as the Filters: Porch pickup (the seller leaves it out and posts a photo), Meet at a safe spot (a public place, no home address shared), Helpr delivery, or Seller delivers when the seller offers it. Shipping isn't offered. Every pickup or delivery happens within 7 days of paying, and for a pickup at the seller's place you get the exact address right after you pay. If no Helpr takes a delivery within 48 hours, what you paid for delivery comes back, and you pick it up at the seller's door or cancel the sale for a refund.",
      },
      {
        q: "What if something's wrong with my item?",
        a: "You have 24 hours after pickup to ask the seller for a refund: they can refund all of it, offer part, or decline, and then you can report a problem for us to decide. Either of you can report a problem until the sale is final, and the money stays held while we look at both sides. An item that isn't as described, or a seller who doesn't show, means everything back at the seller's cost. Once the sale is final the item is yours as is.",
      },
      {
        q: "Can I deliver Declutter items?",
        a: "Yes, if you're 18 or older, not banned, have fewer than 3 Declutter strikes and aren't the buyer or seller. You see your take-home pay before you take a delivery, pick the pickup time, take a photo at pickup and at the door. Large items need a truck; extra-large items a truck and a second person. You set up payouts after you take your first delivery.",
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
        // WAS "a range from local market data for your category and parish", then
        // "We suggest a typical range for the category, and you can take the
        // suggested amount in one tap." Both false: the owner removed suggested
        // prices from Post a job on 2026-10-08 (BudgetSection.tsx), and the
        // range table (src/lib/pricingGuide.ts) had no caller and was deleted
        // 2026-11-04 (Q1834).
        a: "You set the price. Pick what the job is worth to you.",
      },
      {
        // F411 (audit 11-10): no answer was called "How do I cancel a job?". Same rule as the answer below
        // (cancellationFee.ts: free 24+ hours out; inside 24 hours part goes to the Helpr and it is a strike).
        q: "How do I cancel a job?",
        a: `Open the job and tap Cancel job. ${NO_HIRE_REFUND} With a Helpr hired, there is no charge to cancel up to 24 hours before the start. Closer than that, the Helpr gets part of the price for holding the time, and it counts as a strike. You see the exact amount before you confirm.`,
      },
      {
        // F411 (audit 11-10): the no-show steps, in the words of the Report no-show dialog (ActivityDialogs.tsx).
        q: "What if my Helpr doesn't show up?",
        a: "From 30 minutes after the start time, open the job and tap Report no-show. The Helpr comes off your job and it goes on their record. To hire someone else, change the date right away; otherwise the job is cancelled and refunded. Our team is told about every no-show.",
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
        a: `Yes. ${NO_HIRE_REFUND} After you accept a Helpr, cancelling works the same up to 24 hours before the start, with no strike. Closer than that, the Helpr also gets part of the price for holding the time, and it counts as a strike. You'll see the exact amount first.`,
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
        a: `You're paid ${STANDARD_PAYOUT_DAYS_AFTER_APPROVAL} days after the person who posted the job approves it. Your bank shows it ${STANDARD_PAYOUT_WINDOW}. ${SETUP_FEE_PHRASE.charAt(0).toUpperCase()}${SETUP_FEE_PHRASE.slice(1)} comes out of your first payout, unless you already paid it on a job you posted or on Declutter.`,
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
        // crew block fees (refundToPayerCents). The setup fee's amount is a live DB setting:
        // HelpCenter fills SETUP_FEE_PHRASE from it (withSetupFeeAmount, F236/F258).
        a: `When you post a job, you pay the job price (including any urgent bonus you add), plus Louisiana sales tax on the labor for taxable job types (auto and appliance repair). Your first paid job also carries ${SETUP_FEE_PHRASE}, charged once per account, unless you already paid it on a job you did or on Declutter. On Declutter, the buyer pays the item price plus a buyer's fee of ${DECLUTTER_BUYER_FEE_WORDS}, once per checkout, and the seller keeps the whole item price. When you do a job, every job shows exactly what you will take home before you apply. Job payouts are rounded down to the whole dollar (tips are paid in full). If a paid job is cancelled, the cancel screen shows exactly what you will get back before you confirm. If the mistake was ours, you get everything back.`,
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
        a: `Open a dispute from the job's card: Jobs > Working for a job you're doing, or Jobs > Posted for a job you posted. On a job you're doing, Report a Problem is there from On the way until the person who posted the job approves it, including during a revision. On a job you posted, ask for a change first and give the person doing it time to fix it; the dispute link appears once that time has run out. The person who posted the job has ${APPROVAL_WINDOW_HOURS} hours after the work is marked done to approve it or ask for a change. ${DONE_IS_FINAL} While a dispute is open, our team reviews both sides and can release the payment to either party or split it. Disputes have a 72-hour window: if it isn't settled or escalated in that time, our team decides it, and the payment stays on hold until we do.`,
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
        a: `Helprs can upload trade licenses and insurance, and verified badges show on their profile. On trade jobs (${CREDENTIAL_CATEGORY_PHRASE}) you also choose who may apply: open to anyone, licensed pros only, or licensed and insured. Only Helprs who meet your choice can apply. Other categories are open to any Helpr.`,
      },
      {
        // F411 (audit 11-10): the question said what it is, not where it shows or what it means for the reader.
        q: "What does the cancellation rate on a profile mean?",
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
];

