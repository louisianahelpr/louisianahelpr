/**
 * A SEED UPSERT INTO A TABLE WITH A SECOND UNIQUE KEY MUST SAY HOW IT MEETS IT.
 *
 * ─── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 * `scripts/audit/prod-seed.mjs --apply` upserts every fixture row on its
 * deterministic seed id (`on_conflict=id`). That merges only into a row with
 * the SAME id. On a table that also has a natural UNIQUE key, a row another
 * writer made for the same key at its own id is not a conflict on `id`, so
 * Postgres raises the OTHER constraint and the whole --apply stops:
 *
 *     POST user_roles → 409 {"code":"23505","details":"Key (user_id, role)=
 *       (d3128db4-…, admin) already exists."}
 *
 * (prod-audit run 38156083978, 2026-10-11: both --apply attempts. The shared
 * accounts were deleted and re-created by hand on 2026-10-09 and the admin
 * role was granted at its own id; docs/OPEN.md Q1649.) favorite_helpers
 * (2026-09-19) and applications (2026-10-02) had already failed the same way,
 * each fixed one table at a time. This guard is the CLASS.
 *
 * ─── WHAT IT ASSERTS ───────────────────────────────────────────────────────
 * The natural keys are read from the migrations (every `CREATE UNIQUE INDEX`
 * with no WHERE, every `UNIQUE (…)` table constraint, inline `col … UNIQUE`),
 * never restated here. For every `upsert("<table>", …)` in prod-seed.mjs whose
 * table has one, the call must either conflict on that key (`"job_id,helper_id"`
 * as its third argument) or pass `naturalKey: "<that key>"` (select first, keep
 * a row another writer holds), or be listed in CHECKED_BY_HAND with the line
 * that does the existence check. And every raw `rest("POST", "<table>…")` that
 * is not an RPC must carry `on_conflict=`.
 *
 * Prod cross-check (2026-10-11, pg_index indisunique and not indisprimary on
 * the seeded tables): applications (job_id, helper_id), favorite_helpers
 * (customer_id, helper_id), group_job_helpers (job_id, helper_id),
 * referral_codes (code) and (user_id), referrals (referred_id), reviews
 * (job_id, reviewer_id, reviewee_id), saved_jobs (user_id, job_id),
 * thread_archives (user_id, job_id, other_user_id), user_roles (user_id, role);
 * plus partial ones (jobs, messages) this guard deliberately skips, since the
 * seed never sets their columns.
 *
 * Red on the 2026-10-11 code (the user_roles call with no natural key):
 * @mutate scripts/audit/prod-seed.mjs | s.role })), "id", { naturalKey: "user_id,role" }); | s.role })));
 * @mutate scripts/audit/prod-seed.mjs | job_id: sid("job:pets") }], "id", { naturalKey: "user_id,job_id" }); | job_id: sid("job:pets") }]);
 * @mutate scripts/audit/prod-seed.mjs |   if (naturalKey) rows = await dropRowsHeldByAnotherWriter(table, rows, naturalKey); |   // naturalKey ignored
 * @mutate scripts/audit/prod-seed.mjs |   if (!/^https:\/\//.test(url)) return null; |   // any url
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "../..");
const SEED = join(REPO, "scripts/audit/prod-seed.mjs");
const MIGRATIONS = join(REPO, "supabase/migrations");

/**
 * Upserts whose natural key is met by an explicit check on the line(s) before
 * them, not by the upsert itself. Each entry names the check; the test asserts
 * the check is still in the file, so a waiver cannot outlive its reason.
 */
const CHECKED_BY_HAND: Record<string, string> = {
  // (job_id, reviewer_id, reviewee_id): the `want` list drops a reviewer that
  // already has a review on the job at another id.
  reviews: "!existing.some((e) => e.reviewer_id === r.reviewer_id && e.id !== r.id)",
  // (user_id): the poster's own code is selected first and reused. (code): the
  // literal is seed-only and its owner (the poster) is the row just checked.
  referral_codes: "let code = (await select(`referral_codes?user_id=eq.${posterId}&select=id`))[0];",
};

