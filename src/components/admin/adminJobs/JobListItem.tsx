import { Badge } from "@/components/ui/badge";
import { MapPin, Calendar, AlertTriangle, CheckCircle2 } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { paymentStatusLabel } from "@/lib/statusLabels";
import { categoryLabels, paymentColors, type Job } from "./types";

interface JobListItemProps {
  job: Job;
  flags: string[] | undefined;
  isResolved: boolean;
  onOpen: (job: Job) => void;
}

export const JobListItem = ({ job, flags, isResolved, onOpen }: JobListItemProps) => {
  const showFlagStyle = flags && !isResolved;
  const isRemoved = !!job.removal_reason;
  return (
    <div
      onClick={() => onOpen(job)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(job);
        }
      }}
      className={`rounded-ds-md border bg-card p-4 cursor-pointer hover:bg-secondary/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        showFlagStyle ? "border-destructive/30" : "border-border"
      } ${isRemoved ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            {showFlagStyle && <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />}
            {flags && isResolved && <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />}
            <p className="font-semibold text-foreground truncate">{job.title}</p>
            <Badge variant="sienna" className="text-ds-11 capitalize">{categoryLabels[job.category] || job.category}</Badge>
            {isRemoved && <Badge variant="destructive" className="text-ds-11">Removed</Badge>}
            {flags && isResolved && <Badge variant="outline" className="text-ds-11 gap-1"><CheckCircle2 className="w-3 h-3" />Resolved</Badge>}
          </div>
          <div className="flex flex-wrap gap-3 text-ds-11 text-muted-foreground">
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(job.date_needed).toLocaleDateString()}</span>
            <span className="font-medium text-foreground">${job.budget}</span>
          </div>
          {showFlagStyle && (
            <div className="flex flex-wrap gap-1 mt-1">
              {flags!.slice(0, 2).map((f, i) => (
                <span key={i} className="text-ds-10 bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full">{f}</span>
              ))}
              {flags!.length > 2 && <span className="text-ds-10 text-destructive">+{flags!.length - 2} more</span>}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1 items-end flex-shrink-0">
          <StatusBadge status={job.status} className="text-ds-11" />
          <span className={`text-ds-11 px-2 py-0.5 rounded-full font-medium ${paymentColors[job.payment_status || "unpaid"] || ""}`}>
            {paymentStatusLabel(job.payment_status ?? "unpaid")}
          </span>
        </div>
      </div>
    </div>
  );
};
