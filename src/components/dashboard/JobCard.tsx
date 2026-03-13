import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MapPin, Calendar, DollarSign, Flag, Star, ImageIcon, Zap, Rocket, Clock, Timer, Send, Users, Repeat,
} from "lucide-react";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import { computeBadges, HelperBadges } from "@/components/HelperBadges";
import { categoryLabels } from "./JobFilters";
import { getCityState } from "@/lib/locationUtils";
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
  isExpanded?: boolean;
  onToggleExpand?: (jobId: string) => void;
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

const JobCard = ({ job, effectiveFee, currentUserId, showApply = true, onApply, onReport, onSelect, index = 0, isExpanded = false, onToggleExpand }: JobCardProps) => {

  const posterBadges = computeBadges({
    avgRating: job.posterAvgRating || 0,
    reviewCount: job.posterReviewCount || 0,
    completedJobs: job.posterCompletedJobs || 0,
  });

  const earnings = (job.budget * (1 - effectiveFee / 100)).toFixed(2);
  const urgentTip = job.urgent_fee ?? 0;
  const catStyle = categoryColors[job.category] || categoryColors.other;
  const isOwnJob = currentUserId === job.customer_id;
  const photos = job.photos || [];

  // Parse city/state from location string (e.g. "Baton Rouge, LA" or "123 Main St, Baton Rouge, LA 70801")
  const locationParts = job.location.split(",").map(s => s.trim());
  let cityState = job.location;
  if (locationParts.length >= 2) {
    const state = locationParts[locationParts.length - 1].replace(/\d{5}(-\d{4})?/, "").trim();
    const city = locationParts[locationParts.length - 2];
    cityState = `${city}, ${state}`;
  }

  // Format start time
  const formattedTime = job.start_time
    ? job.start_time === "flexible"
      ? "Flexible"
      : new Date(`2000-01-01T${job.start_time}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : null;

  // Expiry info
  const expiryText = job.expires_at
    ? new Date(job.expires_at) <= new Date()
      ? "Expired"
      : formatDistanceToNow(new Date(job.expires_at), { addSuffix: false }) + " left"
    : null;
  const isExpiringSoon = job.expires_at && differenceInHours(new Date(job.expires_at), new Date()) < 24;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.07, 0.5), ease: [0.25, 0.46, 0.45, 0.94] }}
      className={`group relative rounded-2xl border bg-card overflow-hidden transition-shadow duration-300 cursor-pointer ${
        job.isBoosted
          ? "border-primary/30 ring-1 ring-primary/10 shadow-[0_4px_20px_-4px_hsl(158_45%_42%/0.12)]"
          : job.is_urgent
          ? "border-accent/30 shadow-[var(--card-shadow)]"
          : isExpanded
          ? "border-primary/30 shadow-[var(--card-hover-shadow)]"
          : "border-border/60 shadow-[var(--card-shadow)] hover:shadow-[var(--card-hover-shadow)] hover:border-primary/20"
      }`}
      onClick={() => onToggleExpand?.(job.id)}
    >
      {/* Header: title + price */}
      <div className="w-full px-4 py-2 border-b border-border/40 bg-muted/15 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className={`font-bold text-[15px] leading-snug min-w-0 ${catStyle.title} ${isExpanded ? "" : "truncate"}`}>
            {job.title}
          </h3>
          {job.is_urgent && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-accent/15 text-accent-foreground text-[9px] font-bold uppercase tracking-wider shrink-0">
              <Zap className="w-2.5 h-2.5 text-accent fill-accent" /> Urgent
            </span>
          )}
          {job.isBoosted && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[9px] font-bold uppercase tracking-wider shrink-0">
              <Rocket className="w-2.5 h-2.5" /> Boosted
            </span>
          )}
        </div>
        <span className="flex items-center gap-0.5 font-bold text-primary text-sm shrink-0">
          <DollarSign className="w-3.5 h-3.5" />{earnings}{urgentTip > 0 && <span className="text-accent ml-0.5">+${Number(urgentTip).toFixed(0)}</span>}
        </span>
      </div>

      {/* Always-visible summary: date, time, city/state, expiry */}
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
          {/* Date */}
          {job.special_requirements?.includes("[Flexible date]") ? (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3 shrink-0" /> Flexible date
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3 shrink-0" />
              {new Date(job.date_needed).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
          )}
          {/* Time */}
          {formattedTime && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3 shrink-0" /> {formattedTime}
            </span>
          )}
          {/* City, State */}
          <a
            onClick={(e) => e.stopPropagation()}
            href={job.latitude && job.longitude
              ? `https://www.google.com/maps?q=${job.latitude},${job.longitude}`
              : `https://www.google.com/maps/search/${encodeURIComponent(job.location)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-primary transition-colors"
          >
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate max-w-[140px]">{cityState}</span>
          </a>
          {/* Expiry */}
          {expiryText && (
            <span className={`flex items-center gap-1 ${isExpiringSoon ? "text-destructive font-medium" : ""}`}>
              <Timer className="w-3 h-3 shrink-0" /> {expiryText}
            </span>
          )}
          {/* Category badge - always visible */}
          <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border shrink-0 ${catStyle.badge}`}>
            {categoryLabels[job.category] || job.category}
          </span>
        </div>
      </div>

      {/* Expandable section */}
      <div className={`overflow-hidden transition-all duration-200 ease-in-out ${isExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`}>
        <div className="px-4 pb-4 space-y-3 border-t border-border/40">
          {/* Description */}
          {job.description.trim().toLowerCase() !== job.title.trim().toLowerCase() && (
            <div className="pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Description</p>
              <p className="text-sm text-foreground leading-relaxed">{job.description}</p>
            </div>
          )}

          {/* Photos */}
          {photos.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Photos</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {photos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                    <img src={url} alt={`Photo ${i + 1}`} className="w-28 h-20 rounded-lg object-cover border border-border hover:border-primary transition-colors" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Details grid */}
          {job.estimated_hours && (
            <div className="rounded-lg bg-secondary/30 p-2.5">
              <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Est. Hours</p>
              <p className="font-semibold text-foreground text-sm">{job.estimated_hours}h</p>
            </div>
          )}

          {/* Special requirements */}
          {job.special_requirements && (
            <div className="rounded-lg bg-secondary/30 p-2.5">
              <p className="text-[10px] text-muted-foreground mb-1">Special Requirements</p>
              <p className="text-sm text-foreground">{job.special_requirements}</p>
            </div>
          )}

          {/* Recurring info */}
          {job.is_recurring && (
            <div className="rounded-lg bg-secondary/30 p-2.5 flex items-start gap-2">
              <Repeat className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] text-muted-foreground">Recurring Task</p>
                <p className="text-sm font-medium text-foreground">
                  {job.recurrence_interval ? `Every ${job.recurrence_interval}` : "Yes"}
                  {job.recurrence_end_date && ` until ${new Date(job.recurrence_end_date).toLocaleDateString()}`}
                </p>
              </div>
            </div>
          )}

          {/* Group job info */}
          {job.is_group_job && (
            <div className="rounded-lg bg-secondary/30 p-2.5 flex items-start gap-2">
              <Users className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] text-muted-foreground">Group Task</p>
                <p className="text-sm font-medium text-foreground">
                  {job.helpers_needed ? `${job.helpers_needed} helpers needed` : "Multiple helpers needed"}
                </p>
              </div>
            </div>
          )}

          {/* Apply + Flag */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); onReport(job.id); }}>
              <Flag className="w-4 h-4" />
            </Button>
            {!isOwnJob && (
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={(e) => { e.stopPropagation(); onApply(job.id); }}>
                <Send className="w-4 h-4 mr-1" /> Apply
              </Button>
            )}
          </div>

          {/* Poster info */}
          <div className="flex items-center gap-2 pt-2 border-t border-border/40 flex-wrap">
            <span className="text-xs text-muted-foreground">
              Posted by <a href={`/user/${job.customer_id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-primary hover:underline">{job.posterName}</a>
            </span>
            {(job.posterReviewCount ?? 0) > 0 && (
              <span className="flex items-center gap-0.5 text-xs">
                <Star className="w-3 h-3 fill-accent text-accent" />
                <span className="text-foreground font-medium">{job.posterAvgRating?.toFixed(1)}</span>
                <span className="text-muted-foreground">({job.posterReviewCount})</span>
              </span>
            )}
            <HelperBadges badges={posterBadges} />
          </div>
        </div>
      </div>

      {/* Collapsed footer */}
      {!isExpanded && (
        <div className="px-4 py-2 border-t border-border/40 bg-muted/15 flex items-center justify-between text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span>
              by{" "}
              <a href={`/user/${job.customer_id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-foreground hover:text-primary transition-colors">
                {job.posterName}
              </a>
            </span>
            {(job.posterReviewCount ?? 0) > 0 && (
              <span className="flex items-center gap-0.5 bg-accent/10 px-1.5 py-0.5 rounded-full">
                <Star className="w-2.5 h-2.5 fill-accent text-accent" />
                <span className="font-medium text-accent-foreground">{job.posterAvgRating?.toFixed(1)}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default JobCard;
