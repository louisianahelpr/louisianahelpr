
// Moved out of ReportDialog.tsx unchanged (component-size ratchet, Q806).
export type ReportedType = "job" | "message" | "user" | "review" | "application" | "declutter_item" | "declutter_wanted" | "declutter_question" | "declutter_answer" | "declutter_review" | "shop" | "shop_item" | "shop_talk_message" | "home_listing" | "home_talk_message" | "shop_review";

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
  // F430 (audit 11-10): most chat reports are for off-Helpr payment or harassment, so those lead.
  user: [
    { label: "Payment requested off Helpr" },
    { label: "Harassment or abuse" },
    { label: "Spam or scam" },
    { label: "Fake profile or impersonation" },
    { label: "Unsafe or threatening behavior" },
    { label: "Inappropriate content" },
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
  // A3-75 (audit 11-01): a Declutter review, as a Jobs review is reported (plus contact info, which reviews refuse).
  declutter_review: [
    { label: "Fake or dishonest review" },
    { label: "Harassment or abuse" },
    { label: "Inappropriate content" },
    { label: "Shares contact info" },
    { label: "Something else" },
  ],
  // Q1948 (20261112094500): a Shops review, as a Declutter review.
  shop_review: [
    { label: "Fake or dishonest review" },
    { label: "Harassment or abuse" },
    { label: "Inappropriate content" },
    { label: "Shares contact info" },
    { label: "Something else" },
  ],
  // Shops H2 (audit 11-05): shops and items go live at once, so members report the ones that slip through.
  shop: [
    { label: "Scam or fake shop" },
    { label: "Sells something not allowed" },
    { label: "Offensive" },
    { label: "Shares contact info" },
    { label: "Something else" },
  ],
  shop_item: [
    { label: "Not allowed to be sold" },
    { label: "Scam or fake" },
    { label: "Wrong category or misleading" },
    // Digital downloads (owner 11-08): a file copied from someone else's book or art.
    { label: "Copyright problem" },
    { label: "Offensive" },
    { label: "Shares contact info" },
    { label: "Something else" },
  ],
  // Q1947: a message in a shop chat (Messages -> Shops, or the chat on a shop's page or order card).
  shop_talk_message: [
    { label: "Spam or scam" },
    { label: "Harassment or abuse" },
    { label: "Threats or violence" },
    { label: "Inappropriate content" },
    { label: "Payment requested off Helpr" },
    { label: "Something else" },
  ],
  // Homes report (audit 11-05 A-H2): a rent or for-sale listing. Listings go live at once once the property is
  // approved, so members report the ones that slip through. Fair housing first: a listing may not state a preference
  // by a protected class (42 U.S.C. 3604(c); La. R.S. 51:2606).
  home_listing: [
    { label: "Discriminates (fair housing)" },
    { label: "Scam or fake listing" },
    { label: "Not the real owner" },
    { label: "Wrong or misleading details" },
    { label: "Shares contact info" },
    { label: "Something else" },
  ],
  // Homes messages (audit 11-05 A-H1): a message in a Homes chat, reported by the other side of that chat only
  // (report_message_party_and_copy, 20261106191100). Fair housing first, as on the listing; then wire and deposit scams.
  home_talk_message: [
    { label: "Discriminates (fair housing)" },
    { label: "Spam or scam" },
    { label: "Payment requested off Helpr" },
    { label: "Harassment or abuse" },
    { label: "Threats or violence" },
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
  declutter_review: "Review",
  shop_review: "Review",
  shop: "Shop",
  shop_item: "Item",
  shop_talk_message: "Message",
  home_listing: "Listing",
  home_talk_message: "Message",
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
  declutter_review: "review",
  shop_review: "review",
  shop: "shop",
  shop_item: "item",
  shop_talk_message: "message",
  home_listing: "listing",
  home_talk_message: "message",
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
  declutter_review: "What's wrong with this review?",
  shop_review: "What's wrong with this review?",
  shop: "What's wrong with this shop?",
  shop_item: "What's wrong with this item?",
  shop_talk_message: "What's wrong with this message?",
  home_listing: "What's wrong with this listing?",
  home_talk_message: "What's wrong with this message?",
};
