/**
 * StatusBadge — renders a job or application status as a brand-aligned pill.
 *
 * Wraps the shared <Badge> primitive and reads:
 *   - color from `statusBadge` (keyed to the four semantic tokens
 *     --success / --warning / --error / --info)
 *   - label from `jobStatusLabel` in `@/lib/statusLabels` — the single
 *     source of truth for status copy (see #46). Do NOT inline a local
 *     STATUS_LABELS map here; every divergence we've ever shipped came
 *     from someone doing exactly that.
 *
 * Usage:
 *   <StatusBadge status={application.status} />
 *   <StatusBadge status="completed" className="text-xs" />
 */
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { statusBadge } from "@/components/activity/activityConstants";
import { jobStatusLabel } from "@/lib/statusLabels";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const colorClass = statusBadge[status] ?? "bg-info/15 text-info";
  const label = jobStatusLabel(status);

  return (
    <Badge
      // The Badge primitive renders a rounded-full pill with border.
      // We pass "outline" to suppress the default opaque background and
      // let the semantic token classes drive the appearance instead.
      //
      // No `capitalize` class — labels arrive pre-cased (sentence case)
      // from `jobStatusLabel`. Applying CSS `capitalize` would shout
      // "In Progress" instead of the house "In progress".
      variant="outline"
      className={cn("border-transparent", colorClass, className)}
    >
      {label}
    </Badge>
  );
}
