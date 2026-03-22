import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MapPin, Calendar, DollarSign, Clock, Star, Flag, Rocket,
} from "lucide-react";
import { computeBadges, HelperBadges } from "@/components/HelperBadges";
import { categoryLabels } from "./JobFilters";
import { getCityState } from "@/lib/locationUtils";
import type { EnrichedJob } from "./types";

interface JobDetailDialogProps {
  job: EnrichedJob | null;
  effectiveFee: number;
  onClose: () => void;
  onApply: (jobId: string) => void;
  onReport: (jobId: string) => void;
}

const JobDetailDialog = ({ job, effectiveFee, onClose, onApply, onReport }: JobDetailDialogProps) => {
  if (!job) return null;

  const photos = job.photos || [];
  const posterBadges = computeBadges({
    avgRating: job.posterAvgRating || 0,
    reviewCount: job.posterReviewCount || 0,
    completedJobs: job.posterCompletedJobs || 0,
  });

  return (
    <Dialog open={!!job} onOpenChange={() => onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{job.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {job.isBoosted && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
              <Rocket className="w-3 h-3" /> Boosted Post
            </span>
          )}

          {photos.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {photos.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                  <img src={url} alt={`Photo ${i + 1}`} className="w-32 h-24 rounded-lg object-cover border border-border hover:border-primary transition-colors" />
                </a>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary">{categoryLabels[job.category] || job.category}</Badge>
            <span className="text-xs text-muted-foreground">Posted {new Date(job.created_at).toLocaleDateString()}</span>
          </div>

          <p className="text-sm text-foreground">{job.description}</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-secondary/30 p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" /> You Earn</p>
              <p className="font-semibold text-primary">${(job.budget * (1 - effectiveFee / 100) - (job.budget * effectiveFee / 100 * 0.085)).toFixed(2)}</p>
            </div>
            <div className="rounded-lg bg-secondary/30 p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" /> Location</p>
              <p className="font-semibold text-foreground">{getCityState(job.location)}</p>
            </div>
            <div className="rounded-lg bg-secondary/30 p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" /> Date Needed</p>
              <p className="font-semibold text-foreground">{new Date(job.date_needed).toLocaleDateString()}</p>
            </div>
            {job.start_time && (
              <div className="rounded-lg bg-secondary/30 p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Start Time</p>
                <p className="font-semibold text-foreground">{job.start_time}</p>
              </div>
            )}
            {job.estimated_hours && (
              <div className="rounded-lg bg-secondary/30 p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Est. Hours</p>
                <p className="font-semibold text-foreground">{job.estimated_hours}h</p>
              </div>
            )}
          </div>

          {job.special_requirements && (
            <div className="rounded-lg bg-secondary/30 p-3">
              <p className="text-xs text-muted-foreground mb-1">Special Requirements</p>
              <p className="text-sm text-foreground">{job.special_requirements}</p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-border flex-wrap">
            <span className="text-sm text-muted-foreground">
              Posted by <a href={`/user/${job.customer_id}`} className="font-medium text-primary hover:underline">{job.posterName}</a>
            </span>
            <a href={`/user/${job.customer_id}`} className="flex items-center gap-0.5 text-sm hover:underline">
              <Star className={`w-3.5 h-3.5 ${(job.posterReviewCount ?? 0) > 0 ? "fill-accent text-accent" : "text-muted-foreground/50"}`} />
              <span className={`font-medium ${(job.posterReviewCount ?? 0) > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                {(job.posterReviewCount ?? 0) > 0 ? job.posterAvgRating?.toFixed(1) : "0.0"}
              </span>
              <span className="text-muted-foreground">({job.posterReviewCount ?? 0})</span>
            </a>
            <HelperBadges badges={posterBadges} />
          </div>

          <div className="flex gap-2 pt-2">
            <Button className="flex-1" onClick={() => { onApply(job.id); onClose(); }}>
              Apply for this task
            </Button>
            <Button variant="outline" size="icon" onClick={() => { onReport(job.id); onClose(); }}>
              <Flag className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default JobDetailDialog;
