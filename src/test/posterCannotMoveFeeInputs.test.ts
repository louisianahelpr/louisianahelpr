import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";

/**
 * THE CLASS (docs/OPEN.md Q423): a poster edits an input their own late-cancel
 * fee is priced from, then cancels, and the Helpr loses the fee.
 *
 * Before 20260925231810 a poster could PATCH helper_confirmed_at = NULL (fee
 * and strike gone: an uncommitted cancel is $0), or move date_needed /
 * start_time past the 24h line (fee gone), on their own funded, booked job.
 * The poster's UPDATE policy on jobs is whole-row, so the only thing between a
 * poster and a price input is a BEFORE UPDATE trigger that names the column.
 *
 * The inventory is DERIVED, not hand-listed:
 *   - poster_cancel_job's effective text: every `j.<column>` it SELECTs INTO
 *     v_job from public.jobs (the row it prices the fee and the strike from);
 *   - void-cancelled-payments' re-pricing inputs: every field of
 *     CancellationFeeJob (_shared/cancellationFee.ts) and CrewCancellationFeeJob
 *     (_shared/crewShares.ts), the shapes computeCancellationFee and
 *     crewCancellationFee take from the job row.
 * Each derived column must be locked against the poster by the newest
 * enforce_poster_jobs_money_lock (locked_always / locked_when_funded /
 * locked_when_booked, or its explicit customer_id refusal) or by a named
 * sibling lock whose effective body refuses a change of that column; every
 * lock function named must run from a standing BEFORE trigger on jobs. The
 * only exemptions are NOT_A_PRICE_INPUT, each with its reason; both maps are
 * two-way (an entry that no longer matches a derived column fails).
 *
 * Behaviour (red before, 3x replay, legit writers still land):
 * src/test/pglite/posterFeeInputsLocked.pglite.mjs.
 */

// @mutate supabase/migrations/20260925231810_poster_cannot_move_fee_inputs.sql |     'helper_confirmed_at',\n    'helper_dayof_confirmed_at'\n  ]; |     'helper_dayof_confirmed_at'\n  ];
// @mutate supabase/migrations/20260925231810_poster_cannot_move_fee_inputs.sql |     'date_needed',\n    'start_time'\n  ]; |     'date_needed'\n  ];
// @mutate supabase/functions/_shared/cancellationFee.ts |   cancelled_at: string \| null;\n  helper_id: string \| null; |   cancelled_at: string \| null;\n  helper_id: string \| null;\n  is_urgent_x: string \| null;

const REPO = resolve(__dirname, "..", "..");
const MIGRATIONS = resolve(REPO, "supabase", "migrations");
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

const DEFS = effectiveDefs(MIGRATIONS);
const body = (fn: string): string => {
  const d = DEFS.get(fn);
  if (!d) throw new Error(`${fn}: no definition in the migrations`);
  return blankSqlComments(d.stmt);
};

