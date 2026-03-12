import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MapPin, Calendar, DollarSign, Flag, Star, ImageIcon, Zap, Rocket, ArrowRight, Clock, Timer,
} from "lucide-react";
import { formatDistanceToNow, differenceInHours } from "date-fns";
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
  index?: number;
}

const categoryColors: Record<string, string> = {
  cleaning: "bg-sky-100 text-sky-700 border-sky-200",
  yard_work: "bg-emerald-100 text-emerald-700 border-emerald-200",
  moving: "bg-violet-100 text-violet-700 border-violet-200",
  errands: "bg-amber-100 text-amber-700 border-amber-200",
  handyman: "bg-orange-100 text-orange-700 border-orange-200",
  painting: "bg-pink-100 text-pink-700 border-pink-200",
  delivery: "bg-indigo-100 text-indigo-700 border-indigo-200",
  pet_care: "bg-rose-100 text-rose-700 border-rose-200",
  assembly: "bg-teal-100 text-teal-700 border-teal-200",
  other: "bg-slate-100 text-slate-700 border-slate-200",
};

const JobCard = ({ job, effectiveFee, currentUserId, showApply = true, onApply, onReport, onSelect, index = 0 }: JobCardProps) => {
  const posterBadges = computeBadges({
    avgRating: job.posterAvgRating || 0,
    reviewCount: job.posterReviewCount || 0,
    completedJobs: job.posterCompletedJobs || 0,
  });

  const earnings = (job.budget * (1 - effectiveFee / 100)).toFixed(2);
  const catColor = categoryColors[job.category] || categoryColors.other;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.06, 0.5), ease: "easeOut" }}
      className={`group relative rounded-2xl border bg-card p-4 transition-all duration-200 cursor-pointer hover:shadow-[var(--card-hover-shadow)] hover:-translate-y-0.5 ${
        job.isBoosted
          ? "border-primary/30 bg-gradient-to-br from-primary/5 to-transparent ring-1 ring-primary/10"
          : job.is_urgent
          ? "border-accent/30 bg-gradient-to-br from-accent/5 to-transparent"
          : "border-border hover:border-primary/20"
      }`}
      onClick={() => onSelect(job)}
    >
      {/* Top accent line for boosted/urgent */}
      {(job.isBoosted || job.is_urgent) && (
        <div className={`absolute top-0 left-4 right-4 h-0.5 rounded-b-full ${job.isBoosted ? "bg-gradient-to-r from-primary/60 via-primary to-primary/60" : "bg-gradient-to-r from-accent/60 via-accent to-accent/60"}`} />
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2.5 min-w-0">
          {/* Tags row */}
          <div className="flex items-center gap-2 flex-wrap">
            {job.is_urgent && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-accent/20 to-accent/10 text-accent-foreground text-[10px] font-bold uppercase tracking-wider border border-accent/20">
                <Zap className="w-3 h-3 text-accent fill-accent" /> Urgent
              </span>
            )}
            {job.isBoosted && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-primary/15 to-primary/5 text-primary text-[10px] font-bold uppercase tracking-wider border border-primary/20">
                <Rocket className="w-3 h-3" /> Boosted
              </span>
            )}
            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${catColor}`}>
              {categoryLabels[job.category] || job.category}
            </span>
            {job.photos && job.photos.length > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <ImageIcon className="w-3 h-3" /> {job.photos.length}
              </span>
            )}
            {job.is_group_job && (
              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold border border-violet-200">
                👥 Group · {job.helpers_needed}
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="font-semibold text-foreground text-base group-hover:text-primary transition-colors">{job.title}</h3>

          {/* Description (hide if same as title) */}
          {job.description.trim().toLowerCase() !== job.title.trim().toLowerCase() && (
            <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">{job.description}</p>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            <a
              href={job.latitude && job.longitude
                ? `https://www.google.com/maps?q=${job.latitude},${job.longitude}`
                : `https://www.google.com/maps/search/${encodeURIComponent(job.location)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors underline-offset-2 hover:underline"
            >
              <MapPin className="w-3.5 h-3.5" /> {job.location}
            </a>
            <a
              href={`https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(job.title)}&dates=${new Date(job.date_needed).toISOString().replace(/[-:]/g, '').split('T')[0]}/${new Date(job.date_needed).toISOString().replace(/[-:]/g, '').split('T')[0]}&details=${encodeURIComponent(job.description)}&location=${encodeURIComponent(job.location)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors underline-offset-2 hover:underline"
            >
              <Calendar className="w-3.5 h-3.5" /> {new Date(job.date_needed).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
            </a>
            <span className="flex items-center gap-1 font-bold text-primary">
              <DollarSign className="w-3.5 h-3.5" />
              <span className="text-sm">${earnings}</span>
              <span className="text-muted-foreground font-normal">earnings</span>
            </span>
          </div>

          {/* Posted & Expires row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3 h-3" /> Posted {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
            </span>
            {job.expires_at && (
              <span className={`flex items-center gap-1 ${
                differenceInHours(new Date(job.expires_at), new Date()) < 24
                  ? "text-destructive font-medium"
                  : "text-muted-foreground"
              }`}>
                <Timer className="w-3 h-3" />
                {new Date(job.expires_at) <= new Date()
                  ? "Expired"
                  : `Expires ${formatDistanceToNow(new Date(job.expires_at), { addSuffix: true })}`}
              </span>
            )}
          </div>

          {/* Poster info */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-0.5 flex-wrap">
            <span>
              by{" "}
              <a
                href={`/user/${job.customer_id}`}
                onClick={(e) => e.stopPropagation()}
                className="font-semibold text-foreground hover:text-primary transition-colors"
              >
                {job.posterName}
              </a>
            </span>
            {(job.posterReviewCount ?? 0) > 0 && (
              <span className="flex items-center gap-0.5 bg-accent/10 px-1.5 py-0.5 rounded-full">
                <Star className="w-3 h-3 fill-accent text-accent" />
                <span className="font-medium text-accent-foreground">{job.posterAvgRating?.toFixed(1)}</span>
                <span className="text-muted-foreground">({job.posterReviewCount})</span>
              </span>
            )}
            <HelperBadges badges={posterBadges} />
          </div>
        </div>

        {/* Action buttons */}
        {showApply && currentUserId !== job.customer_id && (
          <div className="flex flex-col gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              onClick={() => onApply(job.id)}
              className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-sm gap-1"
            >
              Apply <ArrowRight className="w-3 h-3" />
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => onReport(job.id)}>
              <Flag className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default JobCard;
