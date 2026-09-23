/**
 * The client write surface of `public.jobs`, read out of SQL.
 *
 * Shared by src/test/jobsStateColumnGuard.test.ts (static: the newest
 * definition of every function in supabase/migrations) and
 * scripts/check-jobs-dynamic-writers.mjs (live: pg_proc on prod). The two must
 * judge a function by the same rules, so the rules live here once.
 *
 * Plain regex over plpgsql, not a parser. Every consumer asserts its parse saw
 * what it expected before trusting a verdict, and every rule has a
 * deliberately broken input in the test that proves it can fail.
 */

/** Pull a `name CONSTANT text[] := ARRAY[ 'a', 'b' ]` list out of plpgsql. */
export function sqlArrayLiteral(src, varName) {
  const m = src.match(new RegExp(`\\b${varName}\\s+CONSTANT\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([^\\]]*)\\]`, "i"));
  if (!m) return null;
  return [...m[1].replace(/--[^\n]*/g, "").matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** Split `a uuid, b jsonb DEFAULT NULL::jsonb` into [{name, type}]. */
export function parseArgs(argList) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of argList ?? "") {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out
    .map((a) => a.replace(/\bDEFAULT\b[\s\S]*$/i, "").replace(/=\s*[\s\S]*$/, "").trim())
    .map((a) => a.replace(/^(IN|OUT|INOUT|VARIADIC)\s+/i, ""))
    .map((a) => {
      const m = a.match(/^("?[A-Za-z_][\w]*"?)\s+([\s\S]+)$/);
      return m ? { name: m[1].replace(/"/g, ""), type: m[2].trim().toLowerCase() } : { name: "", type: a.toLowerCase() };
    });
}

/**
 * Every `CREATE [OR REPLACE] FUNCTION public.<name>(...) ... AS $tag$ body $tag$`
 * in one SQL text, in order.
 */
export function extractFunctions(sql) {
  const out = [];
  const head = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi;
  let m;
  while ((m = head.exec(sql)) !== null) {
    const name = m[1].toLowerCase();
    // Balanced parens for the argument list.
    let i = head.lastIndex, depth = 1;
    while (i < sql.length && depth > 0) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")") depth--;
      i++;
    }
    const args = sql.slice(head.lastIndex, i - 1);
    const asMatch = /\bAS\s+(\$[A-Za-z0-9_]*\$)/i.exec(sql.slice(i));
    if (!asMatch) continue;
    const tag = asMatch[1];
    const bodyStart = i + asMatch.index + asMatch[0].length;
    const bodyEnd = sql.indexOf(tag, bodyStart);
    if (bodyEnd < 0) continue;
    const header = sql.slice(i, i + asMatch.index);
    // Attributes may also trail the body (`$$ LANGUAGE plpgsql SECURITY DEFINER;`).
    const trailer = sql.slice(bodyEnd + tag.length, sql.indexOf(";", bodyEnd + tag.length) + 1 || undefined);
    const attrs = `${header} ${trailer}`;
    out.push({
      name,
      args: parseArgs(args),
      secdef: /\bSECURITY\s+DEFINER\b/i.test(attrs),
      returnsTrigger: /\bRETURNS\s+trigger\b/i.test(attrs),
      body: sql.slice(bodyStart, bodyEnd),
      index: m.index,
    });
    head.lastIndex = bodyEnd + tag.length;
  }
  return out;
}

const CLIENT_ROLES = new Set(["public", "anon", "authenticated"]);

/**
 * Replay a migration corpus (already sorted oldest → newest) into the newest
 * definition of every public function, with its EXECUTE grantees.
 * `files` is [{ name, sql }].
 */
export function newestFunctions(files) {
  const fns = new Map();
  const grants = new Map(); // name -> Set(role)
  for (const { name: file, sql } of files) {
    const events = [];
    for (const f of extractFunctions(sql)) events.push({ at: f.index, kind: "create", f });
    for (const m of sql.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)) {
      events.push({ at: m.index, kind: "drop", name: m[1].toLowerCase() });
    }
    for (const m of sql.matchAll(/\b(GRANT|REVOKE)\s+(?:ALL|EXECUTE)(?:\s+PRIVILEGES)?\s+ON\s+FUNCTION\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\([^)]*\)\s+(?:TO|FROM)\s+([^;]+);/gi)) {
      const roles = m[3].split(",").map((r) => r.trim().toLowerCase().replace(/"/g, "")).filter(Boolean);
      events.push({ at: m.index, kind: m[1].toLowerCase(), name: m[2].toLowerCase(), roles });
    }
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.kind === "create") {
        if (!grants.has(e.f.name)) grants.set(e.f.name, new Set(["public"]));
        fns.set(e.f.name, { ...e.f, file });
      } else if (e.kind === "drop") {
        grants.delete(e.name);
        fns.delete(e.name);
      } else if (e.kind === "grant") {
        const g = grants.get(e.name) ?? new Set();
        e.roles.forEach((r) => g.add(r));
        grants.set(e.name, g);
      } else if (e.kind === "revoke") {
        const g = grants.get(e.name) ?? new Set();
        e.roles.forEach((r) => g.delete(r));
        grants.set(e.name, g);
      }
    }
  }
  for (const [name, f] of fns) {
    const g = grants.get(name) ?? new Set(["public"]);
    f.grantees = [...g];
    f.clientCallable = [...g].some((r) => CLIENT_ROLES.has(r));
  }
  return fns;
}

