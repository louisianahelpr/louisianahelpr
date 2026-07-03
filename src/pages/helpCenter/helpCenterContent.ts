import type { LucideIcon } from "lucide-react";
import {
  Rocket,
  ClipboardList,
  Briefcase,
  CreditCard,
  ShieldCheck,
  Settings,
  BookOpen,
  Scale,
} from "lucide-react";
import { TIER_PERKS } from "@/lib/subscriptionTiers";

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
];

// Per-section accent tint so the FAQ topic labels read as a varied palette
// (bark / sienna / olivewood / gold / sage) rather than one flat color.
export const SECTION_ACCENTS: Record<string, string> = {
  "Getting Started": "hsl(var(--burnt-sienna))",
  "Posting a Job": "hsl(var(--bark))",
  "Finding Work": "hsl(var(--success-ink))",
  "Payments & Escrow": "hsl(var(--gold-warm))",
  "Trust & Safety": "hsl(var(--olivewood))",
  "Account & Settings": "hsl(var(--burnt-sienna))",
};

// ─── FAQ data ─────────────────────────────────────────────────────────────────

export interface FaqItem {
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
        a: "You can set your own price, accept bids from competing Helprs, or use Helpr's Smart Price suggestion based on local market data.",
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
        a: "Payment releases to your Helpr account after the poster confirms completion. Same-day transfer to your bank if your payout account is set up.",
      },
      {
        q: "What if a poster doesn't confirm completion?",
        a: "If a poster doesn't confirm within 48 hours of you marking work done, it auto-completes and payment releases (funds typically reach you about 72 hours after completion).",
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
        a: `Free-account Helprs keep ${100 - TIER_PERKS.free.platformFeePercent}% (${TIER_PERKS.free.platformFeePercent}% platform fee). Pro keeps ${100 - TIER_PERKS.pro.platformFeePercent}%, Elite ${100 - TIER_PERKS.elite.platformFeePercent}%, and Business ${100 - TIER_PERKS.business.platformFeePercent}% (${TIER_PERKS.business.platformFeePercent}% fee) — the platform fee drops as your plan tier rises. Posters pay a 10% service fee at checkout.`,
      },
      {
        q: "What if there's a dispute?",
        a: "Open a dispute from the job detail screen. Our team reviews both sides and can release the payment to either party.",
      },
    ],
  },
  {
    topic: "Trust & Safety",
    items: [
      {
        q: "How are Helprs verified?",
        a: "Every Helpr submits a government-issued ID. Licensed trade work (electrical, plumbing) requires matching verified license.",
      },
      {
        q: "What is the cancellation rate?",
        a: "We show a Helpr's cancellation history on their profile once they've completed 5+ jobs. Low cancellation is a strong trust signal.",
      },
      {
        q: "Can I report a Helpr or poster?",
        a: 'Yes — the "Report" option is in every job detail and profile. Our team reviews all reports within 24 hours.',
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
        a: "Yes. Profile → ··· menu → Delete account. We retain transaction records per Louisiana law but remove all personal data.",
      },
      {
        q: "What is Senior Mode?",
        a: "Senior Mode simplifies the interface and enables a trusted family member to monitor jobs on your behalf. Enable it in Profile → Settings.",
      },
    ],
  },
  {
    topic: "Membership & Billing",
    items: [
      {
        q: "What does a membership do?",
        a: `It lowers the commission Helpr deducts from the real-world jobs you get paid for — from ${TIER_PERKS.free.platformFeePercent}% down to as low as ${TIER_PERKS.business.platformFeePercent}% — and adds visibility perks like priority placement and a featured badge. The lower commission applies to every job you complete.`,
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
        q: "What's the difference between Pro and Elite?",
        a: "Elite adds the featured crown badge (visible to all posters), 10-minute early job access before other helpers see it, and dedicated priority support — on top of everything Pro offers.",
      },
    ],
  },
];

// ─── More-resources cards ─────────────────────────────────────────────────────

export const RESOURCES: {
  icon: LucideIcon;
  label: string;
  desc: string;
  to: string;
  accent: string;
  accentBg: string;
}[] = [
  {
    icon: BookOpen,
    label: "How Helpr works",
    desc: "Post, hire, and get paid — end to end.",
    to: "/#how-it-works",
    accent: "hsl(var(--bark))",
    accentBg: "hsl(var(--bark) / 0.1)",
  },
  {
    icon: Scale,
    label: "Rules & safety",
    desc: "Community rules, disputes, and protections.",
    to: "/legal?tab=community",
    accent: "hsl(var(--burnt-sienna))",
    accentBg: "hsl(var(--burnt-sienna) / 0.1)",
  },
  {
    icon: Briefcase,
    label: "Browse jobs",
    desc: "See what neighbors need help with right now.",
    to: "/jobs",
    accent: "hsl(var(--success-ink))",
    accentBg: "hsl(var(--success-ink) / 0.12)",
  },
];
