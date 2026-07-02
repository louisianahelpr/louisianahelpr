import { Clock, AlertTriangle, Flame } from "lucide-react";

// SLA badge — green/amber/red based on time since the dispute was filed.
// Past 5 days the customer can chargeback through their card issuer
// bypassing our resolution flow, so we surface that as a hot warning.
export const slaBadge = (disputedAt: string | null) => {
  if (!disputedAt) return null;
  const hours = (Date.now() - new Date(disputedAt).getTime()) / 3600_000;
  if (hours > 120) {
    return (
      <span className="inline-flex items-center gap-1 text-ds-10 px-2 py-0.5 rounded-full bg-destructive/15 text-destructive font-bold uppercase tracking-wide">
        <Flame className="w-3 h-3" /> Chargeback risk · {Math.floor(hours / 24)}d
      </span>
    );
  }
  if (hours > 48) {
    return (
      <span className="inline-flex items-center gap-1 text-ds-10 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold uppercase tracking-wide">
        <AlertTriangle className="w-3 h-3" /> Stale · {Math.floor(hours / 24)}d
      </span>
    );
  }
  if (hours > 24) {
    return (
      <span className="inline-flex items-center gap-1 text-ds-10 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 font-medium uppercase tracking-wide">
        <Clock className="w-3 h-3" /> {Math.floor(hours)}h
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-ds-10 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium uppercase tracking-wide">
      <Clock className="w-3 h-3" /> Fresh · {Math.floor(hours)}h
    </span>
  );
};

// Categorise the dispute reason into rough buckets driven by the
// keywords each helpr / poster types when filing. Cheap heuristic —
// it's better than nothing for triaging the queue but should be
// replaced with a structured `dispute_category` column long-term.
export const categoriseReason = (reason: string | null | undefined): string => {
  const r = (reason || "").toLowerCase();
  if (!r) return "other";
  if (/no[-\s]?show|didn'?t show|didnt show|never arrived/.test(r)) return "no_show";
  if (/quality|incomplete|sloppy|poor|bad job|not done/.test(r)) return "quality";
  if (/payment|charge|refund|money|paid/.test(r)) return "payment";
  if (/damage|broke|broken|stained|ruined/.test(r)) return "damage";
  if (/abusive|harass|rude|threat|safety/.test(r)) return "behaviour";
  if (/late|delay|arrived/.test(r)) return "timing";
  return "other";
};

export const CATEGORY_LABELS: Record<string, string> = {
  no_show: "No-show",
  quality: "Work quality",
  payment: "Payment",
  damage: "Damage",
  behaviour: "Behaviour",
  timing: "Timing",
  other: "Other",
};
