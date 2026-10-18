import { AlertTriangle, Banknote, BadgeAlert, EyeOff, FileWarning, MoreHorizontal, ShieldAlert, Star, UserX } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Moved out of ReportDialog.tsx unchanged (component-size ratchet, Q806).
export type ReportedType = "job" | "message" | "user" | "review" | "application";

interface Reason {
  label: string;
  Icon: LucideIcon;
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
    { label: "Spam or scam", Icon: AlertTriangle },
    { label: "Misleading or fake listing", Icon: FileWarning },
    { label: "Unsafe or illegal work", Icon: ShieldAlert },
    { label: "Inappropriate content", Icon: EyeOff },
    { label: "Payment requested off Helpr", Icon: Banknote },
    { label: "Something else", Icon: MoreHorizontal },
  ],
  message: [
    { label: "Spam or scam", Icon: AlertTriangle },
    { label: "Harassment or abuse", Icon: UserX },
    { label: "Threats or violence", Icon: ShieldAlert },
    { label: "Inappropriate content", Icon: EyeOff },
    { label: "Payment requested off Helpr", Icon: Banknote },
    { label: "Something else", Icon: MoreHorizontal },
  ],
  user: [
    { label: "Fake profile or impersonation", Icon: BadgeAlert },
    { label: "Spam or scam", Icon: AlertTriangle },
    { label: "Harassment or abuse", Icon: UserX },
    { label: "Unsafe or threatening behavior", Icon: ShieldAlert },
    { label: "Inappropriate content", Icon: EyeOff },
    { label: "Payment requested off Helpr", Icon: Banknote },
    { label: "Something else", Icon: MoreHorizontal },
  ],
  // Q366 (TS-006): an application is the first place a scam reaches a poster.
  application: [
    { label: "Spam or scam", Icon: AlertTriangle },
    { label: "Fake profile or impersonation", Icon: BadgeAlert },
    { label: "Payment requested off Helpr", Icon: Banknote },
    { label: "Harassment or abuse", Icon: UserX },
    { label: "Inappropriate content", Icon: EyeOff },
    { label: "Something else", Icon: MoreHorizontal },
  ],
  review: [
    { label: "Fake or dishonest review", Icon: Star },
    { label: "Harassment or abuse", Icon: UserX },
    { label: "Inappropriate content", Icon: EyeOff },
    { label: "Shares private information", Icon: BadgeAlert },
    { label: "Something else", Icon: MoreHorizontal },
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
};
