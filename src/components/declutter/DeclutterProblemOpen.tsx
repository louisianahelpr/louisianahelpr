import type { OpenProblem, ProblemReason } from "@/lib/declutter/handover";

/** The reason in words both sides can read (the form's own words are the reporter's: "I didn't get it"). */
const REASON_WORDS: Record<ProblemReason, string> = {
  not_as_described: "Not as described",
  damaged: "Damaged",
  not_received: "Not received",
  no_show: "Someone didn't show",
  safety: "Felt unsafe",
  other: "Something else",
};

/** The note's headline while a problem is open. */
export const PROBLEM_OPEN_HEADLINE = "Problem reported: Louisiana Helpr is looking.";
/** Where the order stands while a problem is open (the server refuses booking and a no-show then: problem_open). */
export const PROBLEM_ON_HOLD = "On hold while Louisiana Helpr looks at the problem.";

/**
 * Audit 1b D2-2: after "Report a problem", both order cards say a problem is open, with its reason and who reported
 * it. The money is held until an admin decides (declutter_report_problem's notice; the payout waits on it).
 */
export function ProblemOpenNote({ problem, side }: { problem: OpenProblem; side: "buyer" | "seller" }) {
  const by = problem.reporter_side === side ? "you" : `the ${problem.reporter_side}`;
  return (
    <div role="status" className="rounded-xl border border-border px-3 py-2 text-ds-13" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }} data-problem-open="">
      <p className="font-semibold">{PROBLEM_OPEN_HEADLINE}</p>
      <p className="text-muted-foreground">
        {REASON_WORDS[problem.reason] ?? REASON_WORDS.other}, reported by {by}. {side === "seller" ? "Your money is held until they decide." : "Nobody is paid until they decide."}
      </p>
    </div>
  );
}
