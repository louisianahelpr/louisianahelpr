/**
 * DisputeLink — discoverable, low-encouragement "Open a dispute" link
 * for completed jobs on either side of the marketplace.
 *
 * Issue #113: the dispute path used to be buried in primary action
 * buttons that only appear in a narrow slice of the lifecycle. This
 * link is intentionally muted (sienna underline, footer placement) so
 * it is *findable* without being *promoted* — disputes are a last
 * resort, not a CTA.
 *
 * Visibility rules (see `shouldShowDisputeLink` for the truth table):
 *   - Customer side: visible when job is `completed` for up to 7 days,
 *     OR while a `revision_requested` state is open.
 *   - Helper side: visible when job is `completed` for up to 7 days.
 *   - Always hidden once `status === 'disputed'` (dispute already
 *     filed — we never want to encourage double-filing) or
 *     `disputed_at` is set, or after the 7-day window closes.
 *
 * Mount below the action buttons inside an existing card; renders
 * `null` when the conditions don't hold so callers can place it
 * unconditionally and let this component decide.
 */
import { AlertTriangle } from "lucide-react";
import { hapticLight } from "@/lib/haptics";

/** The minimal slice of `jobs` row this component cares about. */
export interface DisputeLinkJob {
  status: string;
  /** Set when the customer approves & releases — our canonical "done" moment. */
  poster_completed_at: string | null;
  /** Helper-side completion timestamp — fallback if poster_completed_at isn't set yet. */
  helper_completed_at: string | null;
  /** Set the moment any party files a dispute — hide unconditionally. */
  disputed_at: string | null;
  /** Set when the customer asks for a fix — keeps the link visible for the customer side. */
  revision_requested_at: string | null;
}

export type DisputeLinkSide = "customer" | "helper";

const DISPUTE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pure visibility predicate, exported so the test suite can drive every
 * branch without rendering JSX. Keep the rules here, not in the JSX.
 */
export function shouldShowDisputeLink(
  job: DisputeLinkJob,
  side: DisputeLinkSide,
  now: Date = new Date(),
): boolean {
  // Already filed → never show; we don't want a double-file path.
  if (job.disputed_at) return false;
  if (job.status === "disputed") return false;

  // Customer can still reach dispute while a revision is pending —
  // that's the entire point of the revision → dispute escalation flow.
  if (side === "customer" && job.status === "revision_requested") return true;

  // Otherwise the job must be `completed` to qualify.
  if (job.status !== "completed") return false;

  // Anchor the 7-day window on the canonical completion timestamp.
  // poster_completed_at is set by the customer's "Approve & release"
  // action — the moment escrow releases. Fall back to helper_completed_at
  // for jobs that completed via auto-release (poster never confirmed).
  const completedAtIso = job.poster_completed_at ?? job.helper_completed_at;
  if (!completedAtIso) return false;

  const completedAt = new Date(completedAtIso).getTime();
  if (Number.isNaN(completedAt)) return false;

  return now.getTime() - completedAt <= DISPUTE_WINDOW_MS;
}

interface DisputeLinkProps {
  job: DisputeLinkJob;
  /** Which side of the job is viewing this card — drives the visibility predicate. */
  side: DisputeLinkSide;
  /**
   * Click handler — caller is responsible for opening the existing
   * dispute UI (e.g. setting the `disputeJob` state that
   * `ActivityDialogs` reads). We don't route here so the link stays
   * decoupled from any specific dialog wiring.
   */
  onOpenDispute: () => void;
  /** Override "now" for deterministic tests. */
  now?: Date;
  /** Optional className for the wrapper (caller controls spacing). */
  className?: string;
}

export function DisputeLink({
  job,
  side,
  onOpenDispute,
  now,
  className,
}: DisputeLinkProps) {
  if (!shouldShowDisputeLink(job, side, now)) return null;

  return (
    <div className={`pt-2 text-center ${className ?? ""}`}>
      <button
        type="button"
        onClick={(e) => {
          // Cards above us use whole-card click handlers to toggle the
          // expanded state — keep our click from bubbling so opening
          // the dispute doesn't also collapse/expand the card.
          e.stopPropagation();
          hapticLight();
          onOpenDispute();
        }}
        className="inline-flex items-center gap-1 text-ds-11 underline underline-offset-2 hover:opacity-80 active:opacity-70 transition-opacity"
        style={{ color: "hsl(var(--burnt-sienna))" }}
        aria-label="Open a dispute about this job"
      >
        <AlertTriangle className="w-3 h-3" strokeWidth={2.25} />
        Something Wrong? Open a Dispute
      </button>
    </div>
  );
}
