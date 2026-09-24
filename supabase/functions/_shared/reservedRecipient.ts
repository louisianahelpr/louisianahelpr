/**
 * RFC 2606 / RFC 6761 reserved domains: no mail to them is ever delivered, and
 * Resend rejects every one with a permanent 422 ("use our testing email address
 * instead of domains like example.com"). Test and seed accounts use them, so
 * process-email-queue suppresses the send instead of retrying it five times
 * into the DLQ (ledger 2b794ca3, msgs 51/52, 2026-09-23).
 * Guard: src/test/reservedRecipientsNeverRetry.test.ts.
 */
const RESERVED = /@(?:[\w-]+\.)*(?:example\.(?:com|net|org)|[\w-]+\.(?:test|example|invalid|localhost)|(?:test|example|invalid|localhost))$/i;

export function isReservedRecipient(to: unknown): boolean {
  const list = Array.isArray(to) ? to : [to];
  return list.length > 0 && list.every((t) => typeof t === 'string' && RESERVED.test(t.trim()));
}
