/**
 * Every Declutter notice lands under a Declutter switch, deliberately
 * (owner 2026-10-28 via the lead: "Yes, build them" — in-app + push for
 * Declutter, with on/off switches under a "Declutter" group).
 *
 * THE CLASS. Until 20261028162048 a Declutter notice was typed with whatever
 * generic type its caller passed ('new_offers', 'payment', 'info' ...), so the
 * JOBS switch of that type gated its push: muting "Job offers" silently muted
 * new offers on a member's Declutter items. declutter_notice_type now maps
 * every Declutter notice to one of seven declutter_* kinds, by title, with a
 * fallback by the old type. The fallback keeps an unlisted notice inside the
 * Declutter group, but it guesses; this guard makes the choice explicit.
 *
 * It reads, from the EFFECTIVE definition of every function the migrations
 * leave behind (helpers/effectiveFunctionDefs), each `declutter_notify(` call
 * whose link is a Declutter screen (not a Helpr's /declutter?view=deliver
 * work, not Shops, /jobs or /admin), and requires each title literal in it to
 * be listed in declutter_notice_type, or the call to pass a declutter_* type
 * itself. A notice with a computed title must pass its declutter_* type.
 * Saved-search matches ('job_match') keep their own per-search switches.
 *
 * Filesystem only. The backend behaviour (routing, the push gate, backfill,
 * replay, the new notices, a notice never failing its event) is proven on a
 * real database in src/test/pglite/declutterNoticeKinds.pglite.mjs, where 16
 * planted defects each turn it red.
 */
// @mutate supabase/migrations/20261028171944_declutter_notice_copy.sql | 'Buyer did not check out', 'The seller cancelled', | 'The seller cancelled',
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const DEFS = effectiveDefs(MIGRATIONS);
const KINDS = ["declutter_listings", "declutter_offers", "declutter_sales", "declutter_pickups",
  "declutter_refunds", "declutter_price_drops", "declutter_wanted"];

/** Single-quoted literals in an SQL expression, '' unescaped. */
const literals = (expr: string): string[] => [...expr.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));

/** The top-level arguments of the call whose "(" is at `open`. */
function callArgs(code: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = open + 1; i < code.length; i++) {
    const c = code[i];
    if (c === "'") {
      let j = i + 1;
      while (j < code.length && !(code[j] === "'" && code[j + 1] !== "'")) j += code[j] === "'" ? 2 : 1;
      cur += code.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") {
      if (depth === 0) { args.push(cur.trim()); return args; }
      depth--;
    }
    if (c === "," && depth === 0) { args.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  throw new Error("unbalanced declutter_notify( call");
}

/** The title lists declutter_notice_type maps explicitly. */
function mappedTitles(): Set<string> {
  const def = DEFS.get("declutter_notice_type");
  if (!def) throw new Error("declutter_notice_type is not defined by any migration");
  const out = new Set<string>();
  for (const m of blankSqlComments(def.stmt).matchAll(/p_title\s+IN\s*\(([\s\S]*?)\)\s*THEN\s+'(declutter_\w+)'/g)) {
    for (const t of literals(m[1])) out.add(t);
  }
  return out;
}

interface Call { fn: string; type: string; titleExpr: string; link: string }

function declutterCalls(): Call[] {
  const calls: Call[] = [];
  for (const [fn, def] of DEFS) {
    if (fn === "declutter_notify" || fn === "declutter_notify_strict") continue;
    const code = blankSqlComments(def.stmt);
    for (const m of code.matchAll(/declutter_notify(?:_strict)?\s*\(/g)) {
      const args = callArgs(code, m.index! + m[0].length - 1);
      calls.push({ fn, type: args[1] ?? "", titleExpr: args[2] ?? "", link: args[4] ?? "" });
    }
  }
  return calls;
}

const isDeclutterScreen = (link: string): boolean => {
  const lits = literals(link).filter((l) => l.startsWith("/"));
  return lits.some((l) => l.startsWith("/declutter") && !/^\/declutter\?(view|tab)=deliver/.test(l));
};

describe("Declutter notices land under a Declutter switch, by choice", () => {
  const titles = mappedTitles();
  const calls = declutterCalls();

  it("reads the call sites and the title lists (floors, so a parser that reads nothing goes red)", () => {
    expect(calls.length).toBeGreaterThan(100);
    expect(calls.filter((c) => isDeclutterScreen(c.link)).length).toBeGreaterThan(80);
    expect(titles.size).toBeGreaterThan(80);
    expect(titles).toContain("Buyer paid");
  });

  it("every Declutter notice title is mapped to a kind explicitly", () => {
    const unmapped: string[] = [];
    for (const c of calls) {
      if (!isDeclutterScreen(c.link)) continue;
      const type = literals(c.type)[0] ?? c.type;
      if (KINDS.includes(type) || type === "job_match") continue;
      // A CASE title: the values after THEN / ELSE, not the WHEN comparands.
      const lits = (/^CASE\b/i.test(c.titleExpr)
        ? [...c.titleExpr.matchAll(/\b(?:THEN|ELSE)\s+'((?:[^']|'')*)'/gi)].map((m) => m[1].replace(/''/g, "'"))
        : literals(c.titleExpr)).filter((t) => !/%s/.test(t));
      if (lits.length === 0) {
        unmapped.push(`${c.fn}: a computed title (${c.titleExpr}) with type ${type}: pass the declutter_* type`);
        continue;
      }
      for (const t of lits) if (!titles.has(t)) unmapped.push(`${c.fn}: "${t}" (${type})`);
    }
    expect(unmapped).toEqual([]);
  });

  it("every kind the function returns is one of the seven", () => {
    const def = blankSqlComments(DEFS.get("declutter_notice_type")!.stmt);
    const returned = [...new Set([...def.matchAll(/THEN\s+'(declutter_\w+)'/g)].map((m) => m[1]))];
    expect(returned.length).toBeGreaterThan(5);
    expect(returned.filter((k) => !KINDS.includes(k))).toEqual([]);
  });
});
