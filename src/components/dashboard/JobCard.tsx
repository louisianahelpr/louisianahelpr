import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MapPin, Calendar, DollarSign, Flag, Star, ImageIcon, Zap, Rocket,
} from "lucide-react";
import { computeBadges, HelperBadges } from "@/components/HelperBadges";
import { categoryLabels } from "./JobFilters";
import type { EnrichedJob } from "./types";

interface JobCardProps {
  job: EnrichedJob;
  effectiveFee: number;
  currentUserId?: string;
  showApply?: boolean;
  onApply: (jobId: string) => void;
  onReport: (jobId: string) => void;
  onSelect: (job: EnrichedJob) => void;
}

const JobCard = ({ job, effectiveFee, currentUserId, showApply = true, onApply, onReport, onSelect }: JobCardProps) => {
  const posterBadges = computeBadges({
    avgRating: job.posterAvgRating || 0,
    reviewCount: job.posterReviewCount || 0,
    completedJobs: job.posterCompletedJobs || 0,
  });

  return (
    <div
      className={`rounded-xl border bg-card p-4 hover:shadow-md transition-shadow cursor-pointer ${job.isBoosted ? "border-primary/40 ring-1 ring-primary/20" : "border-border"}`}
      onClick={() => onSelect(job)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            {job.is_urgent && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 text-accent-foreground text-[10px] font-semibold">
                <Zap className="w-3 h-3 text-accent" /> Urgent
              </span>
            )}
            {job.isBoosted && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold">
                <Rocket className="w-3 h-3" /> Boosted
              </span>
            )}
            <h3 className="font-semibold text-foreground">{job.title}</h3>
            <Badge variant="secondary" className="text-xs">{categoryLabels[job.category] || job.category}</Badge>
            {job.photos && job.photos.length > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <ImageIcon className="w-3 h-3" /> {job.photos.length}
              </span>
            )}
            {job.is_group_job && (
              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-accent/20 text-accent-foreground text-[10px] font-semibold">
                👥 Group · {job.helpers_needed} needed
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2">{job.description}</p>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(job.date_needed).toLocaleDateString()}</span>
            <span className="flex items-center gap-1 font-medium text-primary"><DollarSign className="w-3 h-3" /> You earn ${(job.budget * (1 - effectiveFee / 100)).toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 flex-wrap">
            <span>Posted by <a href={`/user/${job.customer_id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-primary hover:underline">{job.posterName}</a></span>
            {(job.posterReviewCount ?? 0) > 0 && (
              <span className="flex items-center gap-0.5">
                <Star className="w-3 h-3 fill-accent text-accent" />
                {job.posterAvgRating?.toFixed(1)} ({job.posterReviewCount})
              </span>
            )}
            <HelperBadges badges={posterBadges} />
          </div>
        </div>
        {showApply && currentUserId !== job.customer_id && (
          <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" onClick={() => onApply(job.id)}>Apply</Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => onReport(job.id)}>
              <Flag className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default JobCard;
