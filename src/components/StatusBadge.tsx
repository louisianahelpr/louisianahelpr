/**
 * StatusBadge — renders a job or application status as a brand-aligned pill.
 *
 * Wraps the shared <Badge> primitive and reads:
 *   - color from `jobStatusColor` / `jobStatusColorClasses` in
 *     `@/lib/statusColors` — the single source of truth for status COLORS,
 *     so the same state paints identically here, in the chat header, in
 *     conversation rows, and in the activity / earnings cards.
 *     Do NOT inline a local color map.
 *   - label from `jobStatusLabel` in `@/lib/statusLabels` — the single
 *     source of truth for status copy (see #46). Do NOT inline a local
 *     STATUS_LABELS map here; every divergence we've ever shipped came
 *     from someone doing exactly that.
 *
 * Visual anatomy: [dot] [label]
 *   - A 5×5 px dot tinted at the full status color (no opacity) anchors the
 *     eye immediately; the pill background is the low-opacity brand tint.
 *   - rounded-ds-pill (28 px) keeps it consistent with the design-system
 *     pill radius used on tier badges and chip filters.
 *
 * Usage:
 *   <StatusBadge status={application.status} />
 *   <StatusBadge status="completed" className="text-xs" />
 */
import { cn } from "@/lib/utils";
import { jobStatusLabel } from "@/lib/statusLabels";
import { jobStatusColor, jobStatusColorClasses } from "@/lib/statusColors";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { bg, text } = jobStatusColor(status);
  const colorClass = jobStatusColorClasses(status);
  const label = jobStatusLabel(status);

  return (
    // Inline-style for the tinted background so the exact HSL values from
    // the canonical color map are used. className carries the text color
    // (arbitrary Tailwind form) plus any caller overrides.
    //
    // No `capitalize` — labels arrive pre-cased (sentence case) from
    // `jobStatusLabel`. CSS capitalize would corrupt "In progress" → "In Progress".
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-ds-pill border border-transparent",
        "px-2.5 py-0.5 text-ds-11 font-semibold leading-none",
        colorClass,
        className,
      )}
      style={{ background: bg }}
    >
      {/* Status dot — solid at full text color for instant visual anchor */}
      <span
        className="shrink-0 w-[5px] h-[5px] rounded-full"
        style={{ background: text }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
