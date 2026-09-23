import { AhaEvent, track } from "@/lib/analytics";

/**
 * `message_sent` (Q283): one event per message a person sends, emitted by the
 * one client send path (createSendHandlers' dispatchMessage) once the server
 * row is in hand. Keyed on the SERVER row id, so a retry that reconciles with a
 * row that already landed (the Q268 23505 read-back) still counts that message
 * once. Monitored by scripts/lib/analyticsFreshness.mjs KEY_EVENTS against the
 * non-system rows of public.messages.
 *
 * Never sends the text: content is user-written and may hold contact details.
 */
const emitted = new Set<string>();

export function trackMessageSent(
  row: { id: string; job_id: string; attachment_url?: string | null; reply_to_id?: string | null },
): boolean {
  if (emitted.has(row.id)) return false;
  emitted.add(row.id);
  track(AhaEvent.MessageSent, {
    job_id: row.job_id,
    has_attachment: !!row.attachment_url,
    is_reply: !!row.reply_to_id,
  });
  return true;
}

export function __resetMessageSentForTests() {
  emitted.clear();
}
