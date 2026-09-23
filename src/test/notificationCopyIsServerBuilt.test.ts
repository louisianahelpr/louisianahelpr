/**
 * CLASS CHECK (Q223 / bus EF-003) — a user who is not an admin never writes the
 * words of a notification someone ELSE receives.
 *
 * FOUND: `create-notification` inserted the caller's own `title`, `message` and
 * `type` for any job counterparty or mere applicant, so an applicant could put
 * a `payment` / `verified` / `system_alert` notification, worded however they
 * liked, into a poster's bell and a Helpr-branded email. That function is now
 * template-only for non-admins (behaviour pinned by
 * src/test/edge/create-notification.test.ts). This file is the CLASS: every
 * other way a client request can end in a `notifications` row.
 *
 *   1. EDGE FUNCTIONS. In every file under supabase/functions, a
 *      `.from("notifications").insert(...)` may not build `title` or `message`
 *      from the request body (`await req.json()` and whatever is destructured
 *      from it).
 *   2. SQL FUNCTIONS a client can execute (not a trigger; EXECUTE still held
 *      by `authenticated` after every GRANT/REVOKE in the ledger — Supabase
 *      grants it by default). An `INSERT INTO notifications` may not carry a
 *      text/jsonb PARAMETER (or a variable assigned from one) unless the body
 *      is admin-gated (`has_role(..., 'admin')`).
 *   3. RLS. Every INSERT policy left on `public.notifications` is admin- or
 *      service_role-scoped — no client writes the table directly.
 *
 * Each of 1 and 2 has an EXACT allowlist of reviewed exceptions: an entry the
 * scan no longer flags fails too, so the list cannot go stale.
 *
 * Reads the NEWEST definition of every SQL function (any dollar-quote tag),
 * comments blanked with the shared helpers.
 */
// Registered mutations - each turns this guard RED on its own:
//   An edge function that sends the caller's own words to someone else.
// @mutate supabase/functions/cash-out-credits/index.ts | message: `$${formatPayoutDollars(totalAmount)} in referral credits has been sent to your connected Stripe account.`, | message: body.note,
//   A client-callable RPC that quotes caller text with its admin gate removed.
// @mutate supabase/migrations/20260907195145_review_credential_clears_boolean_and_queue_reads_helper_credentials.sql | IF NOT has_role(auth.uid(), 'admin') THEN | IF false THEN
//   A notifications INSERT policy any signed-in user passes.
// @mutate supabase/migrations/20260311134945_6c2ed9cc-1a8c-41e0-b63f-f26e7a726267.sql | ON public.notifications FOR INSERT\nTO authenticated\nWITH CHECK (has_role(auth.uid(), 'admin'::app_role)); | ON public.notifications FOR INSERT\nTO authenticated\nWITH CHECK (true);
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const REPO = resolve(__dirname, "..", "..");
/** `has_role(auth.uid(), 'admin')` in any spelling — the argument list nests parens. */
const ADMIN_GATE = /has_role\s*\([\s\S]{0,80}?'admin'/i;
const FUNCTIONS = join(REPO, "supabase", "functions");
const MIGRATIONS = join(REPO, "supabase", "migrations");

// ─── 1. edge functions ──────────────────────────────────────────────────────

/**
 * Reviewed hits, keyed `file :: title|message ← identifier`. Each is either
 * gated to a caller who may legitimately write that text, or a different
 * binding that happens to share a body field's name (the scan is not
 * scope-aware — a false positive is listed here, with its reason, rather than
 * weakening the rule for everyone).
 */
// @two-way src/test/notificationCopyIsServerBuilt.test.ts:EDGE_EXEMPT entries the scan no longer flags
const EDGE_EXEMPT: Record<string, string> = {
  "supabase/functions/create-notification/index.ts :: title ← title":
    "admin-only free-text branch (has_role gate); every non-admin path is template-built — behaviour pinned in src/test/edge/create-notification.test.ts",
  "supabase/functions/create-notification/index.ts :: message ← message":
    "same admin-only branch as the title entry",
  "supabase/functions/create-payment/index.ts :: message ← note":
    "request_revision: poster-only (job.customer_id === caller), job must be in_progress, written only by the revision transition it performs; the note is the revision itself, attributed 'The person who posted … has requested revisions:'",
  "supabase/functions/create-payment/index.ts :: message ← reason":
    "admin_refund_general: admin-only action (the admin audit row names the caller); the support-cancel reason is the admin's",
  "supabase/functions/create-payment/index.ts :: message ← amount":
    "false positive: `amount` here is the numeric parameter of the transfer helper (Failed to transfer $${amount.toFixed(2)}…), not the tip body field",
};

/** The value text of `key:` inside an object literal, to the next top-level comma. */
function propertyValues(obj: string, key: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`(?:^|[\\s,{])${key}\\s*(:|,|\\n|\\})`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(obj))) {
    if (m[1] !== ":") {
      out.push(key); // shorthand `{ title, ... }`
      continue;
    }
    let i = m.index + m[0].length;
    let depth = 0;
    const start = i;
    for (; i < obj.length; i++) {
      const c = obj[i];
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) {
        if (depth === 0) break;
        depth--;
      } else if (c === "," && depth === 0) break;
    }
    out.push(obj.slice(start, i));
  }
  return out;
}