/**
 * The newest `CREATE TRIGGER <t> ... ON public.jobs ... EXECUTE FUNCTION <fn>`
 * per trigger name, minus any dropped later. Returns Map trigger -> fn.
 */
export function jobsTriggers(files) {
  const trg = new Map();
  for (const { sql: raw } of files) {
    const sql = raw.replace(/--[^\n]*/g, "");
    const events = [];
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+"?([a-z0-9_]+)"?([\s\S]*?)EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?"?([a-z0-9_]+)"?/gi)) {
      if (/\bON\s+(?:public\.)?jobs\b/i.test(m[2])) events.push({ at: m.index, kind: "create", t: m[1].toLowerCase(), fn: m[3].toLowerCase() });
    }
    for (const m of sql.matchAll(/DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?([a-z0-9_]+)"?\s+ON\s+(?:public\.)?jobs\b/gi)) {
      events.push({ at: m.index, kind: "drop", t: m[1].toLowerCase() });
    }
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.kind === "create") trg.set(e.t, e.fn);
      else trg.delete(e.t);
    }
  }
  return trg;
}

/** Strip `--` comments and string literals' contents that would fool the rules. */
function codeOnly(body) {
  return body.replace(/--[^\n]*/g, "");
}

/**
 * Why a function counts as writing public.jobs from a caller-supplied column
 * list or patch. Empty array = it does not. Only meaningful for a
 * client-callable SECURITY DEFINER function: a direct client write is already
 * policed by the jobs triggers, and a definer function runs as its owner, which
 * the dispute-state trigger trusts. A definer function that forwards the
 * CALLER's choice of columns or values is the one shape that turns that trust
 * into a bypass.
 *
 * fn: { name, args: [{name, type}], body }
 */
