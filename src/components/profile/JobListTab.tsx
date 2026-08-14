import { MapPin, Briefcase, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import type { Database } from "@/integrations/supabase/types";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCategory, formatPrice, formatShortDate } from "@/lib/format";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

interface JobListTabProps {
  variant: "posted" | "completed";
  jobs: Job[];
  onBack: () => void;
}

export function JobListTab({ variant, jobs, onBack }: JobListTabProps) {
  const navigate = useNavigate();
  const isPosted = variant === "posted";

  return (
    <div className="space-y-4">
      <ProfileTabHeader
        title={isPosted ? "Posted jobs" : "Completed jobs"}
        onBack={onBack}
      />
      {jobs.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={isPosted ? Briefcase : Star}
          title={isPosted ? "No posts yet" : "No history yet"}
          body={
            isPosted
              ? "Tell a neighbor what you need done — they'll see it within minutes."
              : "Every job you complete builds your record. Apply to one to get started."
          }
          action={
            isPosted ? (
              <Button onClick={() => navigate("/post-job")}>Post your first job</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div key={job.id} className="rounded-ds-md liquid-glass p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-display italic font-bold leading-tight truncate text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
                    {job.title}
                  </p>
                  <div className="flex items-center gap-x-2 gap-y-0.5 mt-1.5 font-serif italic flex-wrap text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)",}}>
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.location}</span>
                    <span style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span>
                    <span>{formatShortDate(job.date_needed)}</span>
                    <span style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span>
                    <span>{formatCategory(job.category)}</span>
                  </div>
                </div>
                {isPosted ? (
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-ds-15 font-bold text-primary tabular-nums">${formatPrice(job.budget ?? 0)}</span>
                    <StatusBadge status={job.status} className="text-ds-10" />
                  </div>
                ) : (
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-ds-15 font-bold text-primary tabular-nums">${formatPrice(job.budget ?? 0)}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default JobListTab;
