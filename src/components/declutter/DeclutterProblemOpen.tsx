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
const PROBLEM_OPEN_HEADLINE = "Problem reported: Louisiana Helpr is looking.";
/** Where the order stands while a problem is open (the server refuses booking and a no-show then: problem_open). */
export const PROBLEM_ON_HOLD = "On hold while Louisiana Helpr looks at the problem.";
/**
 * NIGHT-BUYINGopenpr-6: a held order said nothing of what happens next. The decision sends both sides a notice
 * (declutter_admin_decide_problem: declutter_notify to buyer and seller, "Louisiana Helpr decided"). No time is said:
 * there is no deadline on a decision or on adding a side (declutter_problems has none), so none is promised.
 */
const PROBLEM_NEXT = "Next: they read both sides, then send you both a notice with what they decide.";

function noShowAnsweredWords(side: "buyer" | "seller", delivery: boolean) {
  if (side === "buyer") return delivery ? "You reported it wasn't delivered, and the seller answered." : "You reported the seller didn't show, and the seller answered.";
  return delivery ? "The buyer reported it wasn't delivered, and you answered." : "The buyer reported you didn't show, and you answered.";
}

/**
 * Audit 1b D2-2: after "Report a problem", both order cards say a problem is open, with its reason and who reported
 * it. The money is held until an admin decides (declutter_report_problem's notice; the payout waits on it).
 */
export function ProblemOpenNote({ problem, side, answered = false, delivery = false }: { problem: OpenProblem; side: "buyer" | "seller"; answered?: boolean; delivery?: boolean }) {
  // NIGHT-BUYINGopenpr-8: "the helpr" was written with a small h; Helpr is a name (the next box says "The Helpr").
  const by = problem.reporter_side === side ? "you" : problem.reporter_side === "helpr" ? "the Helpr" : `the ${problem.reporter_side}`;
  // A buyer's no-show report the seller answered (declutter_answer_no_show): whose report it is, and who answered it.
  const noShowAnswered = answered && problem.reporter_side === "buyer" && problem.reason === "no_show";
  // Nobody's report: a sale held 60 days with nobody speaking (20261031004529).
  const reported = problem.reporter_side === "system" ? "Nobody has confirmed this handover for 60 days."
    : noShowAnswered ? noShowAnsweredWords(side, delivery)
    : `${REASON_WORDS[problem.reason] ?? REASON_WORDS.other}, reported by ${by}.`;
  return (
    <div role="status" className="rounded-xl border border-border px-3 py-2 text-ds-13" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }} data-problem-open="">
      <p className="font-semibold">{PROBLEM_OPEN_HEADLINE}</p>
      <p className="text-muted-foreground">
        {reported} {side === "seller" ? "Your money is held until they decide." : "Nobody is paid until they decide."}
      </p>
      <p className="text-muted-foreground" data-problem-next="">{PROBLEM_NEXT}</p>
    </div>
  );
}
