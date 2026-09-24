/**
 * Mail to a reserved domain is suppressed once, never retried into the DLQ.
 *
 * Resend rejects example.com (and every RFC 2606/6761 reserved name) with a
 * permanent 422. process-email-queue retried two "New application" emails to
 * test accounts five times each and dead-lettered them (msgs 51/52,
 * 2026-09-23), which filed the email-dlq-transactional alert (ledger 2b794ca3).
 */
// @mutate supabase/functions/_shared/reservedRecipient.ts | example\.(?:com|net|org) | example\.(?:net|org)
// @mutate supabase/functions/process-email-queue/index.ts |       if (isReservedRecipient(payload.to)) { |       if (false) {
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isReservedRecipient } from "../../supabase/functions/_shared/reservedRecipient";

const QUEUE = join(__dirname, "..", "..", "supabase", "functions", "process-email-queue", "index.ts");

describe("reserved recipients never retry into the DLQ", () => {
  it("knows the reserved domains and leaves real ones alone", () => {
    for (const to of ["poster@example.com", "a@mail.example.org", "x@foo.test", "y@bar.invalid", "z@localhost", ["a@example.net", "b@x.test"]])
      expect(isReservedRecipient(to), JSON.stringify(to)).toBe(true);
    for (const to of ["owner@gmail.com", "ops@louisianahelpr.com", "a@examples.com", "a@testing.io", ["a@example.com", "real@gmail.com"], [], null])
      expect(isReservedRecipient(to), JSON.stringify(to)).toBe(false);
  });

  it("the queue suppresses and dequeues a reserved recipient before calling Resend", () => {
    const src = readFileSync(QUEUE, "utf8");
    const check = src.indexOf("if (isReservedRecipient(payload.to)) {");
    const send = src.indexOf("sendWithResend(", check);
    expect(check).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(check);
    const block = src.slice(check, src.indexOf("continue", check));
    expect(block).toContain("status: 'suppressed'");
    expect(block).toContain("rpc('delete_email'");
  });
});
