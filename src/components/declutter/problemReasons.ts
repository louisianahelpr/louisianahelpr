import type { ProblemReason } from "@/lib/declutter/handover";

/**
 * Audit 1028 part 2, D2-11 and D2-8: the "Report a problem" reasons fit who reports and when (the server takes any of
 * them; declutter_report_problem). "waiting": the booked pickup is over and nothing was handed over, so the buyer can
 * say they didn't get it, never "damaged" about an item they haven't seen. "handover": the buyer has the item in
 * front of them ("Something's not right" in the "I got it" sheet) or already has it, so never "I didn't get it".
 * "delivery": a Helpr or the seller brings it. The seller reports the buyer not coming, never the buyer's reasons.
 */
export type ProblemStage = "waiting" | "handover" | "delivery";

export const PROBLEM_REASONS: Record<"buyer" | "seller", Record<ProblemStage, [ProblemReason, string][]>> = {
  buyer: {
    waiting: [["not_received", "I didn't get it"], ["safety", "I felt unsafe"], ["other", "Something else"]],
    handover: [["not_as_described", "It isn't as described"], ["damaged", "It's damaged"], ["safety", "I felt unsafe"], ["other", "Something else"]],
    delivery: [["not_received", "I didn't get it"], ["not_as_described", "It isn't as described"], ["damaged", "It's damaged"], ["other", "Something else"]],
  },
  seller: {
    waiting: [["no_show", "The buyer didn't come"], ["safety", "I felt unsafe"], ["other", "Something else"]],
    handover: [["no_show", "The buyer didn't come"], ["safety", "I felt unsafe"], ["other", "Something else"]],
    delivery: [["other", "Something else"], ["safety", "I felt unsafe"]],
  },
};
