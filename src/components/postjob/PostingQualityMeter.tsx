import { CheckCircle2, Circle } from "lucide-react";
import type { PostingQualityResult } from "@/hooks/usePostingQuality";

type PostingQualityMeterProps = Pick<
  PostingQualityResult,
  "score" | "label" | "color" | "completedChecks" | "missingChecks"
>;

/**
 * Live post-quality progress bar shown in the checkout review step.
 * Scores 0–100 across six dimensions and shows completed/missing signals
 * so the poster can see exactly what would make their post stronger.
 */
export function PostingQualityMeter({
  score,
  label,
  color,
  completedChecks,
  missingChecks,
}: PostingQualityMeterProps) {
  // Cap missing signals to 2 so the card stays compact.
  const shownMissing = missingChecks.slice(0, 2);

  return (
    <div
      className="rounded-ds-md p-3 space-y-2.5"
      style={{
        background: "hsl(var(--bark) / 0.05)",
        border: "0.5px solid hsl(var(--bark) / 0.12)",
      }}
    >
      {/* Header row: label + score percent */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="font-display italic font-semibold text-ds-13"
          style={{ color }}
        >
          Post quality: {label}
        </span>
        <span
          className="tabular-nums font-sans font-semibold text-ds-12"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          {score}%
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: "hsl(var(--bark) / 0.10)" }}
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Post quality ${score}%`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${score}%`, background: color }}
        />
      </div>

      {/* Completed + missing signals */}
      {(completedChecks.length > 0 || shownMissing.length > 0) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {completedChecks.map((check) => (
            <span
              key={check}
              className="inline-flex items-center gap-1 font-serif italic text-ds-11"
              style={{ color: score >= 85 ? "hsl(var(--success-ink))" : "hsl(var(--bark))" }}
            >
              <CheckCircle2 className="w-3 h-3 shrink-0" strokeWidth={2.25} aria-hidden />
              {check}
            </span>
          ))}
          {shownMissing.map((check) => (
            <span
              key={check}
              className="inline-flex items-center gap-1 font-serif italic text-ds-11"
              style={{ color: "hsl(var(--amber-solid))" }}
            >
              <Circle className="w-3 h-3 shrink-0" strokeWidth={2.25} aria-hidden />
              {check}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
