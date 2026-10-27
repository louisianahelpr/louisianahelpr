import { Award } from "lucide-react";
import { TOP_HELPR, isTopHelpr, type HelperTierStats } from "@/lib/helperTier";

export const TOP_HELPR_LABEL = "Top Helpr";
export const TOP_HELPR_DESCRIPTION = `Earned with ${TOP_HELPR.completedJobs}+ completed jobs, ${TOP_HELPR.reviewCount}+ reviews and a ${TOP_HELPR.avgRating}+ star rating as a Helpr.`;

/** The small "Top Helpr" chip on an applicant card (owner 2026-10-27); renders nothing unless earned. */
export function TopHelprChip({ stats }: { stats?: Pick<HelperTierStats, "completedJobs" | "avgRating" | "reviewCount"> }) {
  if (stats && !isTopHelpr(stats)) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-ds-11 font-semibold text-foreground"
      title={TOP_HELPR_DESCRIPTION}
      data-top-helpr=""
    >
      <Award className="h-3 w-3 text-primary" aria-hidden />
      {TOP_HELPR_LABEL}
    </span>
  );
}
