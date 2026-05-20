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
  return (
    <Comp
      className={
        className ?? "mx-auto mb-4 h-24 w-24 text-[hsl(var(--burnt-sienna))]"
      }
    />
  );
}
