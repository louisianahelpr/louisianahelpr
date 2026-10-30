/**
 * The "Guest: <name> <<email>>" line that ends a guest's support ticket in
 * `reports.description`, written by supabase/functions/contact-support and read
 * by AdminSupport. A guest has no account, so `reporter_id` is null and the
 * ticket itself says who wrote in. src/test/edge/contactSupportGuestInbox.test.ts
 * runs the real function's description through this reader.
 */
const LINE = /\n\nGuest: ([^\n]+) <([^\s@<>]+@[^\s@<>]+)>$/;

export type SupportGuest = { name: string; email: string };

/**
 * Only a ticket with no reporter can be a guest's: a member could type this line
 * into their own message. The writer appends the line after the typed text, so
 * the end of the description is always the real one, whatever a guest typed.
 */
export function splitSupportGuest(
  description: string,
  reporterId: string | null,
): { body: string; guest: SupportGuest | null } {
  if (reporterId) return { body: description, guest: null };
  const m = LINE.exec(description);
  if (!m) return { body: description, guest: null };
  return { body: description.slice(0, m.index), guest: { name: m[1], email: m[2] } };
}

/** The address was typed by a stranger, so each part is encoded: `?bcc=` in it stays part of the address. */
export function guestReplyHref(guest: SupportGuest, subject: string): string {
  const at = guest.email.lastIndexOf("@");
  const to = `${encodeURIComponent(guest.email.slice(0, at))}@${encodeURIComponent(guest.email.slice(at + 1))}`;
  return `mailto:${to}?subject=${encodeURIComponent(`Louisiana Helpr: ${subject}`)}`;
}
