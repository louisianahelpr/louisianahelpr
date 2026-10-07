/**
 * Q1404 (lh-money-escrow review of Q1398): the offer-deadline clamp must fire
 * AFTER every BEFORE UPDATE trigger on public.jobs that judges a
 * response_deadline change (trg_helper_jobs_column_whitelist refuses a Helpr
 * write that moves it; trg_hire_columns_rpc_only refuses a client one). When a
 * Helpr accepts a date change, the clamp moves the deadline; firing first, it
 * would get the RPC's write refused. BEFORE triggers fire in NAME order, so
 * the trigger names are the guarantee: checked here on the newest CREATE
 * TRIGGER of each in the migrations.
 *
 * Behaviour (real Postgres, LIVE chain fixture):
 * src/test/pglite/offerDeadlineTriggerOrder.pglite.mjs (5 PASS; 4 FAIL with
 * TRIGGER_FIRST=1, which names the clamp aaaa_).
 *
 * @mutate supabase/migrations/20261005184940_offer_deadline_before_start.sql | CREATE TRIGGER zzzz_offer_deadline_follows_start | CREATE TRIGGER aaaa_offer_deadline_follows_start
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = "supabase/migrations";

/** Every trigger on public.jobs as the migrations leave it: name -> function. */
function jobsTriggers(): Map<string, string> {
  const live = new Map<string, string>();
  for (const f of migrationFiles(DIR)) {
    const sql = blankSqlComments(readFileSync(`${DIR}/${f}`, "utf8"));
    const events: { at: number; apply: () => void }[] = [];
    for (const m of sql.matchAll(/DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+(?:public\.)?"?jobs"?\b/gi)) {
      events.push({ at: m.index!, apply: () => live.delete(m[1]) });
    }
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+"?(\w+)"?\s+([\s\S]*?)\s+ON\s+(?:public\.)?"?jobs"?\b[\s\S]*?EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?(\w+)/gi)) {
      events.push({ at: m.index!, apply: () => live.set(m[1], m[3]) });
    }
    events.sort((a, b) => a.at - b.at).forEach((e) => e.apply());
  }
  return live;
}

describe("Q1404: the offer-deadline clamp fires after the triggers that judge response_deadline", () => {
  const triggers = jobsTriggers();
  const clamp = [...triggers].find(([, fn]) => fn === "offer_deadline_follows_start")?.[0];

  it("inventory: the jobs triggers are read from the migrations (floor)", () => {
    expect(triggers.size).toBeGreaterThan(20);
    expect(clamp).toBeTruthy();
  });

  it("its name sorts after trg_helper_jobs_column_whitelist and trg_hire_columns_rpc_only", () => {
    for (const judge of ["trg_helper_jobs_column_whitelist", "trg_hire_columns_rpc_only"]) {
      expect(triggers.has(judge), judge).toBe(true);
      expect([judge, clamp!].sort()[1], `${clamp} must fire after ${judge}`).toBe(clamp);
    }
  });
});
