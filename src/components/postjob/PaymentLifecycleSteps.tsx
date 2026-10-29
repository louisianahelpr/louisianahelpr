import { JobProgress } from "@/components/tracker/JobProgress";
// The visibility delay is DERIVED, never retyped — `public.early_access_cutoff()`
// is the enforcement point and `earlyAccess.ts` is the client mirror the parity
// test already pins it to. See the "Posted" caption below.
import { earlyAccessDelayMs } from "@/lib/earlyAccess";
import { useMembershipsOn } from "@/hooks/useMembershipsOn";
import { assertNeverSafe } from "@/lib/assertNever";
import type { JobStatus } from "@/lib/statusLabels";

/** Extracted from PaymentSuccess (component-size ratchet, 2026-10-05); unchanged markup. */
// Visual lifecycle preview — replaces the dense paragraph that used to
// sit in this same slot. Keeps the same content (4 stages from job-state
// machine: open → accepted → in_progress → completed) but presents it
// as scannable steps so customers know what to expect next.
/** What each lifecycle point means, for the line under the one tracker (Posted, Hired, Working, Done). */
const STEP_CAPTIONS = [
  "",
  "You review applicants and pick one.",
  "Your Helpr arrives and gets to work.",
  "You both confirm, and the payment goes out.",
] as const;

/**
 * The Posted caption: how long the longest-waiting Helpr (no membership) waits, from the
 * client mirror of public.early_access_delay_minutes() (earlyAccessDelayMs): 0 while
 * memberships are off, which is today for every member (audit 2026-10-28 F15: the
 * page promised "within 20 min" while members saw the job at once).
 */
function liveNowCaption(delayMinutes: number): string {
  return delayMinutes > 0 ? `Live now. Nearby Helprs see it within ${delayMinutes} min.` : "Live now. Nearby Helprs can see it.";
}

/** Posted · Hired · Working · Done on the one 8-step tracker: Posted, Hired, Working, all done. */
const STAGE_OF = [0, 2, 6, 8] as const;

/**
 * Q1788: which step the job is ACTUALLY on. The page used to mark "Posted" for
 * every job, so a poster reopening it for a job already in progress (prod
 * 2026-10-13, SEED Repaint a porch railing) was told the wrong stage. Driven by
 * jobs.status; a released payment is the last step whatever the status says.
 * No status read yet means the job just posted (step 0, as before). A
 * cancelled job, or a status this list does not know, marks no step.
 */
export function lifecycleStepFor(rawStatus: string | null | undefined, released = false): number | null {
  if (released) return 3;
  // Typed on the generated job_status enum so a new member is a build error
  // here (jobStatusExhaustive); a string the enum does not know still marks no step.
  const status = rawStatus as JobStatus | null | undefined;
  switch (status) {
    case null:
    case undefined:
    case "open":
    case "pending_approval":
      return 0;
    case "accepted":
      return 1;
    case "in_progress":
    case "revision_requested":
    case "disputed":
      return 2;
    case "completed":
      return 3;
    case "cancelled":
      return null;
    default:
      return assertNeverSafe(status, null, "PaymentLifecycleSteps status");
  }
}

/**
 * The confirmed-payment screen's tracker: THE one tracker (owner, 2026-10-21), the same four segments as chat,
 * the job page and the cards, with what the current step means under it.
 */
export function PaymentLifecycleSteps({ current = 0 }: { current?: number | null }) {
  const delayMinutes = earlyAccessDelayMs(null, useMembershipsOn()) / 60_000;
  if (current === null) return null;
  const at = Math.min(3, Math.max(0, current));
  return (
    <div className="mt-3">
      <JobProgress progress={{ stage: STAGE_OF[at], waitingOnYou: false, tone: "progress", word: "", next: at === 0 ? liveNowCaption(delayMinutes) : STEP_CAPTIONS[at], held: false }} />
    </div>
  );
}