export function dynamicJobsWriterReasons(fn) {
  const body = codeOnly(fn.body ?? "");
  const reasons = [];
  if (!/\bjobs\b/i.test(body)) return reasons;

  // R1. Dynamic SQL in a body that WRITES jobs: the statement text, and so
  //     its column list, is assembled at run time.
  const writesJobsAnyhow = /\b(?:UPDATE\s+(?:ONLY\s+)?|INSERT\s+INTO\s+)(?:public\.)?jobs\b|%I|\bjobs\b[^;]*\bSET\b/i.test(body);
  if (writesJobsAnyhow && /\bEXECUTE\s+(?!FUNCTION\b|PROCEDURE\b)(?:format\s*\(|'|\$|[a-z_][\w.]*\s*(?:\|\||;|USING\b))/i.test(body)) {
    reasons.push("dynamic SQL (EXECUTE) in a function that touches jobs");
  }

  // R2. A jobs row materialised from JSON and written back: every key the
  //     caller sends becomes a column. A READER that builds jobs-shaped rows
  //     this way (get_jobs_for_my_applications) writes nothing and is not it.
  const writesJobs = /\b(?:UPDATE\s+(?:ONLY\s+)?|INSERT\s+INTO\s+)(?:public\.)?jobs\b/i.test(body);
  if (writesJobs && /\bjsonb?_populate_record(?:set)?\s*\(\s*(?:NULL\s*::\s*)?(?:public\.)?jobs\b/i.test(body)) {
    reasons.push("jobs row built with json(b)_populate_record(set)");
  }

  // R3. UPDATE jobs whose SET list reads a json/jsonb/hstore/record/array parameter.
  const patchArgs = (fn.args ?? []).filter((a) => a.name && /\b(jsonb?|hstore|record)\b|\[\]$/.test(a.type));
  if (patchArgs.length) {
    for (const u of body.matchAll(/\bUPDATE\s+(?:ONLY\s+)?(?:public\.)?jobs\b(?:\s+(?:AS\s+)?\w+)?\s+SET\s+([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|;)/gi)) {
      for (const a of patchArgs) {
        if (new RegExp(`(^|[^\\w.])${a.name}\\s*(->|#>|\\[|\\))`, "i").test(u[1]) || new RegExp(`=\\s*${a.name}\\b`, "i").test(u[1])) {
          reasons.push(`UPDATE jobs SET reads the caller's ${a.type} argument ${a.name}`);
        }
      }
    }
  }
  return [...new Set(reasons)];
}

/**
 * Parse a pg_proc.proacl text (`{=X/postgres,anon=X/postgres,...}`) into
 * "may a client role execute this". NULL acl = the default PUBLIC EXECUTE.
 */
export function aclIsClientCallable(acl) {
  if (acl == null || acl === "") return true;
  return acl
    .replace(/[{}"]/g, "")
    .split(",")
    .some((entry) => {
      const [grantee, rest] = entry.split("=");
      if (rest === undefined || !rest.split("/")[0].includes("X")) return false;
      return grantee === "" || grantee === "anon" || grantee === "authenticated";
    });
}

/**
 * Reviewed-safe definer functions that R3 flags: each writes ONE named jobs
 * column from a caller argument but validates every element server-side. One
 * list for the static test (src/test/jobsStateColumnGuard.test.ts) and the live
 * check (scripts/check-jobs-dynamic-writers.mjs) — they held separate copies,
 * and the live one without the entry was red every night from 2026-09-20.
 * An entry only exempts while the body still calls its validator: strip the
 * validation and the function is an offender again. Keep tiny; every entry
 * needs a why.
 */
export const REVIEWED_JOBS_WRITERS = new Map([
  // rpc_add_dispute_evidence (dispute-races, 20260915034822): appends to
  // jobs.dispute_evidence_urls from the caller's text[], but validates every
  // element with dispute_evidence_url_ok (must be the caller's OWN signed
  // proof-photo path), requires the caller be a party to an admin-reopened
  // OPEN dispute, and an append-only trigger blocks removals. Cleared by the
  // dispute-races money + authz reviews (2026-09-15); docs/OPEN.md LOW-4
  // tracks moving it off jobs onto disputes as the eventual real fix.
  ["rpc_add_dispute_evidence", /\bdispute_evidence_url_ok\s*\(/i],
]);

/** True when `name` is a reviewed writer AND its body still carries the validator. */
export function isReviewedJobsWriter(name, body) {
  const validator = REVIEWED_JOBS_WRITERS.get(name);
  return !!validator && validator.test(codeOnly(body ?? ""));
}
