/**
 * Industry vertical variant data for /for-business?v=...
 *
 * Switching the query param swaps the hero copy, the 5 feature bullets,
 * and one matching case-study card. Default ("generic") is used when
 * no `v=` param is present or the value isn't recognized.
 *
 * Each variant also carries SEO meta (title, description, OG image) so
 * landings can be indexed individually by Google for keyword targeting.
 */

import {
  ShieldCheck,
  Users,
  CreditCard,
  Sparkles,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";

export type VariantKey =
  | "generic"
  | "restaurants"
  | "property-management"
  | "contractors";

export interface FeatureBullet {
  icon: LucideIcon;
  text: string;
}

export interface CaseStudyCard {
  company: string;
  industry: string;
  quote: string;
  outcome: string;
  metric: string;
}

export interface VariantConfig {
  key: VariantKey;
  eyebrow: string;
  heroLead: string;
  heroAccent: string;
  subhead: string;
  features: FeatureBullet[];
  caseStudy: CaseStudyCard;
  seo: {
    title: string;
    description: string;
  };
}

const SHARED_FEATURES: FeatureBullet[] = [
  { icon: ShieldCheck, text: "Stripe ID-verified helprs" },
  { icon: Users, text: "2 team seats free, upgrade anytime" },
  { icon: CreditCard, text: "Owner's card billed for all jobs" },
  { icon: Sparkles, text: "Recurring jobs, statewide coverage" },
  { icon: CheckCircle2, text: "Flat platform fee, no contracts" },
];

export const VARIANTS: Record<VariantKey, VariantConfig> = {
  generic: {
    key: "generic",
    eyebrow: "For business",
    heroLead: "The best help for",
    heroAccent: "Louisiana businesses.",
    subhead:
      "The simplest way to find, hire, and pay local pros for your business tasks.",
    features: SHARED_FEATURES,
    caseStudy: {
      company: "Crescent Office Group",
      industry: "Office services",
      quote:
        "Our office manager spends 3 hours a week instead of 12 sourcing helpers for small jobs.",
      outcome: "Saved 9 hours/week",
      metric: "9 hrs / wk",
    },
    seo: {
      title: "Helpr for Business — Louisiana Commercial Services",
      description:
        "Find, hire, and pay verified local pros for your Louisiana business. Free team seats, Stripe ID-verified helprs, flat platform fee, no contracts.",
    },
  },

  restaurants: {
    key: "restaurants",
    eyebrow: "For restaurants",
    heroLead: "On-call cooks, cleans, and overflow staff for",
    heroAccent: "Louisiana restaurants.",
    subhead:
      "Cover a callout, schedule a deep clean, or staff a private event in hours, not days. No agency contracts.",
    features: [
      { icon: ShieldCheck, text: "Food-safety verified helprs in our pool" },
      { icon: Users, text: "Book by shift — same-day or weeks ahead" },
      { icon: CreditCard, text: "One card on file, billed per shift" },
      { icon: Sparkles, text: "Recurring deep cleans, hood pickups, prep" },
      { icon: CheckCircle2, text: "No agency contracts, no markups" },
    ],
    caseStudy: {
      company: "Magnolia Bistro",
      industry: "Casual fine dining",
      quote:
        "When a line cook calls out at 2pm, we have someone in our kitchen by 5pm. That alone has saved us four bad nights this quarter.",
      outcome: "Cut callout-related closures to zero",
      metric: "0 closures",
    },
    seo: {
      title: "Helpr for Restaurants — On-Call Staff Across Louisiana",
      description:
        "Cover callouts, deep cleans, and event staffing in hours. Verified Louisiana helprs, flat platform fee, no agency contracts.",
    },
  },

  "property-management": {
    key: "property-management",
    eyebrow: "For property managers",
    heroLead: "Turn over units faster across",
    heroAccent: "every Louisiana parish.",
    subhead:
      "Schedule turnovers, lawn care, light repairs, and inspections across your whole portfolio from one dashboard.",
    features: [
      { icon: ShieldCheck, text: "ID-verified turnover crews" },
      { icon: Users, text: "Assign jobs by unit or whole portfolio" },
      { icon: CreditCard, text: "One owner card — bill back per property" },
      { icon: Sparkles, text: "Recurring lawn care, pool, pest scheduling" },
      { icon: CheckCircle2, text: "Photo-documented completion on every job" },
    ],
    caseStudy: {
      company: "Bayou Property Partners",
      industry: "Multi-family + Airbnb",
      quote:
        "We used to lose a full day on every turnover coordinating a cleaner and a handyman. Now both show up the same day, same dashboard.",
      outcome: "Cut turnover time by 60%",
      metric: "60% faster",
    },
    seo: {
      title: "Helpr for Property Management — Turnovers Across Louisiana",
      description:
        "Faster unit turnovers, recurring lawn and pool, photo-documented completions. One dashboard for every Louisiana property.",
    },
  },

  contractors: {
    key: "contractors",
    eyebrow: "For contractors",
    heroLead: "Extra hands for the punch list,",
    heroAccent: "without the W-2 paperwork.",
    subhead:
      "Hire day-help, demo crews, and cleanup labor when a job runs long — no agency middleman, no 1099 chasing.",
    features: [
      { icon: ShieldCheck, text: "ID-verified general labor on demand" },
      { icon: Users, text: "Crew up the day before — or the morning of" },
      { icon: CreditCard, text: "Owner's card on file, billed per shift" },
      { icon: Sparkles, text: "Recurring jobsite cleanup + post-job haul-off" },
      { icon: CheckCircle2, text: "1099s + W-9s handled for you" },
    ],
    caseStudy: {
      company: "Delta Build Co.",
      industry: "General contracting",
      quote:
        "We pull 2-4 extra hands per week off Helpr instead of carrying a W-2 helper. Our gross margin per job went up 8 points.",
      outcome: "Margin up 8 points per job",
      metric: "+8 pts",
    },
    seo: {
      title: "Helpr for Contractors — Day Labor & Cleanup Across Louisiana",
      description:
        "Extra hands for punch lists, demo, and cleanup — no agency markup, no W-2 paperwork. Statewide coverage in Louisiana.",
    },
  },
};

export function resolveVariant(param: string | null | undefined): VariantConfig {
  if (!param) return VARIANTS.generic;
  const key = param.toLowerCase() as VariantKey;
  return VARIANTS[key] ?? VARIANTS.generic;
}