/** Columns the fee and the strike are priced from, derived from the code that prices them. */
function priceInputs(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (col: string, src: string) => out.set(col, [...(out.get(col) ?? []), src]);

  const cancel = body("poster_cancel_job");
  const sel = /SELECT\s+([\s\S]*?)\s+INTO\s+v_job\s+FROM\s+public\.jobs\s+j\b/i.exec(cancel);
  if (!sel) throw new Error("poster_cancel_job: no `SELECT j.… INTO v_job FROM public.jobs j` found");
  for (const m of sel[1].matchAll(/\bj\.(\w+)/g)) add(m[1], "poster_cancel_job");

  for (const [file, iface] of [
    ["supabase/functions/_shared/cancellationFee.ts", "CancellationFeeJob"],
    ["supabase/functions/_shared/crewShares.ts", "CrewCancellationFeeJob"],
  ] as const) {
    const src = blankComments(read(file));
    const m = new RegExp(`interface\\s+${iface}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src);
    if (!m) throw new Error(`${file}: interface ${iface} not found`);
    for (const f of m[1].matchAll(/^\s*(\w+)\??\s*:/gm)) add(f[1], iface);
  }
  return out;
}

/** The newest poster lock's arrays, read from its effective text. */
function posterLock(): { arrays: Record<string, string[]>; refusesCustomerId: boolean } {
  const b = body("enforce_poster_jobs_money_lock");
  const arrays: Record<string, string[]> = {};
  for (const m of b.matchAll(/(\w+)\s+CONSTANT\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/gi)) {
    arrays[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]);
  }
  return {
    arrays,
    refusesCustomerId: /IF\s+NEW\.customer_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.customer_id\s+THEN\s+RAISE/i.test(b),
  };
}

/**
 * Price inputs a SIBLING trigger locks for every client (the poster included).
 * The check: that function's effective body refuses a change of the column
 * (`<array> … '<col>'` for an array lock, or `NEW.<col> IS DISTINCT FROM OLD.<col>`
 * followed by a RAISE).
 */
const LOCKED_ELSEWHERE: Record<string, { fn: string; why: string }> = {
  cancelled_at: { fn: "enforce_cancellation_requires_rpc", why: "set only inside poster_cancel_job / the Helpr cancel RPCs (app.sanctioned_cancel)" },
  helper_completed_at: { fn: "enforce_job_completion_server_owned", why: "server-owned in full; the Helpr's Done is rpc_helper_mark_done" },
  is_group_job: { fn: "enforce_group_job_has_no_lead", why: "the crew shape lock (money review HIGH-1, 20260925154606)" },
  helpers_needed: { fn: "enforce_group_job_has_no_lead", why: "the crew shape lock (money review HIGH-1, 20260925154606)" },
};

/** Read by the pricing code, but not a term of the price. */
const NOT_A_PRICE_INPUT: Record<string, string> = {
  id: "the row key",
  title: "notification copy only",
  status:
    "a cancellability gate, not a term of the fee (the fee is committed x hours x budget); every status a poster could reach that the cancel refuses (completed, disputed, cancelled) has its own server-owned lock",
};

function locksElsewhere(fn: string, col: string): boolean {
  const b = body(fn);
  const arrayLock = new RegExp(`(\\w+)\\s+CONSTANT\\s+text\\[\\]\\s*:=\\s*ARRAY\\[[^\\]]*'${col}'`, "i").test(b);
  const directLock = new RegExp(`NEW\\.${col}\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\.${col}[\\s\\S]{0,1200}?RAISE\\s+EXCEPTION`, "i").test(b);
  return arrayLock || directLock;
}

/** Functions a standing BEFORE UPDATE trigger on public.jobs runs (migrations scanned in order). */
function beforeUpdateJobsTriggerFns(): Set<string> {
  const trig = new Map<string, string>();
  for (const f of migrationFiles(MIGRATIONS)) {
    const sql = blankSqlComments(readFileSync(resolve(MIGRATIONS, f), "utf8"));
    const re = /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+"?(\w+)"?\s+([\s\S]*?);|DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+(?:public\.)?"?(\w+)"?/gi;
    for (const m of sql.matchAll(re)) {
      if (m[1]) {
        const on = /\bON\s+(?:public\.)?"?(\w+)"?/i.exec(m[2])?.[1];
        if (on !== "jobs" || !/^\s*BEFORE\b[^;]*\bUPDATE\b/i.test(m[2])) {
          if (on === "jobs") trig.delete(m[1]);
          continue;
        }
        const fn = /EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?(\w+)/i.exec(m[2])?.[1];
        if (fn) trig.set(m[1], fn);
      } else if (m[4] === "jobs") trig.delete(m[3]);
    }
  }
  return new Set(trig.values());
}

describe("a poster cannot move an input of their own late-cancel fee (Q423)", () => {
  const inputs = priceInputs();
  const lock = posterLock();
  const posterLocked = new Set([
    ...(lock.arrays.locked_always ?? []),
    ...(lock.arrays.locked_when_funded ?? []),
    ...(lock.arrays.locked_when_booked ?? []),
    ...(lock.refusesCustomerId ? ["customer_id"] : []),
  ]);

  it("derives a real inventory from the pricing code", () => {
    expect(inputs.size).toBeGreaterThan(10);
    for (const col of ["budget", "date_needed", "start_time", "helper_id", "helper_confirmed_at"]) {
      expect(inputs.has(col), `${col} should be a derived price input`).toBe(true);
    }
    expect(posterLocked.size).toBeGreaterThan(20);
  });

  it("every price input is locked against the poster (or exempt, with a reason)", () => {
    const open: string[] = [];
    for (const [col, from] of inputs) {
      if (col in NOT_A_PRICE_INPUT) continue;
      if (posterLocked.has(col)) continue;
      const other = LOCKED_ELSEWHERE[col];
      if (other && locksElsewhere(other.fn, col)) continue;
      open.push(`${col} (read by ${from.join(", ")})`);
    }
    expect(open, `poster-writable price inputs: ${open.join("; ")}`).toEqual([]);
  });

  it("both confirmation stamps are locked for the poster in every state, not only once funded", () => {
    expect(lock.arrays.locked_always).toEqual(expect.arrayContaining(["helper_confirmed_at", "helper_dayof_confirmed_at"]));
  });

  it("every lock named here runs from a standing BEFORE UPDATE trigger on jobs", () => {
    const fns = beforeUpdateJobsTriggerFns();
    for (const fn of ["enforce_poster_jobs_money_lock", ...new Set(Object.values(LOCKED_ELSEWHERE).map((x) => x.fn))]) {
      expect(fns.has(fn), `${fn} is not run by any standing BEFORE UPDATE trigger on public.jobs`).toBe(true);
    }
  });

  it("the exemption maps are exact (two-way): each entry names a derived price input", () => {
    const stale = [...Object.keys(NOT_A_PRICE_INPUT), ...Object.keys(LOCKED_ELSEWHERE)].filter((c) => !inputs.has(c));
    expect(stale).toEqual([]);
    const redundant = Object.keys(LOCKED_ELSEWHERE).filter((c) => posterLocked.has(c));
    expect(redundant, "now in the poster lock itself: drop it from LOCKED_ELSEWHERE").toEqual([]);
  });
});
