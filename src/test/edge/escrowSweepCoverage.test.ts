/// <reference types="node" />
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * NO JOB STATE MAY HOLD ESCROW WITH NO SCHEDULED PATH OUT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE BUG THIS IS THE CLASS OF (owner, 2026-09-19). A job that reached
 * `in_progress` and was never marked done by either side matched no scheduled
 * sweep at all. `auto-expire-jobs` wants `accepted` or `open`;
 * `auto-release-payment` wants `poster_completed_at <= cutoff OR
 * helper_completed_at <= cutoff`; `arrival-confirm-reminder` wants an
 * unconfirmed arrival, which an `in_progress` job cannot have. So the escrow
 * sat held forever, with no Approve control and no explanation on screen.
 * Eleven rows were in that trap on prod.
 *
 * WHY A "DOES MY NEW SWEEP FIRE?" TEST WOULD NOT DO. That bug was not one
 * missing sweep, it was a HOLE IN A MATRIX nobody was keeping. The check has to
 * be able to fail for a status that does not exist yet.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HOW IT IS BUILT — three inventories, all DERIVED, none hand-typed
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1. THE STATUSES come from `Constants.public.Enums.job_status` — the runtime
 *      array the Supabase type generator emits from the live enum. Add a
 *      status to the database, regenerate, and it appears here whether anyone
 *      remembered this file or not.
 *
 *   2. THE SWEEPS come from the migrations: every edge function named in a
 *      `/functions/v1/<name>` URL inside a `cron.schedule(...)` body. That is
 *      the app's own record of what is actually scheduled — not a list in a
 *      test, which would only ever track whoever typed it.
 *
 *   3. THE PREDICATES come from the sweeps' own source: every `.from("jobs")`
 *      SELECT chain is parsed out of the TypeScript AST, `.or()` strings
 *      included, and EVALUATED against a representative stranded job.
 *
 * The evaluation is what makes this honest. A static "does the status literal
 * appear anywhere in this function?" check would have passed on the original
 * bug — `auto-release-payment` does say `.in("status", ["in_progress", …])`.
 * It only fails to match because of a CONJUNCT: both completion stamps are
 * null, and in SQL a null column satisfies no comparison at all. So the
 * evaluator models exactly that (`nullNeverMatches` below), and a predicate
 * whose comparand is a runtime value is treated as satisfiable — the check
 * never fails a sweep for something it cannot see.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PROVEN ABLE TO FAIL
 * ═══════════════════════════════════════════════════════════════════════════
 * The last two cases re-run the whole matrix against the pre-fix world (this
 * lane's sweep deleted) and against an invented future status, and assert each
 * comes back RED. A guard that cannot fail certifies nothing.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { Constants } from "@/integrations/supabase/types";

const ROOT = path.resolve(__dirname, "../../..");
const FUNCTIONS_DIR = path.join(ROOT, "supabase", "functions");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");

/** THE source of truth for the statuses. Generated, never hand-listed. */
const JOB_STATUSES: readonly string[] = Constants.public.Enums.job_status;

// ───────────────────────────────────────────────────────────────────────────
// 1 — the sweep inventory, read out of the migrations
// ───────────────────────────────────────────────────────────────────────────

/** Five whitespace-separated cron fields — the shape of a schedule literal. */
const CRON_EXPR = /^(?:[\d*/,-]+|\*)(?:\s+(?:[\d*/,-]+|\*)){4}$/;

/**
 * Every edge function this database actually calls on a schedule.
 *
 * Derived from the migrations, in the two shapes they use, and only in files
 * that schedule anything at all:
 *
 *   a) a literal `.../functions/v1/<name>` inside a `cron.schedule` body
 *      (20260915070651_arrival_confirm_nudges and most single-cron files);
 *   b) a `'<name>', '<cron expression>'` pair — which covers both
 *      `cron.schedule('x', '0 14 * * *', …)` and the VALUES table in
 *      20260831190419_schedule_http_crons_missing_from_migrations, whose URL is
 *      built with `format(…, '/functions/v1/%s', v_target.jobname)` and so has
 *      no literal name in it at all. Thirteen crons, `auto-expire-jobs`
 *      included, are only reachable this way.
 *
 * A name only counts if `supabase/functions/<name>/index.ts` exists, which
 * throws away pure-SQL crons (sweep-dead-crons, prune-cron-run-log, …).
 *
 * Cross-checked against prod on 2026-09-19: `SELECT jobname FROM cron.job WHERE
 * command LIKE '%functions/v1/%'` returned 25 rows and this returns the same
 * set.
 */
export function scheduledSweepNames(migrationsDir = MIGRATIONS_DIR): string[] {
  const names = new Set<string>();
  for (const file of fs.readdirSync(migrationsDir)) {
    if (!file.endsWith(".sql")) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    if (!/cron\.schedule/i.test(sql)) continue;
    for (const block of sql.split(/cron\.schedule/i).slice(1)) {
      for (const m of block.matchAll(/\/functions\/v1\/([a-z0-9-]+)/gi)) names.add(m[1]);
    }
    for (const m of sql.matchAll(/'([a-z0-9][a-z0-9-]{2,})'\s*,\s*'([^']{9,})'/gi)) {
      if (CRON_EXPR.test(m[2].trim())) names.add(m[1]);
    }
  }
  return [...names].filter((n) => fs.existsSync(path.join(FUNCTIONS_DIR, n, "index.ts"))).sort();
}

