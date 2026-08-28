import { type FC } from "react";
import { EmptyInbox } from "./illustrations/EmptyInbox";
import { EmptyJobs } from "./illustrations/EmptyJobs";
import { EmptyNotifications } from "./illustrations/EmptyNotifications";
import { EmptySavedHelprs } from "./illustrations/EmptySavedHelprs";
import { EmptyPosts } from "./illustrations/EmptyPosts";
import { EmptyReviews } from "./illustrations/EmptyReviews";

type Variant = "inbox" | "jobs" | "notifications" | "saved" | "posts" | "reviews";

const MAP: Record<Variant, FC<{ className?: string }>> = {
  inbox: EmptyInbox,
  jobs: EmptyJobs,
  notifications: EmptyNotifications,
  saved: EmptySavedHelprs,
  posts: EmptyPosts,
  reviews: EmptyReviews,
};

export function EmptyStateIllustration({
  variant,
  className,
}: {
  variant: Variant;
  className?: string;
}) {
  const Comp = MAP[variant];
  // Most illustrations fill a square viewBox, so one square default fits them
  // all. `reviews` is a five-star ROW — wide and short — and forcing it into
  // the square box letterboxed it, leaving a large dead gap above the title.
  // It gets a width-driven, auto-height default so it occupies only the space
  // it actually draws in.
  const defaultClass =
    variant === "reviews"
      ? "mx-auto mb-4 h-auto w-28 text-[hsl(var(--burnt-sienna))]"
      : "mx-auto mb-4 h-24 w-24 text-[hsl(var(--burnt-sienna))]";
  return <Comp className={className ?? defaultClass} />;
}