const norm = (cols: string) => cols.split(",").map((c) => c.trim().replace(/"/g, "")).filter(Boolean).sort().join(",");

/** table -> set of natural keys (sorted, comma-joined), from every migration. */
function naturalKeys(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (table: string, cols: string) => {
    const t = table.replace(/^public\./, "").replace(/"/g, "");
    const k = norm(cols);
    if (!k || k === "id") return;
    if (!out.has(t)) out.set(t, new Set());
    out.get(t)!.add(k);
  };
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"));
    for (const m of sql.matchAll(/CREATE\s+UNIQUE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?\S+\s+ON\s+(?:ONLY\s+)?([\w."]+)(?:\s+USING\s+\w+)?\s*\(([^()]*)\)([^;]*);/gi)) {
      if (/\bWHERE\b/i.test(m[3])) continue;
      add(m[1], m[2]);
    }
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([\w."]+)\s+ADD\s+CONSTRAINT\s+\S+\s+UNIQUE\s*(?:NULLS\s+NOT\s+DISTINCT\s*)?\(([^()]*)\)/gi)) add(m[1], m[2]);
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)\s*\(/gi)) {
      // The table body: balanced parentheses from the opening one.
      let depth = 1;
      let j = (m.index ?? 0) + m[0].length;
      const start = j;
      while (j < sql.length && depth > 0) {
        if (sql[j] === "(") depth++;
        else if (sql[j] === ")") depth--;
        j++;
      }
      const body = sql.slice(start, j - 1);
      for (const u of body.matchAll(/\bUNIQUE\s*(?:NULLS\s+NOT\s+DISTINCT\s*)?\(([^()]*)\)/gi)) add(m[1], u[1]);
      for (const line of body.split(/,\s*\n/)) {
        const col = line.trim().match(/^"?(\w+)"?\s+[\w\s()[\]]*?\bUNIQUE\b(?!\s*\()/i);
        if (col && !/^(CONSTRAINT|UNIQUE|PRIMARY|CHECK|FOREIGN)$/i.test(col[1])) add(m[1], col[1]);
      }
    }
  }
  return out;
}

type Call = { table: string; onConflict: string | null; naturalKey: string | null; line: number };

/** Every `upsert("<table>", …)` call in the seed, with its conflict choice. */
function upsertCalls(src: string): Call[] {
  const code = blankComments(src);
  const calls: Call[] = [];
  for (const m of code.matchAll(/\bupsert\(\s*\n?\s*"(\w+)"/g)) {
    const at = m.index ?? 0;
    // The call's own argument list: balanced parentheses.
    let depth = 0;
    let j = code.indexOf("(", at);
    const open = j;
    for (; j < code.length; j++) {
      if (code[j] === "(") depth++;
      else if (code[j] === ")" && --depth === 0) break;
    }
    const args = code.slice(open + 1, j);
    // Top-level arguments only: split on commas at depth 0.
    const parts: string[] = [];
    let d = 0;
    let cur = "";
    let q: string | null = null;
    for (const ch of args) {
      if (q) { cur += ch; if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { q = ch; cur += ch; continue; }
      if ("([{".includes(ch)) d++;
      if (")]}".includes(ch)) d--;
      if (ch === "," && d === 0) { parts.push(cur); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    const conflict = parts[2]?.trim().match(/^"([\w,]+)"$/)?.[1] ?? null;
    const nk = (parts[3] ?? "").match(/naturalKey:\s*"([\w,]+)"/)?.[1] ?? null;
    calls.push({ table: m[1], onConflict: conflict, naturalKey: nk, line: code.slice(0, at).split("\n").length });
  }
  return calls;
}

describe("prod-seed upserts meet every natural unique key (Q1649)", () => {
  const src = readFileSync(SEED, "utf8");
  const keys = naturalKeys();
  const calls = upsertCalls(src);

  it("reads the migrations' natural keys and the seed's upserts (inventory floor)", () => {
    // The two keys that broke --apply on prod; the parser must find both.
    expect(keys.get("user_roles")?.has("role,user_id"), "user_roles (user_id, role) not parsed").toBe(true);
    expect(keys.get("favorite_helpers")?.has("customer_id,helper_id"), "favorite_helpers (customer_id, helper_id) not parsed").toBe(true);
    expect(keys.size).toBeGreaterThan(20);
    expect(calls.length).toBeGreaterThan(20);
  });

  it("every upsert into a table with a natural key conflicts on it, checks it first, or names its hand check", () => {
    const bad: string[] = [];
    for (const c of calls) {
      const nat = keys.get(c.table);
      if (!nat?.size) continue;
      const met = [c.onConflict, c.naturalKey].filter((x): x is string => !!x).map(norm).some((k) => nat.has(k));
      if (met) continue;
      const hand = CHECKED_BY_HAND[c.table];
      if (hand && src.includes(hand)) continue;
      bad.push(`prod-seed.mjs:${c.line} upsert("${c.table}") conflicts on ${c.onConflict ?? "id"} but the table is also UNIQUE on (${[...nat].join(") / (")}); pass naturalKey or on_conflict on it`);
    }
    expect(bad).toEqual([]);
  });

  it("every hand-check waiver still has its check in the seed", () => {
    for (const [table, needle] of Object.entries(CHECKED_BY_HAND)) {
      expect(src.includes(needle), `${table}: the existence check this waiver relies on is gone`).toBe(true);
    }
  });

  it("naturalKey is honoured by upsert() itself", () => {
    const code = blankComments(src);
    expect(code).toMatch(/if \(naturalKey\) rows = await dropRowsHeldByAnotherWriter\(table, rows, naturalKey\);/);
  });

  it("a data: avatar never counts as the helper's resolving avatar (Q1649)", () => {
    // fetch() answers a data: URI with 200 itself, so without this line the
    // 1x1 PNG on helper-e2e "resolved" and --apply never uploaded a real one.
    const code = blankComments(src);
    const fn = code.slice(code.indexOf("async function resolvingAvatarUrl"), code.indexOf("async function listHelperAvatarObjects"));
    expect(fn.length).toBeGreaterThan(100);
    expect(fn).toMatch(/if \(!\/\^https:\\\/\\\/\/\.test\(url\)\) return null;/);
  });

  it("every raw PostgREST table POST in the seed carries on_conflict", () => {
    const code = blankComments(src);
    const bad = [...code.matchAll(/rest\(\s*"POST"\s*,\s*[`"]([^`"]+)[`"]/g)]
      .map((m) => m[1])
      .filter((p) => !p.startsWith("rpc/") && !p.includes("on_conflict="));
    expect(bad).toEqual([]);
  });
});
