/**
 * One email, one email_send_log row (Declutter audits 2026-10-28, LO2-2 / A2-16).
 *
 * queueEmail (_shared/resend.ts) writes a 'pending' row when it enqueues a message. process-email-queue then
 * decides the outcome. Its 'sent' and 'failed' paths already UPDATE that row; the 'suppressed' (test or reserved
 * recipient) and 'dlq' (TTL, max retries) paths INSERTED a second row instead, so the 'pending' one never
 * resolved. Measured on prod 2026-10-28 (read-only): 114 message ids carried a stuck 'pending' row beside a
 * terminal one (75 'dlq', 39 'suppressed'), across every template (job applications, welcome drips, recovery,
 * Declutter receipts...).
 *
 * finalizeSendLog moves the message's open row ('pending', or 'failed' from an earlier try) to its terminal
 * status. Only when no row was open (a message enqueued without queueEmail's pre-log) does it insert one, and
 * only after the update itself succeeded: a failed update says nothing about whether a row exists, and inserting
 * on top of one would double-log.
 */
export type TerminalSendStatus = "sent" | "suppressed" | "dlq" | "failed";

export interface SendLogMessage {
  message_id?: string | null;
  label?: string | null;
  to: string;
}

/** Returns the database error message, or null when the row now carries `status`. Never throws. */
export async function finalizeSendLog(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  payload: SendLogMessage,
  queue: string,
  status: TerminalSendStatus,
  errorMessage: string | null,
): Promise<string | null> {
  const error_message = errorMessage === null ? null : errorMessage.slice(0, 1000);
  if (payload.message_id) {
    const { data, error } = await supabase
      .from("email_send_log")
      .update({ status, error_message })
      .eq("message_id", payload.message_id)
      .in("status", ["pending", "failed"])
      .select("id");
    if (error) return error.message;
    if (Array.isArray(data) && data.length > 0) return null;
  }
  const { error: insertError } = await supabase.from("email_send_log").insert({
    message_id: payload.message_id,
    template_name: payload.label || queue,
    recipient_email: payload.to,
    status,
    error_message,
  });
  return insertError ? insertError.message : null;
}
