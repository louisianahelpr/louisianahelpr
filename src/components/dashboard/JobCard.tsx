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
      className={`group relative rounded-2xl border bg-card transition-all duration-200 cursor-pointer hover:shadow-[var(--card-hover-shadow)] hover:-translate-y-0.5 overflow-hidden ${
        job.isBoosted
          ? "border-primary/30 ring-1 ring-primary/10"
          : job.is_urgent
          ? "border-accent/30"
          : "border-border hover:border-primary/20"
      }`}
      onClick={() => onSelect(job)}
    >
      {/* Top bar: category + tags + earnings */}
      <div className={`flex items-center justify-between px-4 py-2 border-b border-border/50 ${
        job.isBoosted ? "bg-primary/5" : job.is_urgent ? "bg-accent/5" : "bg-muted/30"
      }`}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${catColor}`}>
            {categoryLabels[job.category] || job.category}
          </span>
          {job.is_urgent && (
            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-accent/15 text-accent-foreground text-[10px] font-bold uppercase tracking-wider">
              <Zap className="w-2.5 h-2.5 text-accent fill-accent" /> Urgent
            </span>
          )}
          {job.isBoosted && (
            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider">
              <Rocket className="w-2.5 h-2.5" /> Boosted
            </span>
          )}
        </div>
        <span className="flex items-center gap-0.5 font-bold text-primary text-sm shrink-0">
          <DollarSign className="w-3.5 h-3.5" />{earnings}
        </span>
      </div>

      {/* Main content */}
      <div className="px-4 py-3 space-y-2">
        {/* Title + Apply */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground text-[15px] leading-snug group-hover:text-primary transition-colors">
              {job.title}
            </h3>
            {job.description.trim().toLowerCase() !== job.title.trim().toLowerCase() && (
              <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">{job.description}</p>
            )}
          </div>
          {showApply && currentUserId !== job.customer_id && (
            <div className="flex flex-col gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
              <Button
                size="sm"
                onClick={() => onApply(job.id)}
                className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-sm gap-1 h-8 text-xs"
              >
                Apply <ArrowRight className="w-3 h-3" />
              </Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-7" onClick={() => onReport(job.id)}>
                <Flag className="w-3 h-3" />
              </Button>
            </div>
          )}
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <a
            href={job.latitude && job.longitude
              ? `https://www.google.com/maps?q=${job.latitude},${job.longitude}`
              : `https://www.google.com/maps/search/${encodeURIComponent(job.location)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors truncate"
          >
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{job.location}</span>
          </a>
          {job.special_requirements?.includes("[Flexible date]") ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Calendar className="w-3 h-3 shrink-0" /> Flexible date
            </span>
          ) : (
            <a
              href={`https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(job.title)}&dates=${new Date(job.date_needed).toISOString().replace(/[-:]/g, '').split('T')[0]}/${new Date(job.date_needed).toISOString().replace(/[-:]/g, '').split('T')[0]}&details=${encodeURIComponent(job.description)}&location=${encodeURIComponent(job.location)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors"
            >
              <Calendar className="w-3 h-3 shrink-0" />
              {new Date(job.date_needed).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
            </a>
          )}
          {job.start_time && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="w-3 h-3 shrink-0" />
              {job.start_time === "flexible"
                ? "Flexible time"
                : new Date(`2000-01-01T${job.start_time}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          {job.expires_at ? (
            <span className={`flex items-center gap-1.5 ${
              differenceInHours(new Date(job.expires_at), new Date()) < 24
                ? "text-destructive font-medium"
                : "text-muted-foreground"
            }`}>
              <Timer className="w-3 h-3 shrink-0" />
              {new Date(job.expires_at) <= new Date()
                ? "Expired"
                : `Expires ${formatDistanceToNow(new Date(job.expires_at), { addSuffix: true })}`}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Timer className="w-3 h-3 shrink-0" /> No expiry
            </span>
          )}
        </div>
      </div>

      {/* Footer: poster info */}
      <div className="px-4 py-2 border-t border-border/50 bg-muted/20 flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
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
            <Star className="w-2.5 h-2.5 fill-accent text-accent" />
            <span className="font-medium text-accent-foreground">{job.posterAvgRating?.toFixed(1)}</span>
            <span className="text-muted-foreground">({job.posterReviewCount})</span>
          </span>
        )}
        {job.photos && job.photos.length > 0 && (
          <span className="flex items-center gap-0.5">
            <ImageIcon className="w-2.5 h-2.5" /> {job.photos.length} photo{job.photos.length > 1 ? "s" : ""}
          </span>
        )}
        {job.is_group_job && (
          <span className="flex items-center gap-0.5">
            👥 Group · {job.helpers_needed}
          </span>
        )}
        <HelperBadges badges={posterBadges} />
      </div>
    </motion.div>
  );
};

export default JobCard;
