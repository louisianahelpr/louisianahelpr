/**
 * Life-event trigger system — surfaces personalized prompts on the home feed
 * based on user behavior, profile data, and contextual signals.
 *
 * Max 1 trigger shown at a time (highest priority that passes its condition
 * and has not been dismissed). Dismissal persists to localStorage so the
 * card doesn't reappear on reload.
 */

export interface LifeEventTrigger {
  id: string;
  headline: string;
  subtext: string;
  ctaLabel: string;
  ctaPath: string;
  category?: string;
  icon: string; // Lucide icon name
  condition: (ctx: TriggerContext) => boolean;
  dismissKey: string; // localStorage key — presence = dismissed
  priority: number;   // higher = shown first when multiple match
}

export interface TriggerContext {
  recentJobCategories: string[];      // categories from their last 10 posted jobs
  hasPostedBefore: boolean;
  accountAgeDays: number;
  completedJobsAsHelper: number;
  lastJobPostedDaysAgo: number | null;
  profileHasCity: boolean;
  hasPets: boolean;
}

export const LIFE_EVENT_TRIGGERS: LifeEventTrigger[] = [
  {
    id: "new_user_first_job",
    headline: "What do you need help with?",
    subtext: "Post your first job in under 2 minutes. Local helpers apply fast.",
    ctaLabel: "Post a job →",
    ctaPath: "/post-job",
    icon: "Plus",
    condition: (ctx) => !ctx.hasPostedBefore && ctx.accountAgeDays <= 7,
    dismissKey: "trigger-new-user-dismissed",
    priority: 100,
  },
  {
    id: "moving_followup",
    headline: "Just moved? Time to settle in.",
    subtext: "Unpack help, assembly, cleaning — helprs know the drill.",
    ctaLabel: "Find moving help →",
    ctaPath: "/post-job?category=moving",
    category: "moving",
    icon: "Truck",
    condition: (ctx) => ctx.recentJobCategories.includes("moving"),
    dismissKey: "trigger-moving-followup-dismissed",
    priority: 70,
  },
  {
    id: "re_engage_lapsed",
    headline: "It's been a while",
    subtext: "Your last job was over a month ago. Got anything piling up?",
    ctaLabel: "Post a job →",
    ctaPath: "/post-job",
    icon: "RefreshCw",
    condition: (ctx) =>
      ctx.hasPostedBefore &&
      ctx.lastJobPostedDaysAgo !== null &&
      ctx.lastJobPostedDaysAgo > 30,
    dismissKey: "trigger-lapsed-dismissed",
    priority: 60,
  },
  {
    id: "pet_owner_care",
    headline: "Your pets deserve great care",
    subtext: "Find a dog walker or pet sitter in your neighborhood.",
    ctaLabel: "Find pet care →",
    ctaPath: "/post-job?category=pet_care",
    category: "pet_care",
    icon: "PawPrint",
    condition: (ctx) =>
      ctx.hasPets && !ctx.recentJobCategories.includes("pet_care"),
    dismissKey: "trigger-pet-care-dismissed",
    priority: 50,
  },
];

/**
 * Returns the single highest-priority trigger that passes its condition and
 * has not been dismissed. Returns an empty array when nothing qualifies.
 */
export function getActiveTriggers(ctx: TriggerContext): LifeEventTrigger[] {
  return LIFE_EVENT_TRIGGERS
    .filter((t) => {
      try {
        if (typeof window !== "undefined" && localStorage.getItem(t.dismissKey)) {
          return false;
        }
      } catch {
        // Private-browsing / quota — fall through and show the trigger.
      }
      return t.condition(ctx);
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 1); // show max 1 at a time to avoid overwhelming
}
