import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  MapPin, Calendar, DollarSign, Flag, Star, Zap, Rocket, Clock, Timer, Send, Users, Repeat, Bookmark,
} from "lucide-react";
import { formatDistanceToNow, differenceInHours } from "date-fns";

import { categoryLabels } from "./JobFilters";
import { parseLocalDate } from "@/lib/dateUtils";
import { getCityState } from "@/lib/locationUtils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
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
  isSaved?: boolean;
  onToggleSave?: (jobId: string, saved: boolean) => void;
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

const JobCard = ({ job, effectiveFee, currentUserId, showApply: _showApply = true, onApply, onReport, onSelect: _onSelect, index = 0, isExpanded = false, onToggleExpand, isSaved = false, onToggleSave }: JobCardProps) => {
  const [savingBookmark, setSavingBookmark] = useState(false);

  const handleToggleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId) { toast.error("Please log in to save jobs"); return; }
    if (savingBookmark) return;
    setSavingBookmark(true);
    try {
      if (isSaved) {
        await supabase.from("saved_jobs").delete().eq("user_id", currentUserId).eq("job_id", job.id);
        toast.success("Removed from saved jobs");
      } else {
        await supabase.from("saved_jobs").insert({ user_id: currentUserId, job_id: job.id });
        toast.success("Job saved! Find it in your saved jobs.");
      }
      onToggleSave?.(job.id, !isSaved);
    } catch {
      toast.error("Failed to update saved jobs");
    } finally {
      setSavingBookmark(false);
    }
  };

  const helpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  const perHelperBudget = job.budget / helpersCount;
  const feeAmt = perHelperBudget * (effectiveFee / 100);
  const feeTax = feeAmt * 0.10; // 10% tax on platform fee
  const netEarnings = perHelperBudget - feeAmt - feeTax;
  const earnings = netEarnings.toFixed(2);
  const urgentTip = job.urgent_fee ?? 0;
  const catStyle = categoryColors[job.category] || categoryColors.other;
  const isOwnJob = currentUserId === job.customer_id;
  const photos = job.photos || [];

  const cityState = getCityState(job.location);

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
      <div className="w-full px-4 pt-3 pb-2.5 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            {job.is_urgent && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-accent/15 text-accent-foreground text-[9px] font-bold uppercase tracking-wider">
                <Zap className="w-2.5 h-2.5 text-accent fill-accent" /> Urgent
              </span>
            )}
            {job.isBoosted && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[9px] font-bold uppercase tracking-wider">
                <Rocket className="w-2.5 h-2.5" /> Boosted
              </span>
            )}
            <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${catStyle.badge}`}>
              {categoryLabels[job.category] || job.category}
            </span>
          </div>
          <h3 className={`font-bold text-[15px] leading-snug ${catStyle.title} ${isExpanded ? "" : "line-clamp-2"}`}>
            {job.title}
          </h3>
        </div>
        <div className="flex flex-col items-end shrink-0">
          <span className="flex items-center font-bold text-primary text-base leading-none">
            <DollarSign className="w-3.5 h-3.5" />{earnings}
          </span>
          {urgentTip > 0 && (
            <span className="text-[10px] text-accent font-semibold mt-0.5">+${Number(urgentTip).toFixed(0)} tip</span>
          )}
          <span className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">You earn</span>
        </div>
      </div>

      {/* Meta row: date · location · expiry */}
      <div className="px-4 pb-3 flex items-center gap-x-3 gap-y-1.5 flex-wrap text-xs text-muted-foreground">
        {/* Date & Time */}
        {!job.start_time && !job.date_needed ? (
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3 shrink-0" /> Flexible
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3 shrink-0" />
            {parseLocalDate(job.date_needed).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
            {!job.start_time ? " · Flexible" : formattedTime ? ` · ${formattedTime}` : ""}
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
        {job.estimated_hours && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3 shrink-0" /> {job.estimated_hours}h
          </span>
        )}
        {expiryText && (
          <span className={`flex items-center gap-1 ${isExpiringSoon ? "text-destructive font-medium" : ""}`}>
            <Timer className="w-3 h-3 shrink-0" /> {expiryText}
          </span>
        )}
        {job.is_recurring && (
          <span className="flex items-center gap-1">
            <Repeat className="w-3 h-3 shrink-0 text-primary" /> {job.recurrence_interval ? `Every ${job.recurrence_interval}` : "Recurring"}
          </span>
        )}
        {job.is_group_job && (
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3 shrink-0 text-primary" /> {job.helpers_needed ? `${job.helpers_needed} helprs` : "Group"}
          </span>
        )}
      </div>


      {/* Expandable section */}
      <div className={`overflow-hidden transition-all duration-200 ease-in-out ${isExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`}>
        <div className="px-4 pb-4 pt-3 space-y-4 border-t border-border/40 bg-muted/10">
          {/* Description */}
          {job.description && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Description</p>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{job.description}</p>
            </div>
          )}

          {/* Photos */}
          {photos.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Photos</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {photos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                    <img src={url} alt={`Photo ${i + 1}`} className="w-28 h-20 rounded-lg object-cover border border-border hover:border-primary transition-colors" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Special requirements */}
          {job.special_requirements?.trim() ? (
            <div className="rounded-lg bg-secondary/40 border border-border/40 p-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Special Requirements</p>
              <p className="text-sm text-foreground">{job.special_requirements}</p>
            </div>
          ) : null}

          {/* Action bar */}
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
            <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 px-2" onClick={(e) => { e.stopPropagation(); onReport(job.id); }}>
              <Flag className="w-3.5 h-3.5 mr-1" /> Report
            </Button>
            <div className="flex items-center gap-2">
              {!isOwnJob && (
                <Button size="sm" variant="outline" onClick={handleToggleSave} disabled={savingBookmark} className={`h-8 ${isSaved ? "border-primary text-primary" : ""}`}>
                  <Bookmark className={`w-3.5 h-3.5 mr-1 ${isSaved ? "fill-primary" : ""}`} /> {isSaved ? "Saved" : "Save"}
                </Button>
              )}
              {!isOwnJob && (
                <Button size="sm" className="h-8 bg-primary text-primary-foreground hover:bg-primary/90" onClick={(e) => { e.stopPropagation(); onApply(job.id); }}>
                  <Send className="w-3.5 h-3.5 mr-1" /> Apply
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer: poster + category badge */}
      <div className="px-4 py-2 border-t border-border/40 bg-muted/15 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Posted by <a href={`/user/${job.customer_id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-primary hover:underline">{job.posterName}</a>
            <a href={`/user/${job.customer_id}?tab=reviews`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-0.5 hover:underline">
            <Star className={`w-3 h-3 ${(job.posterReviewCount ?? 0) > 0 ? "fill-accent text-accent" : "text-muted-foreground/50"}`} />
            <span className={`font-medium ${(job.posterReviewCount ?? 0) > 0 ? "text-foreground" : "text-muted-foreground"}`}>
              {(job.posterReviewCount ?? 0) > 0 ? job.posterAvgRating?.toFixed(1) : "0.0"}
            </span>
            <span className="text-muted-foreground">({job.posterReviewCount ?? 0})</span>
          </a>
        </span>
      </div>
    </motion.div>
  );
};

export default JobCard;
