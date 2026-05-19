/**
 * StatusBadge — renders a job or application status as a brand-aligned pill.
 *
 * Wraps the shared <Badge> primitive and reads status → class from the
 * `statusBadge` map in activityConstants, which is keyed to the four
 * semantic tokens (--success / --warning / --error / --info). This means
 * all status pills across the app stay in sync when the palette changes,
 * without any per-callsite maintenance.
 *
 * Usage:
 *   <StatusBadge status={application.status} />
 *   <StatusBadge status="completed" className="text-xs" />
 */
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { statusBadge } from "@/components/activity/activityConstants";

const STATUS_LABELS: Record<string, string> = {
  open:               "Open",
  accepted:           "Accepted",
  in_progress:        "In Progress",
  revision_requested: "Revision Requested",
  completed:          "Completed",
  cancelled:          "Cancelled",
  disputed:           "Disputed",
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const colorClass = statusBadge[status] ?? "bg-info/15 text-info";
  const label = STATUS_LABELS[status] ?? status.replace(/_/g, " ");

  return (
    <Badge
      // The Badge primitive renders a rounded-full pill with border.
      // We pass "outline" to suppress the default opaque background and
      // let the semantic token classes drive the appearance instead.
      variant="outline"
      className={cn("border-transparent capitalize", colorClass, className)}
    >
      {label}
    </Badge>
  );
}