/**
 * The expression with literal TEXT removed: "…" and '…' dropped, a template
 * literal reduced to its `${…}` holes. The words in a literal are the
 * server's own; only an identifier can carry the caller's.
 */
function expressionOnly(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < value.length && value[i] !== c) i += value[i] === "\\" ? 2 : 1;
    } else if (c === "`") {
      i++;
      while (i < value.length && value[i] !== "`") {
        if (value[i] === "\\") i += 2;
        else if (value[i] === "$" && value[i + 1] === "{") {
          let depth = 1;
          i += 2;
          const start = i;
          while (i < value.length && depth > 0) {
            if (value[i] === "{") depth++;
            else if (value[i] === "}") depth--;
            i++;
          }
          out += " " + value.slice(start, i - 1) + " ";
        } else i++;
      }
    } else out += c;
  }
  return out;
}

/** The argument text of the `.insert(` call starting at `from`. */
function callArgs(src: string, from: number): string {
  const open = src.indexOf("(", from);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return "";
}

/** Identifiers that carry request-body data in this file. */
function bodyIdentifiers(code: string): Set<string> {
  const ids = new Set<string>();
  const addDestructure = (inner: string) => {
    for (const part of inner.split(",")) {
      const name = part.split("=")[0].split(":").pop()!.trim();
      if (/^\w+$/.test(name)) ids.add(name);
    }
  };
  for (const m of code.matchAll(/const\s*\{([^}]*)\}\s*=\s*await\s+req\.json\(\)/g)) addDestructure(m[1]);
  for (const m of code.matchAll(/(?:const|let|var)?\s*(\w+)\s*=\s*await\s+req\.json\(\)/g)) ids.add(m[1]);
  // One hop: `const { a, b } = body` / `= body ?? {}`.
  for (const b of [...ids]) {
    for (const m of code.matchAll(new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*${b}\\b`, "g"))) addDestructure(m[1]);
  }
  // Ids are not copy: a job/user id names a row (PostgREST refuses a
  // non-uuid), it cannot carry a message. The class is caller-written TEXT.
  for (const id of [...ids]) if (/^id$|Id$|_id$/.test(id)) ids.delete(id);
  return ids;
}

function edgeOffenders(): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of walkSource([FUNCTIONS], [".ts", ".tsx"])) {
    const code = blankComments(readFileSync(file, "utf8"));
    const ids = bodyIdentifiers(code);
    if (!ids.size) continue;
    for (const m of code.matchAll(/\.from\(\s*["']notifications["']\s*\)\s*\.insert\s*\(/g)) {
      const args = callArgs(code, m.index! + m[0].length - 1);
      for (const key of ["title", "message"]) {
        for (const value of propertyValues(args, key)) {
          const expr = expressionOnly(value);
          const hit = [...ids].find((id) => new RegExp(`\\b${id}\\b`).test(expr));
          if (hit) out.set(`${relative(REPO, file)} :: ${key} ← ${hit}`, value.trim().slice(0, 160));
        }
      }
    }
  }
  return out;
}

// ─── 2. SQL functions ───────────────────────────────────────────────────────

/**
 * Reviewed client-callable SQL functions that quote a caller's text in a
 * notification, each ATTRIBUTED to the person who wrote it and bound to the
 * state change the function itself performs (not a free-standing message).
 */
// @two-way src/test/notificationCopyIsServerBuilt.test.ts:SQL_EXEMPT entries the scan no longer flags
const SQL_EXEMPT: Record<string, string> = {
  helper_abort_job:
    "quotes the assigned Helpr's own reason, prefixed 'Your Helpr had to stop work on …:', written only by the abort transition it performs",
  reject_pending_job:
    "business approver's rejection reason, prefixed 'Reason:' in the post-rejected notice; gated to the business's approvers",
};

interface SqlFn {
  name: string;
  file: string;
  args: string;
  body: string;
  returnsTrigger: boolean;
}

const FUNC_RE =
  /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\)\s*returns\s+([\s\S]*?)\bas\s+(\$\w*\$)([\s\S]*?)\4/gi;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
}

/** Newest definition of every function, plus EXECUTE state for `authenticated`. */
function sqlFunctions(): { defs: Map<string, SqlFn>; authCanExecute: Map<string, boolean> } {
  const defs = new Map<string, SqlFn>();
  const auth = new Map<string, boolean>();
  for (const f of migrationFiles()) {
    const sql = blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"));
    // Events in file order: definitions reset nothing (CREATE OR REPLACE keeps
    // the ACL) except the first, which starts at Supabase's default grant.
    const events: Array<{ at: number; apply: () => void }> = [];
    for (const m of sql.matchAll(FUNC_RE)) {
      const name = m[1].toLowerCase();
      events.push({
        at: m.index!,
        apply: () => {
          defs.set(name, {
            name,
            file: f,
            args: m[2],
            body: m[5],
            returnsTrigger: /^\s*trigger\b/i.test(m[3]),
          });
          if (!auth.has(name)) auth.set(name, true);
        },
      });
    }
    for (const m of sql.matchAll(
      /\b(grant|revoke)\s+(?:all|execute)(?:\s+privileges)?\s+on\s+function\s+(?:public\.)?"?(\w+)"?[^;]*?\b(to|from)\s+([^;]+);/gi,
    )) {
      const name = m[2].toLowerCase();
      const roles = m[4].toLowerCase();
      const grant = m[1].toLowerCase() === "grant";
      events.push({
        at: m.index!,
        apply: () => {
          if (/\bauthenticated\b/.test(roles)) auth.set(name, grant);
          else if (grant && /\bpublic\b/.test(roles)) auth.set(name, true);
        },
      });
    }
    events.sort((a, b) => a.at - b.at).forEach((e) => e.apply());
  }
  return { defs, authCanExecute: auth };
}

function sqlOffenders(): Map<string, string> {
  const { defs, authCanExecute } = sqlFunctions();
  const out = new Map<string, string>();
  for (const fn of defs.values()) {
    if (fn.returnsTrigger || !authCanExecute.get(fn.name)) continue;
    if (!/insert\s+into\s+(?:public\.)?notifications\b/i.test(fn.body)) continue;
    if (ADMIN_GATE.test(fn.body)) continue;
    const taint = new Set(
      [...fn.args.matchAll(/(\w+)\s+(?:text|varchar|character\s+varying|jsonb|json)\b/gi)].map((m) => m[1].toLowerCase()),
    );
    if (!taint.size) continue;
    for (let pass = 0; pass < 4; pass++) {
      for (const m of fn.body.matchAll(/(\w+)\s*:=\s*([^;]+);/g)) {
        if ([...taint].some((t) => new RegExp(`\\b${t}\\b`, "i").test(m[2]))) taint.add(m[1].toLowerCase());
      }
    }
    for (const m of fn.body.matchAll(/insert\s+into\s+(?:public\.)?notifications\b[\s\S]*?;/gi)) {
      const hit = [...taint].find((t) => new RegExp(`\\b${t}\\b`, "i").test(m[0]));
      if (hit) out.set(fn.name, `${fn.file}: ${hit}`);
    }
  }
  return out;
}

// ─── 3. RLS ─────────────────────────────────────────────────────────────────

function notificationInsertPolicies(): Map<string, string> {
  const live = new Map<string, string>();
  for (const f of migrationFiles()) {
    const sql = blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"));
    const events: Array<{ at: number; apply: () => void }> = [];
    for (const m of sql.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+(?:public\.)?notifications\b/gi)) {
      events.push({ at: m.index!, apply: () => live.delete(m[1]) });
    }
    for (const m of sql.matchAll(/create\s+policy\s+"([^"]+)"\s+on\s+(?:public\.)?notifications\b([^;]*);/gi)) {
      events.push({
        at: m.index!,
        apply: () => {
          if (/\bfor\s+(insert|all)\b/i.test(m[2])) live.set(m[1], m[2]);
        },
      });
    }
    events.sort((a, b) => a.at - b.at).forEach((e) => e.apply());
  }
  return live;
}

describe("notification copy is server-built for every non-admin path (Q223)", () => {
  it("no edge function puts request-body text in a notification's title or message", () => {
    const offenders = edgeOffenders();
    // Inventory floor: the scan must be reading real edge functions.
    const scanned = walkSource([FUNCTIONS], [".ts", ".tsx"]).filter((f) =>
      /\.from\(\s*["']notifications["']\s*\)\s*\.insert/.test(readFileSync(f, "utf8")),
    );
    expect(scanned.length).toBeGreaterThan(20);
    const unexpected = [...offenders].filter(([f]) => !(f in EDGE_EXEMPT));
    expect(unexpected, "edge notification copy taken from the request body").toEqual([]);
    const stale = Object.keys(EDGE_EXEMPT).filter((f) => !offenders.has(f));
    expect(stale, "EDGE_EXEMPT entries the scan no longer flags — delete them").toEqual([]);
  });

  it("no client-callable SQL function puts a caller's text in a notification unless admin-gated or reviewed", () => {
    const { defs } = sqlFunctions();
    const producers = [...defs.values()].filter((d) => /insert\s+into\s+(?:public\.)?notifications\b/i.test(d.body));
    expect(producers.length).toBeGreaterThan(30);
    const offenders = sqlOffenders();
    const unexpected = [...offenders].filter(([n]) => !(n in SQL_EXEMPT));
    expect(unexpected, "client-callable RPC writes caller text into a notification").toEqual([]);
    const stale = Object.keys(SQL_EXEMPT).filter((n) => !offenders.has(n));
    expect(stale, "SQL_EXEMPT entries the scan no longer flags — delete them").toEqual([]);
  });

  it("every INSERT policy left on notifications is admin- or service_role-only", () => {
    const live = notificationInsertPolicies();
    const open = [...live].filter(
      ([, body]) =>
        !/\bto\s+service_role\b/i.test(body) &&
        !/auth\.role\(\)\s*=\s*'service_role'/i.test(body) &&
        !ADMIN_GATE.test(body),
    );
    expect(open, "a client can insert notifications directly").toEqual([]);
  });

  it("the scanners can fail: a planted offender in each shape is caught", () => {
    const code = `const { note } = await req.json();\nawait db.from("notifications").insert({ user_id, title: "Hi", message: \`\${note}\` });`;
    const ids = bodyIdentifiers(code);
    const args = callArgs(code, code.indexOf(".insert(") + ".insert".length);
    expect(propertyValues(args, "message").some((v) => [...ids].some((id) => expressionOnly(v).includes(id)))).toBe(true);
    expect(expressionOnly(`"the note amount" + \`n=\${x}\``).replace(/\s+/g, " ").trim()).toBe("+ x");
    expect(propertyValues(`{ user_id, title, message: "x" }`, "title")).toEqual(["title"]);
  });
});
