// @mutate supabase/migrations/20261006015121_crew_rest_carry_on.sql |   PERFORM set_config('app.helper_cancel_rpc', '1', true);\n | \n
// @mutate supabase/migrations/20261004192041_helper_only_clears_response_deadline.sql |          AND current_setting('app.helper_cancel_rpc', true) = '1'\n |          AND current_setting('app.helper_cancel_rpcx', true) = '1'\n
// @mutate supabase/migrations/20261004192041_helper_only_clears_response_deadline.sql |          AND to_jsonb(NEW) -> changed_col = 'null'::jsonb THEN | THEN
// @mutate supabase/migrations/20261006015121_crew_rest_carry_on.sql |   PERFORM set_config('app.helper_cancel_rpc', '0', true);\n | \n
/*
 * Q402: helper_cancel_booking runs as the Helpr (SECURITY DEFINER keeps
 * auth.uid(), so is_server_context() is false), so every jobs column it
 * writes passes through enforce_helper_jobs_column_whitelist. It cleared the
 * three reminder sent-ats, which the whitelist did not allow, so a Helpr could
 * not cancel once a day-of reminder had gone out ("Helpers may not modify
 * jobs.dayof_confirm_reminder_sent_at").
 *
 * The class: every column any `UPDATE public.jobs SET ...` in the NEWEST
 * helper_cancel_booking writes is either on the whitelist's `allowed` list or
 * covered by a whitelist bypass whose transaction-local flag the function
 * sets to '1' before that UPDATE and back to '0' after it.
 * Executable proof: node src/test/pglite/groupRosterDeparture.pglite.mjs --tree (L1).
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const cancel = blankSqlComments(defs.get("helper_cancel_booking")?.stmt ?? "");
const whitelist = blankSqlComments(defs.get("enforce_helper_jobs_column_whitelist")?.stmt ?? "");

const allowed = [...(/allowed\s+CONSTANT\s+text\[\]\s*:=\s*ARRAY\[([^\]]*)\]/i.exec(whitelist)?.[1] ?? "").matchAll(/'(\w+)'/g)].map(
  (m) => m[1],
);

/** flag -> the columns its bypass block lets through. */
const bypass = new Map<string, Set<string>>();
for (const m of whitelist.matchAll(
  /IF\s+changed_col\s+(?:=\s*'(\w+)'|IN\s*\(([^)]*)\))\s+AND\s+current_setting\(\s*'(app\.\w+)'\s*,\s*true\s*\)\s*=\s*'1'/gi,
)) {
  const cols = m[1] ? [m[1]] : [...m[2].matchAll(/'(\w+)'/g)].map((c) => c[1]);
  const set = bypass.get(m[3]) ?? new Set<string>();
  cols.forEach((c) => set.add(c));
  bypass.set(m[3], set);
}

/** Top-level comma split of a SET list. */
function setColumns(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((a) => /^\s*(\w+)\s*=/.exec(a)?.[1] ?? "").filter(Boolean);
}

const updates = [...cancel.matchAll(/UPDATE\s+public\.jobs\s+SET\s+([\s\S]*?)\s+WHERE\b/gi)].map((m) => ({
  at: m.index!,
  end: m.index! + m[0].length,
  cols: setColumns(m[1]),
}));

const setsFlag = (flag: string, value: string) =>
  [...cancel.matchAll(new RegExp(`set_config\\(\\s*'${flag.replace(".", "\\.")}'\\s*,\\s*'${value}'\\s*,\\s*true\\s*\\)`, "gi"))].map(
    (m) => m.index!,
  );

describe("Q402: every jobs column helper_cancel_booking writes gets past the Helpr column whitelist", () => {
  it("the inventory is real", () => {
    expect(defs.get("helper_cancel_booking")).toBeTruthy();
    expect(defs.get("enforce_helper_jobs_column_whitelist")).toBeTruthy();
    expect(allowed.length).toBeGreaterThan(10);
    expect(bypass.size).toBeGreaterThan(2);
    expect(updates.length).toBeGreaterThan(1);
    expect(updates.flatMap((u) => u.cols)).toContain("dayof_confirm_reminder_sent_at");
  });

  it("each written column is allowed, or its bypass flag is set before the UPDATE and reset after it", () => {
    const refused: string[] = [];
    for (const u of updates) {
      for (const col of u.cols) {
        if (allowed.includes(col)) continue;
        const ok = [...bypass].some(
          ([flag, cols]) =>
            cols.has(col) &&
            setsFlag(flag, "1").some((i) => i < u.at) &&
            setsFlag(flag, "0").some((i) => i > u.end),
        );
        if (!ok) refused.push(col);
      }
    }
    expect(refused, "helper_cancel_booking writes these as the Helpr and the whitelist refuses them").toEqual([]);
  });

  it("the cancel flag only lets the reminder sent-ats be cleared, never stamped", () => {
    const block = /IF\s+changed_col\s+IN\s*\([^)]*\)\s+AND\s+current_setting\(\s*'app\.helper_cancel_rpc'[\s\S]*?\bTHEN\b/i.exec(whitelist)?.[0] ?? "";
    expect(block, "no app.helper_cancel_rpc bypass in the newest whitelist").not.toBe("");
    expect(block).toMatch(/to_jsonb\(\s*NEW\s*\)\s*->\s*changed_col\s*=\s*'null'::jsonb/i);
  });
});
