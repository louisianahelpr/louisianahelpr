import type { Database } from "@/integrations/supabase/types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export interface MenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  desc: string;
  href?: string;
  /** HSL token expression (e.g. "var(--bark)") used to tint the row's
      icon tile — gives each surface its own warm accent instead of one
      flat grey. */
  tint?: string;
  /** Render a small "Action needed" red dot when true. */
  needsAction?: boolean;
  /** Short, warm completeness nudge (e.g. "Add a photo"). Optional —
      when set, renders as a small amber pill under the label so the
      user knows *what* to fix before opening the row. Distinct from
      `needsAction`: that's reserved for the louder destructive
      payout-not-enabled state. */
  incompleteLabel?: string;
}

export interface ReviewPreview {
  rating: number;
  feedback: string | null;
  created_at: string;
  reviewerName: string;
  jobTitle: string;
}

export interface ProfileLandingProps {
  profile: Profile | null;
  /** The auth'd user's UUID — used to build the public profile share URL. */
  userId?: string | null;
  displayName: string;
  initials: string;
  avatarBroken: boolean;
  setAvatarBroken: (v: boolean) => void;
  avgRating: number | null;
  reviewCount: number;
  postedCount: number;
  completedCount: number;
  /* Payout status is NOT a prop: <ProfileLanding /> owns it via
     `useStripeConnectStatus()`, which reads the user straight from the
     `useCurrentUser` cache. Passing it down from the page meant the (slow,
     Stripe-bound) request couldn't start until the page had set its own
     `profile` state — which is why the banner used to land after the rest
     of the screen had already settled. */
  onSelectTab: (key: string) => void;
  onNavigate: (path: string) => void;
  onLoadInlineJobs: () => void;
  onRequestDelete: () => void;
  onRequestLogout: () => void;
  /** Up to 2 most recent reviews surfaced on the hero card. */
  reviewsPreview?: ReviewPreview[];
  /** True when the helper-stats sub-loader failed. */
  statsError?: boolean;
  /** True when the review-preview sub-loader failed. */
  reviewsError?: boolean;
  /** Retries just the helper-stats sub-section. */
  onRetryStats?: () => void;
  /** Retries just the review-preview sub-section. */
  onRetryReviews?: () => void;
  /**
   * Last-6-weeks take-home earnings, oldest → newest, for the header
   * sparkline teaser. `null` (not enough signal) hides the teaser.
   */
  earningsSparkline?: number[] | null;
  /** Total lifetime take-home, shown beside the sparkline. */
  totalEarnings?: number;
}
