import { TIER_PERKS } from "@/lib/subscriptionTiers";
// The escrow clock is owned by the cron that actually moves the money, not by
// this file. Same import the legal pages, PaymentSuccess and the activity cards
// use; `escrowTiming.copyParity.test.ts` fails if this answer ever goes back to
// restating the numbers as literals.
import {
  COPY_AUTO_RELEASE_HOURS,
  PAYOUT_HOLD_HOURS,
} from "../../../supabase/functions/_shared/escrowTiming";
// Cancellation percentages and the standard payout window are binding money
// figures with one owner each. Same rule as legal/CommunitySection: derive,
// never retype.
import { LATE_CANCEL_PERCENT, VERY_LATE_CANCEL_PERCENT } from "@/lib/moneyLimits";
import { STANDARD_PAYOUT_WINDOW } from "@/lib/payoutTiming";

// The bottom rung of the fee ladder a reader can actually reach.
// Mirrors `FEE_FLOOR` in legal/TermsSection.
const FEE_FLOOR = TIER_PERKS.elite;

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
// on "Payments & Escrow".
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
    label: "Payments & Escrow",
    desc: "How money is held, released, and paid.",
  },
  { label: "Trust & Safety", desc: "Verification, disputes, and reporting." },
  { label: "Account & Settings", desc: "Email, password, deletion, Senior Mode." },
  // The seventh FAQ topic had no blurb entry, so it rendered bare next to
  // six that carry one.
  { label: "Membership & Billing", desc: "Plans, upgrades, and cancelling." },
];

