/**
 * How a guest's support ticket says who wrote in. A guest has no account, so the
 * `reports` row has no reporter and a fixed `reported_id`, and its description
 * ends with a "Guest: <name> <<email>>" line. contact-support writes it;
 * admin-support-reply (where to send the reply) and AdminSupport (who to show)
 * read it. All three import this one module so the format cannot drift.
 */

/** reports.reported_id is NOT NULL with no foreign key; a guest's ticket is about nobody. */
export const SUPPORT_GUEST_REPORTED_ID = '00000000-0000-0000-0000-000000000000'

const LINE = /\n\nGuest: ([^\n]+) <([^\s@<>]+@[^\s@<>]+)>$/

export type SupportGuest = { name: string; email: string }

/** Appended AFTER everything the guest typed, so the end of the description is always the real one. */
export function supportGuestLine(name: string, email: string): string {
  return `\n\nGuest: ${name} <${email}>`
}

/** Only a ticket with no reporter can be a guest's: a member could type this line into their own message. */
export function splitSupportGuest(
  description: string,
  reporterId: string | null,
): { body: string; guest: SupportGuest | null } {
  if (reporterId) return { body: description, guest: null }
  const m = LINE.exec(description)
  if (!m) return { body: description, guest: null }
  return { body: description.slice(0, m.index), guest: { name: m[1], email: m[2] } }
}

/** The short ticket number a guest's follow-up quotes, and the inbox shows beside the ticket. */
export function supportTicketRef(reportId: string): string {
  return reportId.slice(0, 8)
}
