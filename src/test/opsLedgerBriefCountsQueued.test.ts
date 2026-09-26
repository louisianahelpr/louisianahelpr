/**
 * Q1(e) / Q43 (docs/OPEN.md): the session-start ledger brief must
 *   - count occurrences still queued in public.ops_alert_pending (they are not
 *     in the ledger until ops_alert_fold_pending() runs, so a brief that reads
 *     only the ledger undercounts during a storm), and
 *   - say WHY it cannot read the ledger when no transport exists (a cloud
 *     session printed "spawnSync supabase ENOENT" on 2026-09-26, which names
 *     neither the missing token nor what to do).
 *
 * @mutate scripts/ops-alert-ledger.mjs | pending = (await sql(PENDING_SQL, | pending = (await Promise.resolve([]), [
 * @mutate scripts/lib/opsAlertLedger.mjs | FROM public.ops_alert_pending`; | FROM public.ops_alert_ledger`;
 * @mutate scripts/lib/opsAlertLedger.mjs | if (/ENOENT/.test(msg) && | if (false &&
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error untyped .mjs (same as opsLedgerNightlyItemsCanClose.test.ts)
import { PENDING_SQL, unreadableReason } from "../../scripts/lib/opsAlertLedger.mjs";

const CLI = blankComments(readFileSync(resolve(__dirname, "../../scripts/ops-alert-ledger.mjs"), "utf8"));

describe("ops alert ledger brief", () => {
  it("reads the pending queue, not the ledger, for queued occurrences", () => {
    expect(PENDING_SQL).toMatch(/FROM\s+public\.ops_alert_pending\b/);
    expect(PENDING_SQL).toMatch(/min\(queued_at\)/);
  });

  it("list() queries PENDING_SQL and prints the queued count", () => {
    const list = CLI.slice(CLI.indexOf("async function list()"), CLI.indexOf("async function record()"));
    expect(list.length).toBeGreaterThan(200);
    expect(list).toMatch(/await sql\(PENDING_SQL,/);
    expect(list).toMatch(/QUEUED, not yet folded in/);
  });

  it("names the missing transport instead of a bare ENOENT", () => {
    const err = new Error("spawnSync supabase ENOENT");
    expect(unreadableReason(err, {})).toMatch(/no SUPABASE_ACCESS_TOKEN\+SUPABASE_PROJECT_REF and no supabase CLI/);
    expect(unreadableReason(err, {})).toMatch(/count is NOT known/);
  });

  it("passes any other error through unchanged", () => {
    expect(unreadableReason(new Error("Management API 500: boom\nstack"), {})).toBe("Management API 500: boom");
    expect(
      unreadableReason(new Error("spawnSync supabase ENOENT"), { SUPABASE_ACCESS_TOKEN: "t", SUPABASE_PROJECT_REF: "r" }),
    ).toBe("spawnSync supabase ENOENT");
  });
});