// Per-section accent tint so the FAQ topic labels read as a varied palette
// (bark / sienna / olivewood / gold / sage) rather than one flat color.
export const SECTION_ACCENTS: Record<string, string> = {
  "Getting Started": "hsl(var(--burnt-sienna))",
  "Posting a Job": "hsl(var(--bark))",
  "Finding Work": "hsl(var(--success-ink))",
  "Payments & Escrow": "hsl(var(--gold-ink))",
  "Trust & Safety": "hsl(var(--olivewood))",
  "Account & Settings": "hsl(var(--burnt-sienna))",
  // FAQ_SECTIONS has SEVEN topics and this map had six keys, so "Membership &
  // Billing" fell through HelpCenter.tsx's `?? burnt-sienna` default — giving
  // THREE of seven sections the identical accent and defeating the varied
  // palette this map exists to produce. Same byte-identical-key drift the
  // TOPICS comment above was written about; it just failed quietly here
  // because the fallback looked like a real colour.
  //
  // The seventh accent was --sage, and --sage IS NOT A TEXT COLOUR. Every
  // accent in this map is rendered as the topic's 12px/600 label, and --sage
  // (78 9% 53%) measured 2.75:1 on the light topic card — the worst contrast
  // on the whole public surface, and the fix for the missing-key bug is what
  // introduced it. --sage-ink exists for "sage as a label", but it is
  // byte-identical to --bark, which "Posting a Job" already uses, so it would
  // have re-created the duplicate-accent problem this entry was added to
  // solve. --stormy-sky is a distinct hue from all six others, is documented
  // AA in both themes, and measures 5.55:1 light / 6.71:1 dark here.
  "Membership & Billing": "hsl(var(--stormy-sky))",
};

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
        // people into a flow they could not finish. A new account is also
        // pending approval (ProtectedRoute.tsx routes it to /account-pending)
        // AND must clear Stripe identity verification before posting or
        // accepting (useJobSubmit.ts gates on it). Discovering that after
        // writing a job post is the worst moment to learn it.
        a: "No, you can browse without signing up. To post a job or apply for one you'll need an account, approval from our team, and a quick identity check through Stripe — so it's worth starting that early.",
      },
      {
        q: "Is Helpr available everywhere in Louisiana?",
        a: "We're growing across Louisiana's 64 parishes. If your area isn't busy yet, posting a job is the best way to attract local Helprs.",
      },
      {
        q: "Can I both post jobs and work as a Helpr?",
        a: 'Yes — every account can do both. There\'s no separate "poster" or "Helpr" mode.',
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
        a: `Yes. It's always free before you accept anyone. After you accept a Helpr the fee depends on how close the job is — still free 24 or more hours out, ${LATE_CANCEL_PERCENT}% inside 24 hours, and ${VERY_LATE_CANCEL_PERCENT}% inside 2 hours, because by then the Helpr has held the slot for you.`,
      },
    ],
  },
  {
    topic: "Finding Work",
    items: [
      {
        q: "How do I get my first application accepted?",
        a: "A complete profile (photo, bio, skills) helps posters trust you faster. Respond fast — posters notice quick turnaround.",
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
        a: `Payment releases to your Helpr account after the poster confirms completion, then transfers to your bank ${STANDARD_PAYOUT_WINDOW}. A one-time account setup fee comes out of your first payout; every standard payout after that is free. Instant Payout — cashing out the same day — is a Basic, Pro or Elite membership feature and charges a small percentage fee.`,
      },
      {
        q: "What if a poster doesn't confirm completion?",
        // WAS "…about 48 hours after completion". The notification the very
        // same event sends says 24 (auto-release-payment/index.ts:302-303,
        // 315-316), so a helper saw both numbers for one payout. Single number,
        // matching what the push actually promises.
        //
        // NOW DERIVED, not retyped. The two numbers are the two legs of the
        // schedule in `_shared/escrowTiming.ts`: AUTO_COMPLETE_HOURS (the
        // poster's confirm-or-dispute window, aliased COPY_AUTO_RELEASE_HOURS)
        // and PAYOUT_HOLD_HOURS (the chargeback buffer before the transfer
        // fires). Stated as a DELTA — "N hours, then M more" — because that is
        // the shape the push uses; a total ("48 hours") would read as a third
        // number beside the notification's two. Interpolating both means a
        // change to either leg moves this answer with it instead of leaving it
        // as the one screen still quoting last quarter's clock.
        a: `If a poster doesn't confirm within ${COPY_AUTO_RELEASE_HOURS} hours of you marking work done, it auto-completes and payment releases — funds reach your account about ${PAYOUT_HOLD_HOURS} hours after that.`,
      },
    ],
  },
  {
    topic: "Payments & Escrow",
    items: [
      {
        q: "What is Helpr Escrow?",
        // WAS: "When a poster accepts your application, their payment is held
        // securely…". FALSE, and about the single most important fact on the
        // page. The poster pays at CHECKOUT, when the job is posted
        // (`useJobSubmit.ts` invokes create-payment action="escrow"; the funds
        // are recorded held by `checkoutSessionCompleted.ts:664`) — long before
        // anyone applies. `accept_application`
        // (20260518120000_accept_application_rpc.sql) touches no Stripe or
        // payment state at all. The old wording invited the exact worry escrow
        // exists to remove: a Helpr doing work on a job that might never have
        // been funded.
        a: "The poster pays when they post the job, and Helpr holds that money (via Stripe) from that moment — before anyone applies, so a job you can apply to is a job that is already funded. It releases to you only after completion is confirmed. Neither side can touch it mid-job.",
      },
      {
        q: "What fees does Helpr charge?",
        a: `Free-account Helprs keep ${100 - TIER_PERKS.free.platformFeePercent}% (${TIER_PERKS.free.platformFeePercent}% platform fee). ${TIER_PERKS.basic.name} keeps ${100 - TIER_PERKS.basic.platformFeePercent}%, ${TIER_PERKS.pro.name} keeps ${100 - TIER_PERKS.pro.platformFeePercent}%, and ${TIER_PERKS.elite.name} ${100 - TIER_PERKS.elite.platformFeePercent}% (${TIER_PERKS.elite.platformFeePercent}% fee) — the platform fee drops as your plan tier rises. Posters pay a plan-based service fee at checkout too (${TIER_PERKS.free.platformFeePercent}% Free, ${TIER_PERKS.basic.platformFeePercent}% ${TIER_PERKS.basic.name}, ${TIER_PERKS.pro.platformFeePercent}% ${TIER_PERKS.pro.name}, ${TIER_PERKS.elite.platformFeePercent}% ${TIER_PERKS.elite.name}), with a small minimum so tiny jobs still cover card processing.`,
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
        // (AppliedJobCard / PostedJobActions) via `DisputeLink`, and its
        // visibility rules were undisclosed: a poster must request a REVISION
        // first and let that window lapse (DisputeLink.tsx:58-74), and the link
        // survives only 7 days past completion (:88-95). Sending someone to the
        // wrong screen to file a time-limited money claim is the worst possible
        // shape for this answer to be wrong in.
        a: "Open a dispute from the job's card in My Jobs (Helprs) or My Posts (posters) — not the job detail screen. If you're the poster, request a revision first and give the Helpr their window to fix it; the dispute link appears once that window has run. It stays available for 7 days after completion. Our team reviews both sides and can release the payment to either party or split it. Disputes have a 72-hour window: if it isn't resolved or escalated in that time, platform policy releases the payment to the Helpr automatically, so don't sit on it.",
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
        //   (2) The selector renders for FOUR categories only —
        //       CREDENTIAL_TIER_CATEGORIES (:28-33) is handyman, painting,
        //       moving, assembly. Every other category has no picker and stays
        //       tier 0, so "when you post a job you choose" was untrue for most
        //       posts. Also corrected: identity verification is required to post
        //       or accept (useJobSubmit.ts gates on it), not the optional
        //       "can verify" the old sentence implied.
        a: "Identity verification through Stripe is required before anyone can post a job or accept one, and Helprs can additionally upload trade licenses and insurance — verified badges show on their profile. On trade jobs (handyman, painting, moving, and assembly) you also choose who may apply: open to anyone, licensed pros only, or licensed and insured. Only Helprs who meet what you set can apply — it's enforced by the database, not just hidden in the app. Other categories are open to any verified Helpr.",
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
        q: "Can I report a Helpr or poster?",
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
        a: "Go to Profile → Account Security.",
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
        a: "Yes. Open your Profile and scroll to the very bottom — \"Delete Account\" is the last control on the page. Finish or cancel any active job first: we can't delete an account while money is still held in escrow. We retain transaction records per Louisiana law but remove all personal data.",
      },
      {
        q: "What is Senior Mode?",
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
        a: "Senior Mode makes the app easier to read and tap — larger type and bigger touch targets throughout. Enable it in Profile → Accessibility.",
      },
    ],
  },
  {
    topic: "Membership & Billing",
    items: [
      {
        q: "What does a membership do?",
        a: `It lowers the commission Helpr deducts from the real-world jobs you get paid for — from ${TIER_PERKS.free.platformFeePercent}% down to as low as ${FEE_FLOOR.platformFeePercent}% — and adds visibility perks like priority placement and a featured badge. The lower commission applies to every job you complete.`,
      },
      {
        q: "How am I billed for a membership?",
        // WAS "…from Manage membership." No control is called that: grep finds
        // the string only in this answer. The tab is "Membership"
        // (profile/types.ts:35) and the button on it is "Manage"
        // (SubscriptionTab.tsx:664), which opens the Stripe billing portal. A
        // navigation instruction has to name what is actually on screen.
        a: "Membership is billed securely through Stripe — the same processor that handles your job payments. Manage or cancel it anytime from Profile → Membership → Manage, which opens your Stripe billing portal.",
      },
      {
        q: "Can I cancel my membership anytime?",
        a: "Yes — downgrade at any time. Your paid perks stay active through the end of your billing period, then you revert to Free.",
      },
      {
        q: "Does my fee reduction apply immediately?",
        a: "Yes. On your very next accepted job, the lower platform fee applies — no waiting period.",
      },
      {
        q: `What's the difference between ${TIER_PERKS.pro.name} and ${TIER_PERKS.elite.name}?`,
        a: `${TIER_PERKS.elite.name} adds the featured crown badge (visible to all posters), 20-minute early job access before other helpers see it (${TIER_PERKS.pro.name} gets 10, ${TIER_PERKS.basic.name} 5), and dedicated priority support — on top of everything ${TIER_PERKS.pro.name} offers.`,
      },
    ],
  },
];

