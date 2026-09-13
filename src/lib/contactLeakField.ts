// Contact-leak guard for the PUBLIC text fields — job title, job description,
// profile bio. Since 20260913020635 the database REJECTS a write to any of
// them that carries a phone number, email, payment app or off-platform
// phrase (check_violation 23514 from reject_contact_leak_in_job /
// _in_profile). Messages get hidden; a post or a bio has no recipient to
// hide it from, so it never lands at all.
//
// The client runs the same scanner (scanMessage, advisory) BEFORE submit so
// the user sees an inline field error and a fix, instead of a failed save.
// When the server still says no, its message is shown VERBATIM — it names
// the class and the field, and it is the authority.
import { scanMessage } from "./messageScanner";

export type ContactLeakField = "job title" | "job description" | "bio";

/** Inline error for a public text field, or null when it is clean. */
export function contactLeakFieldError(text: string, field: ContactLeakField): string | null {
  const hits = scanMessage(text ?? "");
  if (hits.length === 0) return null;
  const where = field === "bio" ? "your bio" : `the ${field}`;
  const fix = field === "bio"
    ? "Keep contact details and payment off your profile; hiring and payment happen in the app."
    : "Keep contact details and payment off the post; hiring and payment happen in the app.";
  return `${hits[0].label} in ${where} ("${hits[0].match}"). ${fix}`;
}

/**
 * The server's own rejection message when a write was refused by the
 * contact-leak trigger; null for any other error. `code` is PostgREST's
 * SQLSTATE passthrough; the message text is the trigger's, user-readable.
 */
export function contactLeakRejectionMessage(err: unknown): string | null {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  if (!e || e.code !== "23514" || typeof e.message !== "string") return null;
  return /(detected|mentioned) in (the job|your bio)/i.test(e.message) ? e.message : null;
}