// ───────────────────────────────────────────────────────────────────────────
// 2 — the predicate extractor
// ───────────────────────────────────────────────────────────────────────────

const UNKNOWN = Symbol("runtime value");
type Value = string | number | boolean | null | typeof UNKNOWN | Array<string | number | boolean | null>;

type Pred =
  | { kind: "cmp"; column: string; op: string; value: Value; negated: boolean }
  | { kind: "or"; text: string };

type Chain = { file: string; line: number; preds: Pred[] };

const FILTER_METHODS = new Set([
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "contains", "not", "or",
]);
/** A chain carrying any of these is a single-row read or a write, not a sweep. */
const NOT_A_SWEEP = new Set(["single", "maybeSingle", "update", "insert", "upsert", "delete", "rpc"]);

function litValue(n: ts.Expression | undefined): Value {
  if (!n) return UNKNOWN;
  let e: ts.Expression = n;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (e.kind === ts.SyntaxKind.NullKeyword) return null;
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(e)) {
    const out: Array<string | number | boolean | null> = [];
    for (const el of e.elements) {
      const v = litValue(el);
      if (v === UNKNOWN || Array.isArray(v)) return UNKNOWN;
      out.push(v as string | number | boolean | null);
    }
    return out;
  }
  return UNKNOWN;
}

/** A template literal as text, each `${…}` replaced by a placeholder token. */
function templateText(n: ts.Expression | undefined): string | null {
  if (!n) return null;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) {
    return n.head.text + n.templateSpans.map((s) => ` ${s.literal.text}`).join("");
  }
  return null;
}

/**
 * Every `.from("jobs")` SELECT chain in one source file, with its predicates.
 *
 * The walk starts at the chain's OUTERMOST call and collects the method calls
 * down to `.from("jobs")`, so a chain is captured once and in full rather than
 * once per link.
 */
