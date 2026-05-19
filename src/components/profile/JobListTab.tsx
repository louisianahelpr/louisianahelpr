import { MapPin, Briefcase, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import type { Database } from "@/integrations/supabase/types";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { EmptyState } from "@/components/ui/EmptyState";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

const statusColors: Record<string, string> = {
  open: "bg-primary/10 text-primary",
  accepted: "bg-accent/20 text-accent-foreground",
  in_progress: "bg-accent/20 text-accent-foreground",
  revision_requested: "bg-destructive/10 text-destructive",
  completed: "bg-secondary text-secondary-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

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
        eyebrow={isPosted ? "History" : "Track record"}
        title={isPosted ? "Posted jobs" : "Completed jobs"}
        meta={
          isPosted
            ? `${jobs.length} task${jobs.length === 1 ? "" : "s"} posted`
            : `${jobs.length} job${jobs.length === 1 ? "" : "s"} delivered`
        }
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
              <Button onClick={() => navigate("/post-job")}>Post your first task</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div key={job.id} className="rounded-ds-md liquid-glass p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-display italic font-bold leading-tight truncate" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
                    {job.title}
                  </p>
                  <div className="flex items-center gap-x-2 gap-y-0.5 mt-1.5 font-serif italic flex-wrap" style={{ color: "hsl(var(--olivewood) / 0.7)", fontSize: "0.78rem" }}>
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.location}</span>
                    <span style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span>
                    <span>{new Date(job.date_needed).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                    <span style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span>
                    <span className="capitalize">{job.category.replace("_", " ")}</span>
                  </div>
                </div>
                {isPosted ? (
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-ds-15 font-bold text-primary tabular-nums">${job.budget}</span>
                    <span className={`text-ds-10 font-semibold px-2 py-0.5 rounded-full capitalize ${statusColors[job.status] || "bg-muted text-muted-foreground"}`}>{job.status.replace("_", " ")}</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-ds-15 font-bold text-primary tabular-nums">${job.budget}</span>
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
