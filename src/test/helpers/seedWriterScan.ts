/**
 * Finds every place a test / script / probe writes a NEW row into a table that
 * carries `is_seed` (docs/OPEN.md Q46), and says whether the writer sets the
 * flag. Shared by src/test/fixtureWritersSetIsSeed.test.ts; kept apart so the
 * scanner can be exercised on synthetic source as well as on the tree.
 *
 * A "site" is one of:
 *   rest       a POST to `/rest/v1/<table>` (request.post / api.post / fetch
 *              with method POST), or a wrapper called with a literal "POST"
 *              and a literal `<table>` path, or `upsert("<table>", …)` /
 *              `insert("<table>", …)` helpers;
 *   js         `.from("<table>").insert(` / `.upsert(`;
 *   sql        `INSERT INTO [public.]<table>` inside a string;
 *   account    anything that creates an auth user, because handle_new_user
 *              inserts the `profiles` row: POST `/auth/v1/admin/users`,
 *              `/auth/v1/signup`, `auth.admin.createUser(`, `auth.signUp(`,
 *              `INSERT INTO auth.users`.
 * A site is SET when `is_seed` appears (in code) in the call, or in an
 * initializer the call names (followed up to 4 levels: `upsert("jobs",
 * [...posterJobs])` → `posterJobs = … ({ ...jobBase })` → `jobBase = { …
 * is_seed: true }`). Otherwise it must carry a `seed-policy:` comment within
 * the 6 lines above it naming who marks the row (see the test for the words).
 */
import { blankComments } from "./blankNonCode";

export type SeedSite = {
  file: string;
  line: number;
  kind: "rest" | "js" | "sql" | "account";
  table: string;
  sets: boolean;
  policy: string | null;
};

/** The tables that carry is_seed. fixtureWritersSetIsSeed.test.ts derives the set from the migrations and fails when they differ. */
export const SEED_TABLES = ["jobs", "profiles"] as const;
const TABLES = SEED_TABLES.join("|");

/** Index of the `(` that encloses `pos` (innermost unclosed), or -1. */
function enclosingParen(code: string, pos: number): number {
  let depth = 0;
  for (let i = pos - 1; i >= 0; i--) {
    const c = code[i];
    if (c === ")" || c === "]" || c === "}") depth++;
    else if (c === "(" || c === "[" || c === "{") {
      if (depth === 0) {
        if (c === "(") return i;
        // a `{`/`[` we are inside of: keep walking outwards
        continue;
      }
      depth--;
    }
  }
  return -1;
}

/** Index just past the bracket that closes the one opened at `open`. */
function closeOf(code: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ")" || c === "]" || c === "}") {
      stack.pop();
      if (stack.length === 0) return i + 1;
    }
  }
  return code.length;
}

function calleeBefore(code: string, paren: number): string {
  const m = /([\w$.]+)\s*$/.exec(code.slice(Math.max(0, paren - 80), paren));
  return m ? m[1] : "";
}

const lineOf = (code: string, idx: number) => code.slice(0, idx).split("\n").length;

