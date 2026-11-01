/**
 * One email, one email_send_log row (Declutter audits 2026-10-28: LO2-2 / A2-16, "email_send_log rows stuck
 * 'pending' for declutter_receipt").
 *
 * queueEmail (_shared/resend.ts) pre-logs a 'pending' row. process-email-queue's 'suppressed' and 'dlq' outcomes
 * INSERTED a second row, so the 'pending' one never resolved: measured on prod 2026-10-28 (read-only), 114
 * message ids carried a stuck 'pending' beside a terminal row (75 'dlq', 39 'suppressed'), across every template.
 *
 * THE CLASS: the queue worker writes email_send_log ONLY through finalizeSendLog (_shared/emailSendLog.ts), which
 * moves the message's open row ('pending' / 'failed') to its outcome and inserts only when none was open and the
 * update itself succeeded. Read from the worker's source (comments blanked); the helper's behaviour is checked on
 * an in-memory table below.
 */
// @mutate supabase/functions/process-email-queue/index.ts |         const supLogError = await finalizeSendLog(supabase, payload, queue, 'suppressed', |         const { error: supLogErr } = await supabase.from('email_send_log').insert({ message_id: payload.message_id, status: 'suppressed' }); const supLogError = supLogErr && await finalizeSendLog(supabase, payload, queue, 'suppressed',
// @mutate supabase/functions/_shared/emailSendLog.ts |     if (Array.isArray(data) && data.length > 0) return null; |     if (false) return null;
// @mutate supabase/functions/_shared/emailSendLog.ts |       .in("status", ["pending", "failed"]) |       .in("status", ["failed"])
// @mutate supabase/functions/_shared/emailSendLog.ts |     if (error) return error.message; |     if (false) return error.message;
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { finalizeSendLog, type TerminalSendStatus } from "../../supabase/functions/_shared/emailSendLog";

const WORKER = blankComments(readFileSync(resolve(__dirname, "../../supabase/functions/process-email-queue/index.ts"), "utf8"));

interface Row { id: number; message_id: string | null; template_name: string; recipient_email: string; status: string; error_message: string | null }

/** An in-memory email_send_log with just the calls finalizeSendLog makes. `failUpdate` makes the UPDATE fail. */
function table(rows: Row[], { failUpdate = false } = {}) {
  let next = rows.length + 1;
  const client = {
    from(name: string) {
      if (name !== "email_send_log") throw new Error(`unexpected table ${name}`);
      return {
        update(patch: Partial<Row>) {
          let id: string | null = null;
          let statuses: string[] = [];
          const q = {
            eq(_col: string, v: string) { id = v; return q; },
            in(_col: string, v: string[]) { statuses = v; return q; },
            async select() {
              if (failUpdate) return { data: null, error: { message: "update failed" } };
              const hit = rows.filter((r) => r.message_id === id && statuses.includes(r.status));
              for (const r of hit) Object.assign(r, patch);
              return { data: hit.map((r) => ({ id: r.id })), error: null };
            },
          };
          return q;
        },
        async insert(row: Omit<Row, "id">) {
          rows.push({ id: next++, ...row });
          return { error: null };
        },
      };
    },
  };
  return client;
}
const pending = (message_id: string, status = "pending"): Row =>
  ({ id: 1, message_id, template_name: "declutter_receipt", recipient_email: "a@example.org", status, error_message: null });
const payload = { message_id: "m1", label: "declutter_receipt", to: "a@example.org" };

describe("one email, one email_send_log row", () => {
  it.each(["suppressed", "dlq", "sent", "failed"] as TerminalSendStatus[])("a pre-logged 'pending' row becomes '%s' (no second row)", async (status) => {
    const rows = [pending("m1")];
    expect(await finalizeSendLog(table(rows), payload, "transactional_emails", status, "why")).toBeNull();
    expect(rows.map((r) => r.status)).toEqual([status]);
  });

  it("a 'failed' row from an earlier try becomes 'dlq'", async () => {
    const rows = [pending("m1", "failed")];
    await finalizeSendLog(table(rows), payload, "transactional_emails", "dlq", "Max retries (5) exceeded");
    expect(rows.map((r) => [r.status, r.error_message])).toEqual([["dlq", "Max retries (5) exceeded"]]);
  });

  it("no open row (a sender without the pre-log): one row is inserted", async () => {
    const rows: Row[] = [];
    await finalizeSendLog(table(rows), payload, "transactional_emails", "sent", null);
    expect(rows.map((r) => [r.message_id, r.template_name, r.status])).toEqual([["m1", "declutter_receipt", "sent"]]);
  });

  it("a failed update never inserts on top of a row it could not see, and says why", async () => {
    const rows = [pending("m1")];
    expect(await finalizeSendLog(table(rows, { failUpdate: true }), payload, "transactional_emails", "suppressed", "test")).toBe("update failed");
    expect(rows.map((r) => r.status)).toEqual(["pending"]);
  });

  it("the queue worker writes the log only through finalizeSendLog, for every outcome", () => {
    const direct = WORKER.match(/\.from\(\s*['"]email_send_log['"]\s*\)\s*\.(?:insert|update|upsert)\(/g) ?? [];
    expect(direct).toEqual([]);
    const outcomes = [...WORKER.matchAll(/finalizeSendLog\(supabase, payload, queue, '(\w+)'/g)].map((m) => m[1]).sort();
    // Floor: the worker's real calls were read (an unreadable or moved worker finds none, and "no direct write" passes).
    expect(outcomes.length).toBeGreaterThan(5);
    expect(outcomes).toEqual(["dlq", "dlq", "failed", "sent", "suppressed", "suppressed"]);
  });
});
