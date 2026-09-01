import type { LucideIcon } from "lucide-react";
import {
  Rocket,
  ClipboardList,
  Briefcase,
  CreditCard,
  ShieldCheck,
  Settings,
  Crown,
} from "lucide-react";
import { TIER_PERKS } from "@/lib/subscriptionTiers";

// The bottom rung of the fee ladder a reader can actually reach.
// Mirrors `FEE_FLOOR` in legal/TermsSection.
const FEE_FLOOR = TIER_PERKS.elite;

// ─── Topic cards ──────────────────────────────────────────────────────────────

export const TOPICS: {
  icon: LucideIcon;
  label: string;
  desc: string;
  color: string;
  bg: string;
}[] = [
  {
    icon: Rocket,
    label: "Getting Started",
    desc: "New to Helpr? Start here.",
    color: "hsl(var(--burnt-sienna))",
    bg: "hsl(var(--burnt-sienna) / 0.10)",
  },
  {
    icon: ClipboardList,
    label: "Posting a Job",
    desc: "Write a great post and get results.",
    color: "hsl(var(--bark))",
    bg: "hsl(var(--bark) / 0.10)",
  },
  {
    icon: Briefcase,
    label: "Finding Work",
    desc: "Apply, get hired, and grow your income.",
    color: "hsl(var(--success-ink))",
    bg: "hsl(var(--success-ink) / 0.12)",
  },
  {
    icon: CreditCard,
    // Must be byte-identical to the FAQ_SECTIONS `topic` below. The lookup is
    // `TOPICS.find(t => t.label.toLowerCase() === topic.toLowerCase())`, so
    // this said "Payments & How Funds Work" against a topic of "Payments &
    // Escrow" and silently resolved to undefined — the section rendered with
    // no description at all, with nothing to indicate a miss.
    label: "Payments & Escrow",
    desc: "How money is held, released, and paid.",
    color: "hsl(var(--gold-warm))",
    bg: "hsl(var(--gold-warm) / 0.15)",
  },
  {
    icon: ShieldCheck,
    label: "Trust & Safety",
    desc: "Verification, disputes, and reporting.",
    color: "hsl(var(--olivewood))",
    bg: "hsl(var(--olivewood) / 0.12)",
  },
  {
    icon: Settings,
    label: "Account & Settings",
    desc: "Email, password, deletion, Senior Mode.",
    color: "hsl(var(--olivewood))",
    bg: "hsl(var(--olivewood) / 0.10)",
  },
  {
    // The seventh FAQ topic had no blurb entry, so it rendered bare next to
    // six that carry one.
    icon: Crown,
    label: "Membership & Billing",
    desc: "Plans, upgrades, and cancelling.",
    color: "hsl(var(--burnt-sienna))",
    bg: "hsl(var(--burnt-sienna) / 0.10)",
  },
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
  "Membership & Billing": "hsl(var(--sage))",
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
        a: "No, you can browse without signing up. You'll need an account to post or apply.",
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
        a: "Yes, before accepting an applicant. Once you accept and payment is held securely, a cancellation fee applies.",
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
        a: "Payment releases to your Helpr account after the poster confirms completion, then transfers to your bank on the standard schedule. Instant Payout — cashing out the same day — is a Basic, Pro or Elite membership feature and charges a small fee; standard payouts are always free.",
      },
      {
        q: "What if a poster doesn't confirm completion?",
        // WAS "…about 48 hours after completion". The notification the very
        // same event sends says 24 (auto-release-payment/index.ts:302-303,
        // 315-316), so a helper saw both numbers for one payout. Single number,
        // matching what the push actually promises.
        a: "If a poster doesn't confirm within 24 hours of you marking work done, it auto-completes and payment releases — funds reach your account about 24 hours after that.",
      },
    ],
  },
  {
    topic: "Payments & Escrow",
    items: [
      {
        q: "What is Helpr Escrow?",
        a: "When a poster accepts your application, their payment is held securely by Helpr (via Stripe). It releases to you only after completion is confirmed. Neither side can touch it mid-job.",
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
        a: "Open a dispute from the job detail screen. Our team reviews both sides and can release the payment to either party. Disputes have a 72-hour window: if it isn't resolved or escalated in that time, platform policy releases the payment to the Helpr automatically, so don't sit on it.",
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
        a: "Helprs can verify their identity with Stripe and upload trade licenses and insurance; verified badges show on their profile. When you post a job you choose what it requires — open to anyone, ID-verified only, licensed, or licensed and insured — and only Helprs who meet it can apply.",
      },
      {
        q: "What is the cancellation rate?",
        a: "We show a Helpr's cancellation history on their profile once they've completed 5+ jobs. Low cancellation is a strong trust signal.",
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
        a: "Yes. Open your Profile and scroll to Settings → Delete account. We retain transaction records per Louisiana law but remove all personal data.",
      },
      {
        q: "What is Senior Mode?",
        // There is no Settings TAB. Senior Mode lives on the Accessibility tab
        // (AccessibilityTab.tsx). A help answer that names a screen the app
        // does not have sends the reader looking for it.
        a: "Senior Mode simplifies the interface and enables a trusted family member to monitor jobs on your behalf. Enable it in Profile → Accessibility.",
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
        a: "Membership is billed securely through Stripe — the same processor that handles your job payments. You can manage or cancel it anytime from Manage membership.",
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

// ─── More-resources cards ─────────────────────────────────────────────────────
