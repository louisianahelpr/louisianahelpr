import { Star, ClipboardList, Hammer } from "lucide-react";
import type { ProfileStatsShape } from "./types";

type Props = {
  stats: ProfileStatsShape;
  postedJobsCount: number;
  workedJobsCount: number;
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
  showReviews,
  showPostedJobs,
  showWorkedJobs,
  onToggleReviews,
  onTogglePosted,
  onToggleWorked,
}: Props) => {
  const activeSection = showReviews ? "reviews" : showPostedJobs ? "posted" : showWorkedJobs ? "worked" : null;
  // No `&& !isOwnProfile` (owner, 2026-08-27: "make Preview truly public").
  // The owner used to get a permanently 3-up grid while every visitor got a
  // grid that collapsed to the one selected tile — so the preview showed a
  // layout no stranger has ever seen. One behaviour for everyone now.
  const hasSelection = activeSection !== null;

  // Radius now matches the `rounded-2xl` card convention, but these three
  // deliberately keep `border bg-card p-3` instead of `liquid-glass p-5`:
  // they're compact 3-across toggle tiles whose selected state IS the border
  // colour, and `.liquid-glass` re-declares the `border` shorthand after
  // Tailwind's utilities — it would override `border-primary/30` and erase
  // the selection affordance. p-5 would also blow the 3-column grid out on
  // phones.

  const reviewBtn = (
    <button
      key="reviews"
      onClick={onToggleReviews}
      className={`rounded-2xl border bg-card p-3 text-center transition-all cursor-pointer hover:border-primary/30 hover:shadow-sm ${showReviews ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
    >
      <div className="flex items-center justify-center gap-1">
        <Star className="w-3.5 h-3.5 text-primary fill-primary" />
        <p className="text-ds-20 font-bold text-foreground">{stats.avgRating > 0 ? stats.avgRating.toFixed(1) : "—"}</p>
      </div>
      <p className="text-muted-foreground text-ds-11">{stats.reviewCount} Review{stats.reviewCount !== 1 ? "s" : ""}</p>
    </button>
  );

  // `disabled` rather than a guarded no-op onClick: with nothing to expand,
  // the tile used to stay keyboard-focusable and tappable while doing
  // nothing — an affordance that leads nowhere. Disabling removes it from
  // the tab order and lets assistive tech say so. Deliberately no
  // `disabled:opacity-*`: these are stat tiles first, toggles second, so the
  // number must stay just as legible at zero.
  const postedBtn = (
    <button
      key="posted"
      disabled={postedJobsCount === 0}
      onClick={onTogglePosted}
      className={`rounded-2xl border bg-card p-3 text-center transition-all ${postedJobsCount > 0 ? "cursor-pointer hover:border-primary/30 hover:shadow-sm" : ""} ${showPostedJobs ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
    >
      <div className="flex items-center justify-center gap-1">
        <ClipboardList className="w-3.5 h-3.5 text-primary" />
        <p className="text-ds-20 font-bold text-foreground">{postedJobsCount}</p>
      </div>
      <p className="text-muted-foreground text-ds-11">Posted</p>
    </button>
  );

  // Same treatment as postedBtn above — identical inert-focusable defect.
  const workedBtn = (
    <button
      key="worked"
      disabled={workedJobsCount === 0}
      onClick={onToggleWorked}
      className={`rounded-2xl border bg-card p-3 text-center transition-all ${workedJobsCount > 0 ? "cursor-pointer hover:border-primary/30 hover:shadow-sm" : ""} ${showWorkedJobs ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
    >
      <div className="flex items-center justify-center gap-1">
        <Hammer className="w-3.5 h-3.5 text-primary" />
        <p className="text-ds-20 font-bold text-foreground">{workedJobsCount}</p>
      </div>
      <p className="text-muted-foreground text-ds-11">Completed</p>
    </button>
  );

  // Show only the selected button, or all if none selected
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
