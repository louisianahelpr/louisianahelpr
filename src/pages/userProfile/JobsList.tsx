import { ClipboardList, Hammer } from "lucide-react";
import { jobStatusColorClasses } from "@/lib/statusColors";
import { formatShortDate, formatCategory, formatPrice } from "@/lib/format";
import { jobStatusLabel } from "@/lib/statusLabels";
import type { ProfileJob } from "./types";

type Props = {
  jobs: ProfileJob[];
  variant: "posted" | "worked";
};

export const JobsList = ({ jobs, variant }: Props) => {
  const EmptyIcon = variant === "posted" ? ClipboardList : Hammer;
  const emptyCopy = variant === "posted" ? "No posted jobs yet" : "No completed jobs yet";

  return (
    <div className="space-y-2 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-200">
      {jobs.length > 0 ? jobs.map((job) => (
        // p-3, not the card convention's p-5: these are compact repeated list
        // rows (one line of title + meta), and card padding would turn a
        // 20-job history into a wall of mostly-empty tiles.
        <div key={job.id} className="rounded-2xl liquid-glass p-3 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-ds-13 font-medium text-foreground truncate">{job.title}</p>
            <p className="text-muted-foreground text-ds-11">{formatShortDate(job.created_at)} · {formatCategory(job.category)}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-ds-13 font-bold text-primary">${formatPrice(job.budget)}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${jobStatusColorClasses(job.status)}`}>{jobStatusLabel(job.status)}</span>
          </div>
        </div>
      )) : (
        // p-6 over p-5: icon-over-caption empty state, matching ReviewsSection.
        <div className="rounded-2xl liquid-glass p-6 text-center">
          <EmptyIcon className="w-5 h-5 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-ds-11 text-muted-foreground">{emptyCopy}</p>
        </div>
      )}
    </div>
  );
};
