import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { hapticLight, hapticSuccess, hapticError } from "@/lib/haptics";
import { track } from "@/lib/analytics";
import {
  checkNpsEligibility,
  submitNps,
  setNpsLocalCooldown,
  type NpsRole,
} from "@/lib/nps";

/**
 * NpsPrompt — bottom-sheet Net Promoter Score survey.
 *
 * Self-gating: pass `userId` and the prompt internally checks
 * `checkNpsEligibility` before opening. Mount it once high up in a flow
 * (CompletionPrompts → onDone) and it'll either show or stay silent.
 *
 * UX rules:
 *   - Never blocking — bottom sheet, dismissible via Maybe later / overlay tap.
 *   - 0..10 picker. The "Send" button only enables once a score is chosen.
 *   - Optional free-text comment, revealed only after a score is selected.
 *   - "Maybe later" sets the 90-day localStorage cooldown.
 *   - "Send" persists to nps_responses + fires `nps_submitted` analytics.
 */
export interface NpsPromptProps {
  userId: string;
  /**
   * Called when the prompt closes (either submitted, dismissed, or never
   * shown because the user was ineligible). The parent uses this to chain
   * any follow-up state cleanup.
   */
  onClose?: () => void;
}

type LoadState =
  | { stage: "checking" }
  | { stage: "hidden"; reason: string }
  | { stage: "visible"; role: NpsRole; jobsCompleted: number };

const ANCHORS = ["Not likely", "Very likely"] as const;

export function NpsPrompt({ userId, onClose }: NpsPromptProps) {
  const [state, setState] = useState<LoadState>({ stage: "checking" });
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [open, setOpen] = useState(false);

  // Eligibility check runs once on mount. If the user qualifies, the
  // sheet opens; otherwise we silently call onClose so the parent can
  // move on without a flash of an empty prompt.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await checkNpsEligibility(userId);
        if (cancelled) return;
        if (result.eligible) {
          setState({
            stage: "visible",
            role: result.role,
            jobsCompleted: result.jobsCompleted,
          });
          setOpen(true);
          track("nps_prompt_shown", { role: result.role, jobs_completed: result.jobsCompleted });
        } else {
          setState({ stage: "hidden", reason: result.reason });
          onClose?.();
        }
      } catch {
        // Treat any unexpected failure as "not eligible" — analytics surveys
        // must never block a job-completion flow.
        if (cancelled) return;
        setState({ stage: "hidden", reason: "error" });
        onClose?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, onClose]);

  const dismiss = (reason: "maybe-later" | "overlay") => {
    setNpsLocalCooldown();
    track("nps_prompt_dismissed", { reason, has_score: score !== null });
    setOpen(false);
    onClose?.();
  };

  const handleSend = async () => {
    if (state.stage !== "visible" || score === null) return;
    setSubmitting(true);
    try {
      await submitNps({
        userId,
        score,
        comment,
        role: state.role,
        jobsCompleted: state.jobsCompleted,
      });
      hapticSuccess();
      track("nps_submitted", {
        score,
        has_comment: Boolean(comment.trim()),
        role: state.role,
      });
      // Set the local cooldown too — server lookup is the canonical guard
      // but the local one keeps us silent during the 100ms before the row
      // becomes readable through the API.
      setNpsLocalCooldown();
      setOpen(false);
      onClose?.();
    } catch (err) {
      hapticError();
      const message = err instanceof Error ? err.message : "Couldn't send your feedback — try again?";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (state.stage !== "visible") return null;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss("overlay");
      }}
    >
      <SheetContent
        side="bottom"
        // Brand parchment ground with a subtle olive border. Brand tokens
        // are CSS variables, not Tailwind theme entries — use the hsl(var(...))
        // form (bg-parchment would silently no-op).
        className="bg-[hsl(var(--parchment))] border-[hsl(var(--bark)/0.18)]"
      >
        <SheetHero title="How Are We Doing?" />

        <div className="mt-5 space-y-4">
          {/* 0..10 row. On narrow viewports the row stays one line because
              each button is `min-w-0 flex-1` and the parent uses `flex` (no
              wrap). text-ds-10 keeps the digits legible at the smallest
              iPhone widths. */}
          <div
            className="flex w-full gap-1"
            role="radiogroup"
            aria-label="Likelihood to recommend, 0 to 10"
          >
            {Array.from({ length: 11 }, (_, i) => i).map((n) => {
              const selected = score === n;
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`Score ${n}`}
                  onClick={() => {
                    hapticLight();
                    setScore(n);
                  }}
                  className={cn(
                    "flex-1 min-w-0 h-11 rounded-ds-md border text-ds-13 font-semibold transition-colors",
                    selected
                      ? "bg-[hsl(var(--bark))] text-[hsl(var(--parchment))] border-[hsl(var(--bark))]"
                      : "bg-[hsl(var(--parchment))] text-[hsl(var(--olivewood))] border-[hsl(var(--bark)/0.25)] hover:bg-[hsl(var(--bark)/0.08)]",
                  )}
                >
                  {n}
                </button>
              );
            })}
          </div>

          <div className="flex justify-between text-ds-11 text-[hsl(var(--olivewood)/0.8)] px-1">
            <span>{ANCHORS[0]}</span>
            <span>{ANCHORS[1]}</span>
          </div>

          {/* Comment textarea appears only after a score is chosen so the
              prompt feels lightweight to anyone who just wants to tap a
              number and dismiss. */}
          {score !== null && (
            <div className="space-y-2 animate-in fade-in duration-200">
              <label
                htmlFor="nps-comment"
                className="text-ds-11 font-medium text-[hsl(var(--olivewood)/0.8)]"
              >
                Anything you'd like to share? (optional)
              </label>
              <Textarea
                id="nps-comment"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="bg-[hsl(var(--parchment))] border-[hsl(var(--bark)/0.25)] focus-visible:ring-[hsl(var(--bark))]"
                maxLength={500}
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            <Button
              variant="ghost"
              onClick={() => dismiss("maybe-later")}
              disabled={submitting}
              className="text-[hsl(var(--olivewood)/0.8)]"
            >
              Maybe Later
            </Button>
            <Button
              variant="primary"
              onClick={handleSend}
              disabled={submitting || score === null}
              className="px-6"
            >
              {submitting ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default NpsPrompt;
