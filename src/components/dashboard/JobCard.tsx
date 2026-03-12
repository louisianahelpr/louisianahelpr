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

const categoryColors: Record<string, { badge: string; title: string; accent: string }> = {
  cleaning: { badge: "bg-sky-50 text-sky-700 border-sky-200/60", title: "text-sky-700", accent: "from-sky-400/10 to-sky-500/5" },
  yard_work: { badge: "bg-emerald-50 text-emerald-700 border-emerald-200/60", title: "text-emerald-700", accent: "from-emerald-400/10 to-emerald-500/5" },
  moving: { badge: "bg-violet-50 text-violet-700 border-violet-200/60", title: "text-violet-700", accent: "from-violet-400/10 to-violet-500/5" },
  errands: { badge: "bg-amber-50 text-amber-700 border-amber-200/60", title: "text-amber-700", accent: "from-amber-400/10 to-amber-500/5" },
  handyman: { badge: "bg-orange-50 text-orange-700 border-orange-200/60", title: "text-orange-700", accent: "from-orange-400/10 to-orange-500/5" },
  painting: { badge: "bg-pink-50 text-pink-700 border-pink-200/60", title: "text-pink-700", accent: "from-pink-400/10 to-pink-500/5" },
  delivery: { badge: "bg-indigo-50 text-indigo-700 border-indigo-200/60", title: "text-indigo-700", accent: "from-indigo-400/10 to-indigo-500/5" },
  pet_care: { badge: "bg-rose-50 text-rose-700 border-rose-200/60", title: "text-rose-700", accent: "from-rose-400/10 to-rose-500/5" },
  assembly: { badge: "bg-teal-50 text-teal-700 border-teal-200/60", title: "text-teal-700", accent: "from-teal-400/10 to-teal-500/5" },
  other: { badge: "bg-slate-50 text-slate-700 border-slate-200/60", title: "text-slate-700", accent: "from-slate-400/10 to-slate-500/5" },
};

const JobCard = ({ job, effectiveFee, currentUserId, showApply = true, onApply, onReport, onSelect, index = 0 }: JobCardProps) => {
  const posterBadges = computeBadges({
    avgRating: job.posterAvgRating || 0,
    reviewCount: job.posterReviewCount || 0,
    completedJobs: job.posterCompletedJobs || 0,
  });

  const earnings = (job.budget * (1 - effectiveFee / 100)).toFixed(2);
  const catStyle = categoryColors[job.category] || categoryColors.other;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.07, 0.5), ease: [0.25, 0.46, 0.45, 0.94] }}
      whileHover={{ y: -3 }}
      className={`group relative rounded-2xl border bg-card cursor-pointer overflow-hidden transition-shadow duration-300 ${
        job.isBoosted
          ? "border-primary/30 ring-1 ring-primary/10 shadow-[0_4px_20px_-4px_hsl(158_45%_42%/0.12)]"
          : job.is_urgent
          ? "border-accent/30 shadow-[var(--card-shadow)]"
          : "border-border/60 shadow-[var(--card-shadow)] hover:shadow-[var(--card-hover-shadow)] hover:border-primary/20"
      }`}
      onClick={() => onSelect(job)}
    >
      {/* Top bar: title + earnings — matches footer style */}
      <div className="px-4 py-2 border-b border-border/40 bg-muted/15 flex items-center justify-between">
        <h3 className={`font-bold text-[15px] leading-snug truncate min-w-0 ${catStyle.title}`}>
          {job.title}
        </h3>
        <span className="flex items-center gap-0.5 font-bold text-primary text-sm shrink-0 ml-3">
          <DollarSign className="w-3.5 h-3.5" />{earnings}
        </span>
      </div>

      {/* Main content */}
      <div className="px-4 py-3 space-y-2.5">
        {/* Tags + Apply */}
        <div>
          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
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
          {job.description.trim().toLowerCase() !== job.title.trim().toLowerCase() && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{job.description}</p>
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
              href="/schedule"
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

      {/* Footer: poster info + category */}
      <div className="px-4 py-2 border-t border-border/40 bg-muted/15 flex items-center justify-between text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
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
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border shrink-0 ${catStyle.badge}`}>
          {categoryLabels[job.category] || job.category}
        </span>
      </div>
    </motion.div>
  );
};

export default JobCard;
