import { useState } from "react";
import { ChevronRight as ChevronRightIcon, ChevronDown, Check } from "lucide-react";
import { getProfileCompletion } from "@/lib/profileCompletion";

type Completion = ReturnType<typeof getProfileCompletion>;

interface CompletionChecklistProps {
  completion: Completion;
  completionPct: number;
  completionTargets: Record<string, { tab?: string; href?: string; cue: string }>;
  handleCompletionItemTap: (label: string) => void;
}

export function CompletionChecklist({
  completion,
  completionPct,
  completionTargets,
  handleCompletionItemTap,
}: CompletionChecklistProps) {
  // Profile-completion checklist disclosure. Collapsed by default so the
  // checklist is a quiet, opt-in nudge rather than permanent clutter; the
  // whole block is hidden once the profile is 100% complete (below).
  const [completionOpen, setCompletionOpen] = useState(false);

  return (
    <div
      className="liquid-glass shrink-0 overflow-hidden"
      style={{
        boxShadow:
          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
          "0 1px 2px hsl(var(--olivewood) / 0.06), " +
          "0 12px 28px -10px hsl(var(--olivewood) / 0.14)",
      }}
    >
      <button
        type="button"
        onClick={() => setCompletionOpen((o) => !o)}
        aria-expanded={completionOpen}
        className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-secondary/30 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-ds-13 font-semibold text-foreground">Finish your profile</span>
            <span
              className="text-ds-10 font-bold tabular-nums px-1.5 py-0.5 rounded-full"
              style={{
                color: "hsl(var(--bark))",
                background: "hsl(var(--bark) / 0.10)",
              }}
            >
              {completionPct}%
            </span>
          </div>
          <div className="h-1.5 mt-2 rounded-full bg-muted/60 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${completionPct}%`,
                background:
                  completionPct >= 66
                    ? "hsl(var(--bark) / 0.85)"
                    : "hsl(var(--burnt-sienna) / 0.75)",
              }}
            />
          </div>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground/70 shrink-0 transition-transform ${completionOpen ? "rotate-180" : ""}`}
        />
      </button>

      {completionOpen && (
        <div className="px-4 pb-4 pt-1 space-y-1.5">
          {completion.items.map((item) => {
            const cue = completionTargets[item.label]?.cue;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => handleCompletionItemTap(item.label)}
                disabled={item.done}
                // min-h-[44px] guarantees the iOS/Android tap target even
                // though the visual row is compact; a completed row is
                // disabled (no-op + default cursor).
                aria-label={item.done ? `${item.label} — done` : `${item.label} — tap to finish`}
                className="w-full min-h-[44px] flex items-center gap-2.5 rounded-ds-md px-2.5 py-2 text-left enabled:active:bg-secondary/40 transition-colors disabled:cursor-default"
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                    item.done ? "" : "border border-dashed"
                  }`}
                  style={
                    item.done
                      ? { background: "hsl(var(--bark))" }
                      : { borderColor: "hsl(var(--olivewood) / 0.35)" }
                  }
                >
                  {item.done && (
                    <Check className="w-3 h-3" style={{ color: "hsl(var(--parchment))" }} strokeWidth={3} />
                  )}
                </span>
                <span
                  className={`flex-1 text-ds-13 ${
                    item.done ? "text-muted-foreground line-through" : "text-foreground font-medium"
                  }`}
                >
                  {item.label}
                </span>
                {!item.done && (
                  <span className="inline-flex items-center gap-1 shrink-0">
                    {cue && (
                      <span
                        className="text-ds-11 font-semibold"
                        style={{ color: "hsl(var(--burnt-sienna))" }}
                      >
                        {cue}
                      </span>
                    )}
                    <ChevronRightIcon className="w-3.5 h-3.5 text-muted-foreground/60" strokeWidth={2.25} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
