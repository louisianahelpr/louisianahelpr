import { useEffect, useState } from "react";
import { Check, CloudOff } from "lucide-react";

interface DraftSavedIndicatorProps {
  /**
   * Epoch milliseconds of the most recent draft autosave. 0 (or undefined)
   * means no draft has been saved yet — the indicator stays hidden so the
   * empty-form view isn't littered with reassurance the user hasn't
   * earned.
   */
  savedAt: number;
}

/**
 * Formats an autosave timestamp into a human-friendly relative string:
 *   < 5s    → "Draft saved just now"
 *   < 60s   → "Draft saved 12s ago"
 *   < 60m   → "Draft saved 3m ago"
 *   else    → "Draft saved 1h ago" (capped at h)
 *
 * The autosave debounce in useDraftJob is 5s, so anything under 5 reads
 * as "just now" — there's no useful precision below that.
 */
function formatRelative(now: number, savedAt: number): string {
  const deltaMs = Math.max(0, now - savedAt);
  const deltaS = Math.floor(deltaMs / 1000);
  if (deltaS < 5) return "Draft saved just now";
  if (deltaS < 60) return `Draft saved ${deltaS}s ago`;
  const deltaM = Math.floor(deltaS / 60);
  if (deltaM < 60) return `Draft saved ${deltaM}m ago`;
  const deltaH = Math.floor(deltaM / 60);
  return `Draft saved ${deltaH}h ago`;
}

/**
 * Inline "Draft saved Xs ago" reassurance pill. Sits just above the form
 * so the poster knows their input is captured before they navigate away.
 *
 * Polls every 15s so the label stays roughly fresh; the savedAt prop
 * itself updates whenever the autosave debounce fires (every 5s of
 * activity), which re-renders this and resets the displayed delta.
 */
export function DraftSavedIndicator({ savedAt }: DraftSavedIndicatorProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Only tick when there's actually a draft to describe — saves a
    // background timer on the empty form.
    if (!savedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [savedAt]);

  if (!savedAt) {
    return null;
  }

  const fresh = now - savedAt < 5_000;

  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-sans text-ds-11"
      style={{
        color: "hsl(var(--olivewood))",
        background: "hsl(var(--parchment) / 0.6)",
        border: "0.5px solid hsl(var(--olivewood) / 0.18)",
      }}
    >
      {fresh ? (
        <Check
          className="w-3 h-3 shrink-0"
          style={{ color: "hsl(var(--bark))" }}
          strokeWidth={3}
          aria-hidden
        />
      ) : (
        <CloudOff
          className="w-3 h-3 shrink-0"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          aria-hidden
        />
      )}
      <span className="tabular-nums">{formatRelative(now, savedAt)}</span>
    </div>
  );
}
