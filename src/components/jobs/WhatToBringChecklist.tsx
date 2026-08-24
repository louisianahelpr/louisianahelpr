/**
 * WhatToBringChecklist — informational, category-aware "what to bring"
 * tick-list rendered on the helper's accepted-job card.
 *
 * Why: helpers regularly arrive under-prepared (no gloves for yard work,
 * no Allen wrench for assembly, no leash spare for pet sits). Surfacing
 * a category-appropriate list at acceptance time costs nothing and saves
 * the run-back-to-the-truck moment.
 *
 * Behaviour:
 *   - Renders NOTHING when the category has no curated list (see
 *     `getWhatToBring`) — never an empty card.
 *   - Collapsible disclosure, collapsed by default to stay quiet.
 *   - Each row is a shadcn `Checkbox`; tick state persists to
 *     localStorage (mirrored to Capacitor Preferences on iOS via the
 *     `helpr_` prefix in `safeStorage`).
 *   - Storage key: `helpr_what_to_bring_<jobId>` — scoped per job so two
 *     active jobs don't share ticks.
 *   - Helper-only. The parent decides when to mount (post-acceptance);
 *     this component does not guard role.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Backpack, ChevronDown, ChevronUp } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { safeStorage } from "@/lib/safeStorage";
import { getWhatToBring } from "@/data/whatToBring";
import { categoryLabels } from "@/components/activity/activityConstants";

interface WhatToBringChecklistProps {
  /** The helper's accepted job id. Used to scope the localStorage key. */
  jobId: string;
  /** `jobs.category` enum value (e.g. "yard_work"). */
  category: string | null | undefined;
}

function storageKey(jobId: string): string {
  return `helpr_what_to_bring_${jobId}`;
}

function readChecked(jobId: string): Set<string> {
  try {
    const raw = safeStorage.getItem(storageKey(jobId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    // Corrupted JSON — treat as empty. Storage is best-effort.
    return new Set();
  }
}

function writeChecked(jobId: string, checked: Set<string>): void {
  try {
    safeStorage.setItem(storageKey(jobId), JSON.stringify([...checked]));
  } catch {
    // Storage is best-effort — a write failure must not break the UI.
  }
}

export function WhatToBringChecklist({ jobId, category }: WhatToBringChecklistProps) {
  const items = useMemo(() => getWhatToBring(category), [category]);

  // Hook order discipline: we read storage in the initial state lazy
  // initialiser so we don't pay for a JSON.parse on every render. The
  // jobId never changes for a mounted card, so this is safe.
  const [checked, setChecked] = useState<Set<string>>(() => readChecked(jobId));
  const [open, setOpen] = useState(false);

  // If the parent swaps the jobId in place (rare but possible), re-read.
  useEffect(() => {
    setChecked(readChecked(jobId));
  }, [jobId]);

  const toggle = useCallback(
    (item: string) => {
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(item)) next.delete(item);
        else next.add(item);
        writeChecked(jobId, next);
        return next;
      });
    },
    [jobId],
  );

  if (!items) return null;

  const label = (category && categoryLabels[category]) || "this job";
  const totalTicked = items.reduce((acc, i) => acc + (checked.has(i) ? 1 : 0), 0);

  return (
    <div
      className="rounded-ds-md overflow-hidden"
      style={{
        background: "hsl(var(--parchment) / 0.55)",
        border: "0.5px solid hsl(var(--olivewood) / 0.12)",
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-controls={open ? `what-to-bring-${jobId}` : undefined}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left btn-press"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Backpack
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: "hsl(var(--bark))" }}
            aria-hidden="true"
          />
          {/* One eyebrow token across these surfaces. This was bark at
              text-ds-11 / 0.16em while every sibling eyebrow ("Message from
              poster", "Why are you withdrawing?", "Your attachments") is
              sienna at text-ds-10 / 0.18em — three sizes and two colour
              families for one role, inside the same card. */}
          <span
            className="font-serif italic uppercase truncate text-ds-10"
            style={{
              color: "hsl(var(--burnt-sienna))",
              letterSpacing: "0.18em",
            }}
          >
            What to bring · typical for {label}
          </span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span
            className="tabular-nums text-ds-10"
            style={{ color: "hsl(var(--olivewood) / 0.80)" }}
            aria-label={`${totalTicked} of ${items.length} packed`}
          >
            {totalTicked}/{items.length}
          </span>
          {open ? (
            <ChevronUp
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: "hsl(var(--olivewood) / 0.80)" }}
              aria-hidden="true"
            />
          ) : (
            <ChevronDown
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: "hsl(var(--olivewood) / 0.80)" }}
              aria-hidden="true"
            />
          )}
        </span>
      </button>

      {open && (
        <ul
          id={`what-to-bring-${jobId}`}
          className="px-3 pb-2.5 pt-0.5 space-y-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item) => {
            const id = `what-to-bring-${jobId}-${item}`;
            const isChecked = checked.has(item);
            return (
              <li key={item} className="flex items-start gap-2.5">
                <Checkbox
                  id={id}
                  checked={isChecked}
                  onCheckedChange={() => toggle(item)}
                  className="mt-0.5"
                />
                <label
                  htmlFor={id}
                  className={`text-ds-13 leading-snug cursor-pointer select-none ${
                    isChecked ? "line-through opacity-60" : ""
                  }`}
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  {item}
                </label>
              </li>
            );
          })}
          <li
            className="pt-1 text-ds-10 italic"
            style={{ color: "hsl(var(--olivewood) / 0.80)" }}
          >
            Suggestions only — your call what to actually pack.
          </li>
        </ul>
      )}
    </div>
  );
}

export default WhatToBringChecklist;