/** Initializer text of `const|let|var <id> =` in the file, to the end of the statement. */
function initializerOf(code: string, id: string): string | null {
  const name = id.replace(/\$/g, "\\$");
  // `function <id>(…) { … }`: the whole declaration, to its closing brace.
  const fn = new RegExp(`\\bfunction\\s*\\*?\\s+${name}\\s*\\(`).exec(code);
  if (fn) {
    const body = code.indexOf("{", closeOf(code, fn.index + fn[0].length - 1));
    if (body >= 0) return code.slice(fn.index, closeOf(code, body));
  }
  // `const <id> =`, or a destructuring `const { a, <id> } = …` / `const [<id>] = …`
  const re = new RegExp(`\\b(?:const|let|var)\\s+(?:${name}\\b[^=]*|[{[][^=]*\\b${name}\\b[^=]*[}\\]]\\s*)=(?!=)`, "g");
  const m = re.exec(code);
  if (!m) return null;
  let i = m.index + m[0].length;
  const start = i;
  let depth = 0;
  for (; i < code.length; i++) {
    const c = code[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && (c === ";" || (c === "\n" && /[\w)\]}"'`]\s*$/.test(code.slice(start, i)) && !/^\s*[.?:+\-*/|&]/.test(code.slice(i + 1, i + 40))))) break;
  }
  return code.slice(start, i);
}

/**
 * `is_seed` as a payload KEY with a value that is not `false` — not a read
 * (`p.is_seed`), a filter (`is_seed=eq.true`) or a refusal check.
 */
const IS_SEED_KEY = /["']?\bis_seed["']?\s*:\s*(?!false\b)/;
const IDENT = /\b[A-Za-z_$][\w$]*\b/g;
/** Ids and lookups (posterId, job_id, …) are never the payload; following them reads unrelated functions. */
const NOT_PAYLOAD = /(?:Id|_id|ID|Ids|_ids)$|^(?:id|await|async|const|let|return|new|JSON|Object|Array|String|Number|Date|Math|Promise|process|console)$/;

/** True when `is_seed` is set in `text` or in an initializer `text` names (depth ≤ 4). */
export function mentionsIsSeed(code: string, text: string, depth = 4, seen = new Set<string>()): boolean {
  if (IS_SEED_KEY.test(text)) return true;
  if (depth === 0) return false;
  for (const id of new Set(text.match(IDENT) ?? [])) {
    if (seen.has(id) || NOT_PAYLOAD.test(id)) continue;
    seen.add(id);
    const init = initializerOf(code, id);
    if (init && mentionsIsSeed(code, init, depth - 1, seen)) return true;
  }
  return false;
}

/** The `seed-policy:` text in a comment within 6 lines above `line` (1-based), if any. */
function policyNear(raw: string, line: number): string | null {
  const lines = raw.split("\n");
  for (let l = line - 1; l >= Math.max(0, line - 7); l--) {
    const m = /(?:\/\/|\*|#)\s*seed-policy:\s*(.+)$/.exec(lines[l] ?? "");
    if (m) return m[1].trim();
  }
  return null;
}

export function scanSeedWriters(file: string, raw: string): SeedSite[] {
  const isShell = file.endsWith(".sh");
  // Shell has `#` comments; the JS scanner would read them as code. Blank them
  // line by line (a `#` that opens a line, or follows whitespace).
  const code = isShell ? raw.replace(/(^|\s)#.*$/gm, (_m, p1: string) => p1) : blankComments(raw);
  // PGlite probes write to an in-process database, never prod.
  if (/@electric-sql\/pglite/.test(code)) return [];
  const out: SeedSite[] = [];
  const seenAt = new Set<number>();
  const push = (kind: SeedSite["kind"], table: string, at: number, span: string) => {
    const line = lineOf(code, at);
    if (seenAt.has(line)) return;
    seenAt.add(line);
    // An auth-user payload cannot carry profiles.is_seed (GoTrue does not
    // write that table), so an account site always needs a declared policy.
    // SQL names the column in its column list; JS payloads name it as a key.
    const sets = kind === "sql" ? /\bis_seed\b/.test(span) : kind !== "account" && mentionsIsSeed(code, span);
    out.push({ file, line, kind, table, sets, policy: policyNear(raw, line) });
  };

  // rest: a literal `/rest/v1/<table>` URL inside a POST call.
  for (const m of code.matchAll(new RegExp(`/(rest/v1/(${TABLES})|auth/v1/admin/users|auth/v1/signup)(?![\\w/-])`, "g"))) {
    const at = m.index!;
    const table = m[2] ?? "profiles";
    const kind = m[2] ? "rest" : "account";
    if (isShell) {
      const ln = code.split("\n")[lineOf(code, at) - 1] ?? "";
      if (/-X\s*POST|--data|-d\s/.test(ln)) push(kind, table, at, ln);
      continue;
    }
    const open = enclosingParen(code, at);
    if (open < 0) continue;
    const span = code.slice(open, closeOf(code, open));
    const callee = calleeBefore(code, open);
    const isPost =
      /\.post$/i.test(callee) ||
      (/(^|\.)fetch$/.test(callee) && /\bmethod\s*:\s*["'`]POST["'`]/.test(span));
    if (isPost) push(kind, table, open - callee.length, span);
  }

  // rest: a REST wrapper handed the table as a literal argument — srWrite(req,
  // "POST", "jobs", …), restAs(api, s, "post", "jobs?select=id", …),
  // rest("jobs", { method: "POST" }), upsert("jobs", rows) / insert("jobs", …).
  for (const m of code.matchAll(new RegExp(`["'\`](${TABLES})(?:\\?[^"'\`\\n]*)?["'\`]`, "g"))) {
    const open = enclosingParen(code, m.index!);
    if (open < 0) continue;
    const callee = calleeBefore(code, open);
    if (/(^|\.)(from|select|get|patch|delete|rpc|includes|has|push|add|set|test|match|startsWith|endsWith|mockTable|check|log|error|warn|info)$/.test(callee)) continue;
    const span = code.slice(open, closeOf(code, open));
    // the literal must be a top-level argument of this call, not text nested deeper
    if (enclosingParen(code, m.index!) !== open) continue;
    const post = /(?:^|[(,]\s*)["'`]post["'`]\s*[,)]/i.test(span) || /\bmethod\s*:\s*["'`]POST["'`]/.test(span);
    const helper = /(upsert|insert)\w*$/i.test(callee);
    if (post || helper) push("rest", m[1], open - callee.length, span);
  }

  // js: .from("<table>").insert( / .upsert(
  for (const m of code.matchAll(new RegExp(`\\.from\\(\\s*["'\`](${TABLES})["'\`]\\s*\\)\\s*\\.\\s*(insert|upsert)\\s*\\(`, "g"))) {
    const open = m.index! + m[0].length - 1;
    push("js", m[1], m.index!, code.slice(open, closeOf(code, open)));
  }
  for (const m of code.matchAll(/\bauth\s*\.\s*(?:admin\s*\.\s*createUser|signUp)\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    push("account", "profiles", m.index!, code.slice(open, closeOf(code, open)));
  }

  // sql: INSERT INTO [public.]<table> / auth.users inside a string.
  for (const m of code.matchAll(new RegExp(`INSERT\\s+INTO\\s+(?:(public)\\.)?(${TABLES})\\b|INSERT\\s+INTO\\s+auth\\.users\\b`, "gi"))) {
    const at = m.index!;
    const table = m[2]?.toLowerCase() ?? "profiles";
    const kind = m[2] ? "sql" : "account";
    // the statement: to the end of the enclosing string/call, bounded
    const open = enclosingParen(code, at);
    const span = open >= 0 ? code.slice(open, closeOf(code, open)) : code.slice(at, at + 600);
    push(kind, table, at, span);
  }
  return out.sort((a, b) => a.line - b.line);
}
