import { Star, ClipboardList, Hammer } from "lucide-react";
import type { ProfileStatsShape } from "./types";

type Props = {
  stats: ProfileStatsShape;
  postedJobsCount: number;
  workedJobsCount: number;
  isOwnProfile: boolean;
  showReviews: boolean;
  showPostedJobs: boolean;
  showWorkedJobs: boolean;
  onToggleReviews: () => void;
  onTogglePosted: () => void;
  onToggleWorked: () => void;
};

export const ProfileStatsGrid = ({
  stats,
  postedJobsCount,
  workedJobsCount,
  isOwnProfile,
  showReviews,
  showPostedJobs,
  showWorkedJobs,
  onToggleReviews,
  onTogglePosted,
  onToggleWorked,
}: Props) => {
  const activeSection = showReviews ? "reviews" : showPostedJobs ? "posted" : showWorkedJobs ? "worked" : null;
  const hasSelection = activeSection !== null && !isOwnProfile;

  const reviewBtn = (
    <button
      key="reviews"
      onClick={onToggleReviews}
      className={`rounded-ds-md border bg-card p-3 text-center transition-all cursor-pointer hover:border-primary/30 hover:shadow-sm ${showReviews ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
    >
      <div className="flex items-center justify-center gap-1">
        <Star className="w-3.5 h-3.5 text-primary fill-primary" />
        <p className="text-ds-20 font-bold text-foreground">{stats.avgRating > 0 ? stats.avgRating.toFixed(1) : "—"}</p>
      </div>
      <p className="text-muted-foreground text-ds-11">{stats.reviewCount} Review{stats.reviewCount !== 1 ? "s" : ""}</p>
    </button>
  );

  const postedBtn = (
    <button
      key="posted"
      onClick={() => {
        if (postedJobsCount > 0) {
          onTogglePosted();
        }
      }}
      className={`rounded-ds-md border bg-card p-3 text-center transition-all ${postedJobsCount > 0 ? "cursor-pointer hover:border-primary/30 hover:shadow-sm" : ""} ${showPostedJobs ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
    >
      <div className="flex items-center justify-center gap-1">
        <ClipboardList className="w-3.5 h-3.5 text-primary" />
        <p className="text-ds-20 font-bold text-foreground">{postedJobsCount}</p>
      </div>
      <p className="text-muted-foreground text-ds-11">Posted</p>
    </button>
  );

  const workedBtn = (
    <button
      key="worked"
      onClick={() => {
        if (workedJobsCount > 0) {
          onToggleWorked();
        }
      }}
      className={`rounded-ds-md border bg-card p-3 text-center transition-all ${workedJobsCount > 0 ? "cursor-pointer hover:border-primary/30 hover:shadow-sm" : ""} ${showWorkedJobs ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
    >
      <div className="flex items-center justify-center gap-1">
        <Hammer className="w-3.5 h-3.5 text-primary" />
        <p className="text-ds-20 font-bold text-foreground">{workedJobsCount}</p>
      </div>
      <p className="text-muted-foreground text-ds-11">Completed</p>
    </button>
  );

  if (isOwnProfile) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {reviewBtn}
        {postedBtn}
        {workedBtn}
      </div>
    );
  }

  // For other users: show only the selected button, or all if none selected
  if (hasSelection) {
    return (
      <div className="grid grid-cols-1 gap-2">
        {activeSection === "reviews" && reviewBtn}
        {activeSection === "posted" && postedBtn}
        {activeSection === "worked" && workedBtn}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {reviewBtn}
      {postedBtn}
      {workedBtn}
    </div>
  );
};
