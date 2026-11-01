
// Moved out of ReportDialog.tsx unchanged (component-size ratchet, Q806).
export type ReportedType = "job" | "message" | "user" | "review" | "application" | "declutter_item" | "declutter_wanted" | "declutter_question" | "declutter_answer";

interface Reason {
  label: string;
}

/**
 * REASONS ARE PER-CONTEXT. This dialog is the single report surface for five
 * different things (job / message / user / review / application — see the call-site map in
 * the props doc below), and the old shared list asked every reporter about a
 * "Fake profile" even when they were reporting a job listing or a single chat
 * message. Each context now offers only reasons that can actually be true of
 * it, which is also what makes the admin queue's `reason` column worth
 * reading.
 *
 * `reason` is stored as free text (`reports.reason`, no CHECK), so adding or
 * renaming an entry here is safe; it is rendered verbatim in AdminReports.
 */
export const REASONS: Record<ReportedType, readonly Reason[]> = {
  job: [
    { label: "Spam or scam" },
    { label: "Misleading or fake listing" },
    { label: "Unsafe or illegal work" },
    { label: "Inappropriate content" },
    { label: "Payment requested off Helpr" },
    { label: "Something else" },
  ],
  message: [
    { label: "Spam or scam" },
    { label: "Harassment or abuse" },
    { label: "Threats or violence" },
    { label: "Inappropriate content" },
    { label: "Payment requested off Helpr" },
    { label: "Something else" },
  ],
  user: [
    { label: "Fake profile or impersonation" },
    { label: "Spam or scam" },
    { label: "Harassment or abuse" },
    { label: "Unsafe or threatening behavior" },
    { label: "Inappropriate content" },
    { label: "Payment requested off Helpr" },
    { label: "Something else" },
  ],
  // Q366 (TS-006): an application is the first place a scam reaches a poster.
  application: [
    { label: "Spam or scam" },
    { label: "Fake profile or impersonation" },
    { label: "Payment requested off Helpr" },
    { label: "Harassment or abuse" },
    { label: "Inappropriate content" },
    { label: "Something else" },
  ],
  review: [
    { label: "Fake or dishonest review" },
    { label: "Harassment or abuse" },
    { label: "Inappropriate content" },
    { label: "Shares private information" },
    { label: "Something else" },
  ],
  // Item B (owner 2026-10-29): listings go live when posted, so members report the ones that slip through.
  // The six reasons are the lead's (2026-10-30).
  declutter_item: [
    { label: "Prohibited item" },
    { label: "Scam or fake" },
    { label: "Wrong category or misleading" },
    { label: "Offensive" },
    { label: "Shares contact info" },
    { label: "Something else" },
  ],
  // Posting audit 10-30 #8: a Wanted post goes live when posted, so members report the ones that slip through.
  declutter_wanted: [
    { label: "Prohibited item" },
    { label: "Scam or fake" },
    { label: "Offensive" },
    { label: "Shares contact info" },
    { label: "Something else" },
  ],
  // B48 (owner decision 10-31, App Store 1.2): the public questions and answers on a listing.
  declutter_answer: [
    { label: "Harassment or abuse" },
    { label: "Offensive" },
    { label: "Spam or scam" },
    { label: "Shares contact info" },
    { label: "Something else" },
  ],
  declutter_question: [
    { label: "Harassment or abuse" },
    { label: "Offensive" },
    { label: "Spam or scam" },
    { label: "Shares contact info" },
    { label: "Something else" },
  ],
};

/**
 * Title Case display noun per PLATFORM_CONVENTIONS §1 (popup titles). The
 * title is COMPUTED from `reportedType`, which is why the 2026-08-24 casing
 * sweep missed it — the literal "Report User" never appears in source for a
 * lexical grep to find.
 */
export const REPORTED_NOUN: Record<ReportedType, string> = {
  job: "Job",
  message: "Message",
  user: "User",
  review: "Review",
  application: "Application",
  declutter_item: "Listing",
  declutter_wanted: "Wanted Post",
  declutter_question: "Question",
  declutter_answer: "Answer",
};

/**
 * Lower-case noun for running prose. Separate from REPORTED_NOUN because the
 * title's noun and the sentence's noun genuinely differ for one case: the
 * popup is titled "Report User", but "decides what happens to the user" reads
 * wrong mid-sentence where "account" is the thing being acted on.
 */
export const REPORTED_NOUN_INLINE: Record<ReportedType, string> = {
  job: "job",
  message: "message",
  user: "account",
  review: "review",
  application: "application",
  declutter_item: "listing",
  declutter_wanted: "Wanted post",
  declutter_question: "question",
  declutter_answer: "answer",
};

/**
 * The question the reason list answers, in the reporter's own terms. It is
 * the list's ACCESSIBLE name only — it is deliberately not painted (see the
 * reason step below); the dialog title and lede already say it on screen.
 */
export const REASON_PROMPT: Record<ReportedType, string> = {
  job: "What's wrong with this job?",
  message: "What's wrong with this message?",
  user: "What's wrong with this account?",
  review: "What's wrong with this review?",
  application: "What's wrong with this application?",
  declutter_item: "What's wrong with this listing?",
  declutter_wanted: "What's wrong with this Wanted post?",
  declutter_question: "What's wrong with this question?",
  declutter_answer: "What's wrong with this answer?",
};
