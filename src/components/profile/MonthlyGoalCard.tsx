import { useState, useEffect, useCallback } from "react";
import { Target, Flame, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatPrice } from "@/lib/format";

interface MonthlyGoalCardProps {
  /** All completed jobs with their date and net payout */
  completedJobs: Array<{ created_at: string; netPayout: number }>;
}

// The one and only monthly-earnings-goal control. /analytics used to render a
// second, independent editor over this same key: first with a different key
// (underscore vs colon), so a goal set on one screen silently didn't show on
// the other; then with the key matched but the progress computed off GROSS
// budget, so the same goal reported two different completion percentages. The
// duplicate is gone — the goal is set here, next to the take-home dollars it
// is measured against.
const GOAL_KEY = "helpr:earnings_goal";

function getMonthlyEarnings(
  jobs: Array<{ created_at: string; netPayout: number }>
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const job of jobs) {
    const key = job.created_at.slice(0, 7); // "YYYY-MM"
    map[key] = (map[key] ?? 0) + job.netPayout;
  }
  return map;
}

function countStreak(monthlyMap: Record<string, number>): number {
  const now = new Date();
  let streak = 0;
  let y = now.getFullYear();
  let m = now.getMonth(); // 0-indexed

  // Walk backwards month by month up to 24 months.
  // Current month counts if it has any earnings.
  // A month with $0 that comes after we already have a streak breaks it.
  for (let i = 0; i < 24; i++) {
    const key = `${y}-${String(m + 1).padStart(2, "0")}`;
    const earned = (monthlyMap[key] ?? 0) > 0;

    if (earned) {
      streak++;
    } else if (streak > 0) {
      break; // streak broken by a gap
    } else if (i > 0) {
      break; // prior month had $0 and no streak yet — stop
    }
    // i === 0 and no earnings: keep going (don't break on current month)

    m--;
    if (m < 0) {
      m = 11;
      y--;
    }
  }
  return streak;
}

export function MonthlyGoalCard({ completedJobs }: MonthlyGoalCardProps) {
  const [goal, setGoal] = useState<number | null>(() => {
    try {
      const stored = localStorage.getItem(GOAL_KEY);
      return stored ? Number(stored) : null;
    } catch {
      return null;
    }
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [celebrated, setCelebrated] = useState(false);

  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const monthlyMap = getMonthlyEarnings(completedJobs);
  const thisMonthEarnings = monthlyMap[thisMonthKey] ?? 0;
  const streak = countStreak(monthlyMap);
  const progress =
    goal != null && goal > 0
      ? Math.min((thisMonthEarnings / goal) * 100, 100)
      : 0;
  const hitGoal = goal != null && goal > 0 && thisMonthEarnings >= goal;

  // One-time celebration toast the first time the goal is hit this session
  useEffect(() => {
    if (hitGoal && !celebrated && goal != null) {
      setCelebrated(true);
    }
  }, [hitGoal, celebrated, goal, thisMonthEarnings]);

  const saveGoal = useCallback(() => {
    const val = parseFloat(draft);
    if (isNaN(val) || val <= 0) {
      toast.error("Enter a positive dollar amount.");
      return;
    }
    setGoal(val);
    try {
      localStorage.setItem(GOAL_KEY, String(val));
    } catch { /* best-effort */ }
    setEditing(false);
  }, [draft]);

  const monthName = new Date().toLocaleDateString("en-US", { month: "long" });

  return (
    /* SAME SURFACE as its neighbours (owner: "August background should match
       the others"). This card sat in a column with the projection card and the
       Wallet card — both `rounded-2xl liquid-glass p-5` — while it wore a flat
       parchment-tint box with a 1px border and tighter padding, so one card in
       a stack of three read as a different kind of thing.

       The GOAL-HIT state keeps its sage wash: that is a real state change worth
       colouring, and it now paints over the shared glass rather than replacing
       it, so the celebration is a tint on the card instead of a different card.
       `undefined` rather than a background when the goal is not hit — otherwise
       an inline value would override liquid-glass and put the odd one out
       straight back. */
    <div
      className="rounded-2xl liquid-glass p-5 space-y-3"
      style={
        hitGoal
          ? {
              background: "hsl(var(--sage) / 0.08)",
              border: "1px solid hsl(var(--sage) / 0.25)",
            }
          : undefined
      }
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "hsl(var(--sage) / 0.12)" }}
          >
            <Target className="w-4 h-4" style={{ color: "hsl(var(--sage))" }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2
                className="font-display italic font-bold leading-tight text-ds-17"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {monthName}
              </h2>
              {streak >= 2 && (
                <span
                  className="flex items-center gap-0.5 text-ds-11 font-medium px-1.5 py-0.5 rounded-full not-italic"
                  style={{
                    background: "hsl(var(--heritage-gold) / 0.12)",
                    color: "hsl(var(--heritage-gold))",
                  }}
                >
                  <Flame className="w-3 h-3" /> {streak}mo
                </span>
              )}
            </div>
          </div>
        </div>
        {!editing && (
          <button
            onClick={() => {
              setDraft(goal != null ? String(goal) : "");
              setEditing(true);
            }}
            className="p-1 rounded-full"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            aria-label="Edit monthly goal"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Editing state */}
      {editing ? (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ds-13 text-muted-foreground">
              $
            </span>
            <input
              type="number"
              min="1"
              step="50"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveGoal();
                if (e.key === "Escape") setEditing(false);
              }}
              autoFocus
              aria-label="Monthly earnings goal in dollars"
              className="w-full rounded-ds-md border border-input bg-background pl-6 pr-3 py-1.5 text-ds-13"
            />
          </div>
          <button
            onClick={saveGoal}
            className="p-1.5 rounded-full bg-foreground/5 hover:bg-foreground/10"
            aria-label="Save goal"
          >
            <Check className="w-4 h-4" style={{ color: "hsl(var(--sage))" }} />
          </button>
          <button
            onClick={() => setEditing(false)}
            className="p-1.5 rounded-full bg-foreground/5 hover:bg-foreground/10"
            aria-label="Cancel"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      ) : goal != null ? (
        /* Progress state */
        <div className="space-y-2">
          {/* Earnings vs goal */}
          <div className="flex items-baseline justify-between">
            <span
              className="text-ds-20 font-bold"
              style={{
                color: hitGoal
                  ? "hsl(var(--sage))"
                  : "hsl(var(--ink-deep))",
              }}
            >
              ${formatPrice(thisMonthEarnings)}
            </span>
            <span className="text-ds-12 text-muted-foreground">
              of ${formatPrice(goal)} goal
            </span>
          </div>

          {/* Progress bar */}
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ background: "hsl(var(--olivewood) / 0.1)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${progress}%`,
                background: hitGoal
                  ? "hsl(var(--sage))"
                  : "hsl(var(--heritage-gold))",
              }}
            />
          </div>

          <p className="text-ds-11 text-muted-foreground">
            {hitGoal
              ? `Goal reached! $${formatPrice(thisMonthEarnings - goal)} over`
              : `$${formatPrice(goal - thisMonthEarnings)} to go`}
          </p>
        </div>
      ) : (
        /* No goal set yet */
        <Button
          variant="primary"
          size="sm"
          className="w-full"
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
        >
          <Target className="w-3.5 h-3.5 mr-1.5" /> Set a Monthly Earnings Goal
        </Button>
      )}
    </div>
  );
}
