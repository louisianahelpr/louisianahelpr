import { useState, useRef, useEffect } from "react";
import { Flame } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDollars } from "./analyticsUtils";

interface MonthlyGoalCardProps {
  goal: number | null;
  onSaveGoal: (value: number | null) => void;
  currentMonthEarnings: number;
  isLoading: boolean;
}

const MonthlyGoalCard = ({
  goal,
  onSaveGoal,
  currentMonthEarnings,
  isLoading,
}: MonthlyGoalCardProps) => {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input whenever editing becomes true.
  useEffect(() => {
    if (editing) {
      setInputValue(goal !== null ? String(goal) : "");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [editing, goal]);

  const pct = goal && goal > 0
    ? Math.min(100, Math.round((currentMonthEarnings / goal) * 100))
    : 0;
  const goalMet = goal !== null && pct >= 100;

  function handleSave() {
    const n = Number(inputValue.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) {
      onSaveGoal(Math.round(n));
    }
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") setEditing(false);
  }

  function handleClearGoal() {
    onSaveGoal(null);
    setEditing(false);
  }

  return (
    <div
      className="rounded-2xl liquid-glass p-5 relative overflow-hidden"
      style={{
        boxShadow:
          "inset 0 1px 1px 0 rgba(255,255,255,0.4), " +
          "0 1px 2px hsl(var(--olivewood) / 0.06), " +
          "0 12px 28px -10px hsl(var(--olivewood) / 0.14)",
      }}
    >
      {/* Card header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span style={{ color: "hsl(var(--burnt-sienna))" }}>
            <Flame className="w-4 h-4" />
          </span>
          <h2
            className="font-display italic font-bold"
            style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
          >
            Monthly goal
          </h2>
        </div>
        {goal !== null && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-ds-11 font-medium underline underline-offset-2"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Edit
          </button>
        )}
      </div>

      {/* Loading skeleton */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4 rounded" />
          <Skeleton className="h-2 w-full rounded-full mt-3" />
        </div>
      ) : editing ? (
        /* ── Inline goal editor ─────────────────────────────────── */
        <div className="space-y-3">
          <label
            htmlFor="earnings-goal-input"
            className="text-ds-12 font-medium"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Set your monthly earnings target
          </label>
          <div className="flex items-center gap-2">
            <span className="text-ds-16 font-semibold" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              $
            </span>
            <input
              id="earnings-goal-input"
              ref={inputRef}
              type="number"
              min="1"
              step="1"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. 1000"
              className="flex-1 rounded-ds-md px-3 py-2 text-ds-16 font-semibold outline-none border"
              style={{
                background: "hsl(var(--parchment) / 0.5)",
                borderColor: "hsl(var(--olivewood) / 0.20)",
                color: "hsl(var(--ink-deep))",
              }}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 rounded-ds-md py-2 text-ds-13 font-semibold"
              style={{
                background: "hsl(var(--burnt-sienna))",
                color: "hsl(var(--parchment))",
              }}
            >
              Save goal
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-4 rounded-ds-md py-2 text-ds-13 font-semibold"
              style={{
                background: "hsl(var(--olivewood) / 0.10)",
                color: "hsl(var(--olivewood) / 0.8)",
              }}
            >
              Cancel
            </button>
          </div>
          {goal !== null && (
            <button
              type="button"
              onClick={handleClearGoal}
              className="text-ds-11 underline underline-offset-2 w-full text-center pt-1"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Remove goal
            </button>
          )}
        </div>
      ) : goal === null ? (
        /* ── No goal set — subtle prompt ───────────────────────── */
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="w-full text-left"
        >
          <p
            className="font-serif italic text-ds-13"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Set a monthly earnings goal{" "}
            <span style={{ color: "hsl(var(--burnt-sienna) / 0.80)" }}>→</span>
          </p>
        </button>
      ) : goalMet ? (
        /* ── Goal met! ──────────────────────────────────────────── */
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p
              className="font-display italic font-bold"
              style={{ fontSize: "1.4rem", color: "hsl(var(--bark))", letterSpacing: "-0.02em" }}
            >
              Goal reached!
            </p>
            <span style={{ fontSize: "1.2rem" }}>🎉</span>
          </div>
          <p className="text-ds-12 font-medium" style={{ color: "hsl(var(--bark) / 0.80)" }}>
            You've earned{" "}
            <span className="font-bold">{fmtDollars(currentMonthEarnings)}</span>{" "}
            this month — {pct > 100 ? `${pct - 100}% beyond` : "hitting"} your{" "}
            {fmtDollars(goal)} target. Incredible work!
          </p>
          {/* A thin fully-filled bar for context */}
          <div
            className="h-2 rounded-full mt-1"
            style={{ background: "hsl(var(--bark) / 0.45)" }}
          />
        </div>
      ) : (
        /* ── Progress bar ───────────────────────────────────────── */
        <div className="space-y-2">
          <div className="flex items-end justify-between">
            <p
              className="font-display italic font-bold"
              style={{ fontSize: "1.4rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
            >
              {fmtDollars(currentMonthEarnings)}
            </p>
            <p className="text-ds-12 font-medium tabular-nums" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              of {fmtDollars(goal)} goal
            </p>
          </div>
          {/* Progress bar */}
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ background: "hsl(var(--olivewood) / 0.12)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${pct}%`,
                background:
                  pct >= 75
                    ? "hsl(var(--bark) / 0.70)"
                    : "hsl(var(--burnt-sienna) / 0.65)",
              }}
            />
          </div>
          <p className="text-ds-11 font-medium" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            {pct}% of {fmtDollars(goal)} goal this month
          </p>
        </div>
      )}
    </div>
  );
};

export default MonthlyGoalCard;