export function extractJobChains(file: string, text: string): Chain[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const chains: Chain[] = [];
  const seenStarts = new Set<number>();

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      // Outermost link only: if this call is itself the receiver of another
      // call in the same chain, the outer one already covered it.
      const parent = node.parent;
      const isInner =
        parent &&
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        parent.parent &&
        ts.isCallExpression(parent.parent);
      if (!isInner) {
        const links: ts.CallExpression[] = [];
        let cur: ts.Expression = node;
        let table: string | null = null;
        while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
          const name = cur.expression.name.text;
          links.push(cur);
          if (name === "from") {
            const t = litValue(cur.arguments[0]);
            table = typeof t === "string" ? t : null;
            break;
          }
          cur = cur.expression.expression;
        }
        if (table === "jobs") {
          const methods = links.map((l) => (l.expression as ts.PropertyAccessExpression).name.text);
          const start = links[links.length - 1].getStart(sf);
          const sweepable =
            methods.includes("select") &&
            !methods.some((m) => NOT_A_SWEEP.has(m)) &&
            // `.eq("id", …)` is one job, not a population.
            !links.some((l) => {
              const m = (l.expression as ts.PropertyAccessExpression).name.text;
              return m === "eq" && litValue(l.arguments[0]) === "id";
            });
          if (sweepable && !seenStarts.has(start)) {
            seenStarts.add(start);
            const preds: Pred[] = [];
            for (const link of links) {
              const m = (link.expression as ts.PropertyAccessExpression).name.text;
              if (!FILTER_METHODS.has(m)) continue;
              if (m === "or") {
                const t = templateText(link.arguments[0]);
                if (t) preds.push({ kind: "or", text: t });
                continue;
              }
              if (m === "not") {
                const col = litValue(link.arguments[0]);
                const op = litValue(link.arguments[1]);
                if (typeof col === "string" && typeof op === "string") {
                  preds.push({ kind: "cmp", column: col, op, value: litValue(link.arguments[2]), negated: true });
                }
                continue;
              }
              const col = litValue(link.arguments[0]);
              if (typeof col !== "string") continue;
              preds.push({ kind: "cmp", column: col, op: m, value: litValue(link.arguments[1]), negated: false });
            }
            chains.push({
              file: path.relative(ROOT, file).split(path.sep).join("/"),
              line: sf.getLineAndCharacterOfPosition(start).line + 1,
              preds,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return chains;
}

// ───────────────────────────────────────────────────────────────────────────
// 3 — the evaluator
// ───────────────────────────────────────────────────────────────────────────

type Shape = Record<string, string | number | boolean | null>;
type Verdict = true | false | "unknown";

/**
 * Comparison operators under which a NULL column matches NOTHING.
 *
 * This is the whole reason the original bug was invisible to a status-literal
 * scan. `auto-release-payment` does name `in_progress`, but it also requires
 * `poster_completed_at <= cutoff OR helper_completed_at <= cutoff`, and in SQL
 * `NULL <= anything` is NULL — the row is excluded whatever the cutoff is. So
 * these evaluate FALSE on a null column even when the comparand is a runtime
 * value the extractor cannot see.
 */
const nullNeverMatches = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "contains"]);

function compare(op: string, sv: string | number | boolean | null, value: Value): Verdict {
  if (op === "is") {
    if (value === null) return sv === null;
    if (value === true || value === false) return sv === value;
    return "unknown";
  }
  // NULL semantics first — they do not depend on the comparand.
  if (sv === null) return nullNeverMatches.has(op) ? false : "unknown";
  if (value === UNKNOWN) return "unknown";
  switch (op) {
    case "eq": return sv === value;
    case "neq": return sv !== value;
    case "in": return Array.isArray(value) ? value.includes(sv as string) : "unknown";
    case "lt": case "lte": case "gt": case "gte": {
      if (typeof value !== "string" && typeof value !== "number") return "unknown";
      const a = String(sv), b = String(value);
      return op === "lt" ? a < b : op === "lte" ? a <= b : op === "gt" ? a > b : a >= b;
    }
    default: return "unknown";
  }
}

/** Split a PostgREST filter string on commas that are not inside parentheses. */
function splitTerms(s: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out.map((t) => t.trim()).filter(Boolean);
}

/** Evaluate one PostgREST filter term (`col.op.value`, `and(...)`, `or(...)`). */
function evalTerm(term: string, shape: Shape): Verdict {
  const group = /^(and|or)\((.*)\)$/s.exec(term);
  if (group) {
    const parts = splitTerms(group[2]).map((t) => evalTerm(t, shape));
    if (group[1] === "and") {
      if (parts.some((p) => p === false)) return false;
      return parts.every((p) => p === true) ? true : "unknown";
    }
    if (parts.some((p) => p === true)) return true;
    return parts.every((p) => p === false) ? false : "unknown";
  }
  const bits = term.split(".");
  if (bits.length < 3) return "unknown";
  const column = bits[0];
  let negated = false;
  let i = 1;
  if (bits[i] === "not") { negated = true; i++; }
  const op = bits[i];
  const raw = bits.slice(i + 1).join(".");
  if (!(column in shape)) return "unknown";
  const value: Value = raw === "null" ? null : raw.includes(" ") ? UNKNOWN : raw;
  const v = compare(op, shape[column], value);
  if (v === "unknown") return "unknown";
  if (shape[column] === null && op !== "is") return false; // NOT NULL is still NULL
  return negated ? !v : v;
}

/** Does this chain's WHERE clause admit this job? */
export function chainMatches(chain: Chain, shape: Shape): Verdict {
  let anyUnknown = false;
  for (const p of chain.preds) {
    const v = p.kind === "or" ? evalOr(p.text, shape) : evalCmp(p, shape);
    if (v === false) return false;
    if (v === "unknown") anyUnknown = true;
  }
  return anyUnknown ? "unknown" : true;
}

function evalOr(text: string, shape: Shape): Verdict {
  const parts = splitTerms(text).map((t) => evalTerm(t, shape));
  if (parts.some((p) => p === true)) return true;
  return parts.every((p) => p === false) ? false : "unknown";
}

function evalCmp(p: Extract<Pred, { kind: "cmp" }>, shape: Shape): Verdict {
  if (!(p.column in shape)) return "unknown";
  const v = compare(p.op, shape[p.column], p.value);
  if (v === "unknown") return "unknown";
  if (shape[p.column] === null && p.op !== "is") return false;
  return p.negated ? !v : v;
}

// ───────────────────────────────────────────────────────────────────────────
// 4 — the job shape under test
// ───────────────────────────────────────────────────────────────────────────

/**
 * Source with every comment BLANKED, by a string-aware SCANNER.
 *
 * HOLLOW UNTIL 2026-09-21, and this is hollow shape #1 from the burn-down.
 * This was a line filter — it dropped a line only when the WHOLE line was a
 * comment. So `code; // <the original call>` was returned as "code", and the
 * positive `.toMatch()` assertions below read the comment as the live filter.
 * Proved: replacing arrival-confirm-reminder's real
 *
 *     .eq("is_seed", false)
 * with
 *     .eq("payment_status", "escrow") // .eq("is_seed", false)
 *
 * DELETES that sweep's seed scope — every fixture job starts getting the
 * arrival nudge the owner deliberately kept them out of — and this file passed
 * 9/9. Registered as a @mutate so the comment shape itself is pinned.
 *
 * Blanks rather than deletes, so line numbers survive; leaves `//` inside a
 * string literal alone, which is the other half of the rule.
 */
export function blankComments(s: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < s.length) {
    const c = s[i];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += s[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      out += "  ";
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) {
        out += s[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const PAST_DATE = "2020-01-01";
const PAST_TS = "2020-01-01T12:00:00.000Z";
const UUID = "00000000-0000-0000-0000-000000000001";

/**
 * A FUNDED job, scheduled time long past, on which NEITHER party has taken the
 * next step. This is the shape the owner reported, generalised over statuses:
 * money committed, clock expired, nobody acting.
 *
 * `helper_id` / `customer_id` are populated for every status except `open`,
 * where no Helpr is assigned yet; the arrival stamps are populated from
 * `accepted` onward, because since 20260915044137 a job cannot BE in_progress
 * without them — which is precisely why `arrival-confirm-reminder` (whose
 * predicate is `poster_confirmed_arrival_at IS NULL`) never covered it.
 *
 * `seed` flips `is_seed`. It is a parameter rather than a constant because the
 * eleven rows the owner reported are ALL fixtures: a matrix that only ever asks
 * about `is_seed = false` cannot see whether the sweep written for those rows
 * would actually touch them.
 */
function strandedShape(status: string, seed = false): Shape {
  const assigned = status !== "open" && status !== "pending_approval";
  const started = status === "in_progress" || status === "revision_requested" || status === "disputed";
  return {
    status,
    payment_status: "escrow",
    is_seed: seed,
    date_needed: PAST_DATE,
    created_at: PAST_TS,
    updated_at: PAST_TS,
    expires_at: PAST_TS,
    customer_id: assigned ? UUID : UUID,
    helper_id: assigned ? UUID : null,
    accepted_at: assigned ? PAST_TS : null,
    helper_confirmed_at: assigned ? PAST_TS : null,
    helper_dayof_confirmed_at: assigned ? PAST_TS : null,
    helper_arrived_at: started ? PAST_TS : null,
    helper_arrival_verified_at: started ? PAST_TS : null,
    helper_arrival_near_miss_at: null,
    poster_confirmed_arrival_at: started ? PAST_TS : null,
    poster_confirmed_working_at: started ? PAST_TS : null,
    // THE DEFECT ITSELF: neither side ever said the work was done.
    helper_completed_at: null,
    poster_completed_at: null,
    poster_confirmed_at: null,
    completed_at: null,
    cancelled_at: null,
    removed_at: null,
    disputed_at: status === "disputed" ? PAST_TS : null,
    dispute_resolved_at: null,
    revision_requested_at: status === "revision_requested" ? PAST_TS : null,
    revision_completed_at: null,
    payout_scheduled_at: null,
    direct_offer_expires_at: null,
  };
}

/**
 * Statuses that need no EDGE sweep, each with the reason, and each reason
 * verified against the live database rather than read off a migration.
 *
 * SCOPE, stated so a pass is not over-read. The strong evaluation above covers
 * the HTTP crons — the edge functions pg_cron calls over `net.http_post`. The
 * ~25 pure-SQL crons (`SELECT public.<fn>()`) are not parsed: evaluating a
 * plpgsql WHERE clause would need a SQL engine, and matching on a status
 * LITERAL instead would re-create exactly the blind spot this file exists to
 * remove (`sweep_release_last_chance` names `in_progress` and would have
 * "covered" the owner's bug). So a status whose only path out is a SQL cron is
 * listed here WITH the live check that established it.
 *
 * Anything NOT in this map must be admitted by an edge sweep — so a status
 * invented tomorrow is a failure by default, which is the point of the file.
 */
const NO_EDGE_SWEEP_NEEDED: Record<string, string> = {
  completed:
    "terminal for money — the completion path itself releases the escrow or schedules the payout.",
  cancelled:
    "terminal for money — void-cancelled-payments refunds it and the job is over.",
  pending_approval:
    "awaiting a human by design: the posting is in the admin approval queue and payment_status stays 'unpaid' until it is approved, so no escrow is held.",
  accepted:
    "swept by the SQL cron `auto-start-due-jobs` (*/15, SELECT public.auto_start_due_jobs()), " +
    "verified live with pg_get_functiondef on 2026-09-19: status='accepted' AND helper_id IS NOT NULL " +
    "AND helper_confirmed_at IS NOT NULL AND the local start instant <= now(). " +
    "CAVEAT WORTH KNOWING: that function also carries `> now() - interval '7 days'` as a " +
    "retro-start backstop, so a confirmed accepted job more than 7 days past its start falls out " +
    "of it and is swept by nothing. Narrower than the bug this file was written for (nothing was " +
    "in that state on prod on 2026-09-19) but the same class, and reported with this lane.",
};

// ───────────────────────────────────────────────────────────────────────────
// the checks
// ───────────────────────────────────────────────────────────────────────────

const sweepNames = scheduledSweepNames();
const sweepChains: Chain[] = sweepNames.flatMap((name) => {
  const dir = path.join(FUNCTIONS_DIR, name);
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(e.name)) files.push(p);
    }
  };
  walk(dir);
  return files.flatMap((f) => extractJobChains(f, fs.readFileSync(f, "utf8")));
});

/**
 * Does this chain say anything POSITIVE about the job's status?
 *
 * A sweep that reads `jobs` without constraining `status` at all is not a path
 * out of any particular state — `money-reconciliation` and
 * `charge-recurring-visits` both do that, and counting them would have made
 * every status look covered forever, including the one the owner reported.
 * A sweep covers status S only when it explicitly ADMITS S.
 */
function admitsStatus(chain: Chain, shape: Shape): boolean {
  for (const p of chain.preds) {
    if (p.kind === "cmp" && p.column === "status") {
      if (evalCmp(p, shape) === true) return true;
    }
    if (p.kind === "or" && /(^|[(,])status\./.test(p.text) && evalOr(p.text, shape) === true) {
      return true;
    }
  }
  return false;
}

/** Which scheduled sweeps admit this stranded job. */
function sweepsCovering(status: string, chains = sweepChains, seed = false): string[] {
  const shape = strandedShape(status, seed);
  return chains
    .filter((c) => chainMatches(c, shape) !== false && admitsStatus(c, shape))
    .map((c) => `${c.file}:${c.line}`);
}

describe("escrow sweep coverage — no job state may hold escrow with no scheduled path out", () => {
  it("inventories the sweeps and their job queries from source (a broken extractor must not pass vacuously)", () => {
    expect(sweepNames).toContain("auto-expire-jobs");
    expect(sweepNames).toContain("auto-release-payment");
    expect(sweepNames.length).toBeGreaterThan(8);
    expect(sweepChains.length).toBeGreaterThan(5);
    // The predicate that made the original bug invisible to a literal scan must
    // actually be in the extracted chains.
    const arc = sweepChains.filter((c) => c.file.includes("auto-release-payment"));
    expect(arc.length).toBeGreaterThan(0);
    expect(arc.some((c) => c.preds.some((p) => p.kind === "or" && p.text.includes("completed_at")))).toBe(true);
  });

  it("reads the status inventory from the generated enum, not from a list in this file", () => {
    expect(JOB_STATUSES.length).toBeGreaterThanOrEqual(8);
    expect(JOB_STATUSES).toContain("in_progress");
    // The exemptions can only name statuses that exist.
    for (const s of Object.keys(NO_EDGE_SWEEP_NEEDED)) expect(JOB_STATUSES).toContain(s);
  });

  it("every job status that can hold escrow is admitted by at least one scheduled sweep", () => {
    const uncovered = JOB_STATUSES.filter(
      (s) => !(s in NO_EDGE_SWEEP_NEEDED) && sweepsCovering(s).length === 0,
    );
    expect(
      uncovered,
      "these statuses can hold escrow with no scheduled sweep able to match them — " +
        "either give them a sweep or document why they need none in NO_EDGE_SWEEP_NEEDED",
    ).toEqual([]);
  });

  it("in_progress with neither completion stamp is covered — the owner's 2026-09-19 report", () => {
    const covering = sweepsCovering("in_progress");
    expect(covering.length).toBeGreaterThan(0);
    expect(covering.join(" ")).toContain("stalled-completion-reminder");
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────
   * SEED ROWS ARE SWEPT (owner, 2026-09-19, pop-up, verbatim: "Sweep
   * everything, fixtures included.")
   * ─────────────────────────────────────────────────────────────────────────
   *
   * The sweep shipped scoped to `is_seed = false`, following
   * arrival-confirm-reminder and money-reconciliation. That made it a fix
   * nothing on prod could exercise: all eleven rows in the trap are fixtures
   * (verified live on fncmgoasalhdgfwzhsqa, 2026-09-19 — 11 matching rows, 11
   * of them `is_seed = true`, 0 real). The owner was shown the cost — a fake
   * job reaching the admin queue — and took it.
   */
  it("a SEED job in the same trap is swept too — the owner's 2026-09-19 decision", () => {
    const covering = sweepsCovering("in_progress", sweepChains, true);
    expect(
      covering.join(" "),
      "a fixture job stuck in_progress with escrow held must be nudged and escalated like any other",
    ).toContain("stalled-completion-reminder");
    // Seed and real must be covered by exactly the same sweeps: the point is
    // that this path has no seed notion at all, not that seed has its own one.
    expect(covering).toEqual(sweepsCovering("in_progress", sweepChains, false));
  });

  it("RED before that decision: an is_seed=false conjunct strands the fixture again", () => {
    // The pre-decision world, reconstructed by putting the filter back on this
    // lane's own chains — the literal line that was deleted from the source.
    const scoped = sweepChains.map((c) =>
      c.file.includes("stalled-completion-reminder")
        ? {
            ...c,
            preds: [
              ...c.preds,
              { kind: "cmp" as const, column: "is_seed", op: "eq", value: false, negated: false },
            ],
          }
        : c,
    );
    expect(sweepsCovering("in_progress", scoped, true)).toEqual([]);
    // …and the reconstruction is exact rather than a chain that stopped
    // matching anything: the same world still covers a non-seed job.
    expect(sweepsCovering("in_progress", scoped, false).join(" ")).toContain(
      "stalled-completion-reminder",
    );
  });

  it("the comment stripper blanks a TRAILING comment, and leaves `//` inside a string alone", () => {
    // The shape that made the assertion below hollow: real call replaced,
    // original kept as a trailing comment on a line that still carries code.
    expect(blankComments('.eq("payment_status", "escrow") // .eq("is_seed", false)')).not.toMatch(
      /\.eq\(\s*["']is_seed["']\s*,\s*false\s*\)/,
    );
    expect(blankComments('.eq("is_seed", false) // keep')).toMatch(
      /\.eq\(\s*["']is_seed["']\s*,\s*false\s*\)/,
    );
    // Block comments too, and line numbers are preserved either way.
    expect(blankComments('a(); /* .eq("is_seed", false) */ b();')).not.toMatch(/is_seed/);
    expect(blankComments("a();\n// x\nb();").split("\n")).toHaveLength(3);
    // …and a `//` inside a string literal is NOT a comment.
    expect(blankComments('const u = "https://x.co/is_seed";')).toContain("https://x.co/is_seed");
  });

  it("the other sweeps keep their is_seed scope — the decision was about this sweep only", () => {
    // CODE only. Each of these files EXPLAINS its seed scope (or its lack of
    // one) in a header comment that quotes the very call being asserted, so a
    // raw text match would read a comment as a filter.
    const src = (name: string) =>
      blankComments(fs.readFileSync(path.join(FUNCTIONS_DIR, name, "index.ts"), "utf8"));
    // Untouched: escalating a fixture is acceptable in the stalled-completion
    // queue because a human triages it; silently RECONCILING or nudging one is
    // a different bargain, and the owner did not change it.
    expect(src("arrival-confirm-reminder")).toMatch(/\.eq\(\s*["']is_seed["']\s*,\s*false\s*\)/);
    expect(src("money-reconciliation")).toMatch(/\.eq\(\s*["']is_seed["']\s*,\s*false\s*\)/);
    // And this sweep carries no seed clause anywhere, in any shape.
    expect(src("stalled-completion-reminder")).not.toMatch(/\.eq\(\s*["']is_seed["']/);
    // The shared rule declares no `is_seed` field either — `StalledEvidence` is
    // what the app's card reads, and a seed notion there would put the card and
    // the cron back in disagreement.
    expect(
      blankComments(fs.readFileSync(path.join(FUNCTIONS_DIR, "_shared", "stalledCompletion.ts"), "utf8")),
    ).not.toMatch(/is_seed/);
  });

  it("RED before the fix: with stalled-completion-reminder removed, in_progress is stranded", () => {
    // The pre-fix world, reconstructed by dropping this lane's own sweep.
    const before = sweepChains.filter((c) => !c.file.includes("stalled-completion-reminder"));
    expect(sweepsCovering("in_progress", before)).toEqual([]);
    // …and it is specifically auto-release-payment's completion-stamp conjunct
    // that excludes it, not the absence of the status literal.
    const arp = before.filter((c) => c.file.includes("auto-release-payment"));
    expect(arp.length).toBeGreaterThan(0);
    expect(arp.every((c) => chainMatches(c, strandedShape("in_progress")) === false)).toBe(true);
  });

  it("RED for a status invented tomorrow: a new enum member with no sweep fails", () => {
    const future = "awaiting_materials";
    expect(JOB_STATUSES).not.toContain(future);
    expect(future in NO_EDGE_SWEEP_NEEDED).toBe(false);
    expect(sweepsCovering(future)).toEqual([]);
  });
});

// ─── proven able to fail, 2026-09-21 ───────────────────────────────────────
// (1) Take in_progress off this lane's own sweep and the owner's 2026-09-19
//     trap re-opens — escrow held with no scheduled path out. Red:
//       x in_progress with neither completion stamp is covered …
//       x a SEED job in the same trap is swept too …
//       AssertionError: expected 0 to be greater than 0
// (2) THE HOLLOW ONE. The seed-scope assertion's comment stripper dropped only
//     WHOLE-LINE comments, so deleting arrival-confirm-reminder's real
//     `.eq("is_seed", false)` and leaving it as a TRAILING comment passed 9/9 —
//     every fixture job back in a nudge the owner deliberately kept them out
//     of. `blankComments` is now a string-aware scanner, and the comment SHAPE
//     itself is the second registered mutation, so both shapes are pinned.
// @mutate supabase/functions/stalled-completion-reminder/index.ts | .eq("status", "in_progress") | .eq("status", "accepted")
// @mutate supabase/functions/arrival-confirm-reminder/index.ts | .eq("is_seed", false) | .eq("payment_status", "escrow") // .eq("is_seed", false)
