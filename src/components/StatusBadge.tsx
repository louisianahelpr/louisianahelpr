/**
 * StatusBadge — renders a job or application status as a brand-aligned pill.
 *
 * Wraps the shared <Badge> primitive and reads:
 *   - color from `jobStatusColorClasses` in `@/lib/statusColors` — the
 *     single source of truth for status COLORS, so the same state paints
 *     identically here, in the chat header, in conversation rows, and in
 *     the activity / earnings cards. Do NOT inline a local color map.
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
import { jobStatusLabel } from "@/lib/statusLabels";
import { jobStatusColorClasses } from "@/lib/statusColors";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const colorClass = jobStatusColorClasses(status);
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
