/*
 * "Does this code test the job's state?" — shared by the job-status class
 * guard (src/test/cronJobNotificationsCheckJobStatus.test.ts): its SQL half
 * (cron sweeps that notify about a job) and its edge half (edge-function crons
 * that notify, email or charge about a job).
 *
 * Every reader takes comment-blanked code: SQL through blankSqlComments (via
 * sqlBody), TypeScript through blankComments. A name in a comment never counts.
 */
import { bodyOf } from "./migrationTriggers";
import type { FnDef } from "./effectiveFunctionDefs";

/**
 * Rule functions that decide whether a job is still live for a notice, each
 * taking the job's status (or row). A call to one counts as a status test; the
 * guard proves each one reads the status itself.
 */
export const JOB_LIVENESS_RULES = ["job_announceable_to", "backout_notice_applies"];

/**
 * Rule functions that decide whether a job's PAYMENT is still held or paid out
 * (not refunded, charged back or closed with no payment). A call to one counts
 * as a payment-state test; the guard proves each reads payment_status itself.
 */
export const JOB_PAYMENT_RULES = ["job_payment_is_funded"];

export const READS_JOBS_SQL = /\b(?:from|join|update)\s+(?:public\s*\.\s*)?"?jobs"?\b/i;

const SQL_WORDS = new Set(["where", "on", "join", "left", "right", "inner", "cross", "for", "using", "set", "order", "group", "limit", "returning", "union", "and", "or", "natural", "full"]);

/** The body between the function's dollar-quote tags, comments blanked (migrationTriggers' bodyOf, any tag). */
export function sqlBody(def: FnDef): string {
  return bodyOf(def.stmt);
}

/** Names the body binds to a jobs row: `jobs j`, `jobs AS j`, `INTO v_job FROM jobs`, `v public.jobs%ROWTYPE`, `jobs`. */
export function jobAliases(body: string): Set<string> {
  const out = new Set(["jobs"]);
  for (const m of body.matchAll(/\b(?:from|join|update)\s+(?:public\s*\.\s*)?"?jobs"?\s+(?:as\s+)?(\w+)/gi))
    if (!SQL_WORDS.has(m[1].toLowerCase())) out.add(m[1].toLowerCase());
  for (const m of body.matchAll(/\binto\s+(\w+)\s+from\s+(?:public\s*\.\s*)?"?jobs"?\b/gi)) out.add(m[1].toLowerCase());
  for (const m of body.matchAll(/\b(\w+)\s+(?:public\s*\.\s*)?jobs\s*%\s*rowtype\b/gi)) out.add(m[1].toLowerCase());
  return out;
}

/** `<job alias>.<column>` compared or passed on (`=`, `<>`, `IN`, `IS DISTINCT`, an argument; `IS NULL` / `IS TRUE` too when asked). */
function testsJobColumn(body: string, column: string, isNullOrBool = false): boolean {
  const isWords = isNullOrBool ? "(?:distinct|null|true|false)" : "distinct";
  for (const alias of jobAliases(body)) {
    const re = new RegExp(
      `\\b${alias}\\s*\\.\\s*${column}\\b\\s*(?:::\\s*\\w+\\s*)?(?:=|<>|!=|\\bin\\b|\\bnot\\s+in\\b|\\bis\\s+(?:not\\s+)?${isWords}\\b|[,)])`,
      "i",
    );
    if (re.test(body)) return true;
  }
  return false;
}

/** The body tests a JOB's status: `<job alias>.status` compared or passed on, or a liveness rule called. */
export function checksJobStatus(body: string): boolean {
  if (JOB_LIVENESS_RULES.some((fn) => new RegExp(`\\b${fn}\\s*\\(`, "i").test(body))) return true;
  return testsJobColumn(body, "status");
}

/** The body tests a JOB's payment state: `<job alias>.payment_status` compared or passed on, or a payment rule called. */
export function checksJobPayment(body: string): boolean {
  if (JOB_PAYMENT_RULES.some((fn) => new RegExp(`\\b${fn}\\s*\\(`, "i").test(body))) return true;
  return testsJobColumn(body, "payment_status");
}

/** The body tests a JOB's dispute markers: `<job alias>.dispute_status` or `.has_active_dispute`. */
export function checksJobDispute(body: string): boolean {
  return testsJobColumn(body, "dispute_status", true) || testsJobColumn(body, "has_active_dispute", true);
}

/**
 * Every public function `names` call, transitively, that `defs` defines (the
 * names included). The same walk as rpcErrorInventory's codesReachableFrom, over
 * effectiveDefs (FnDef) instead of latestFunctionDefs, returning the functions
 * rather than the codes they raise.
 */
export function sqlCallClosure(names: Iterable<string>, defs: Map<string, FnDef>): Set<string> {
  const seen = new Set<string>();
  const queue = [...names].filter((n) => defs.has(n));
  for (const n of queue) seen.add(n);
  while (queue.length) {
    const fn = queue.shift()!;
    for (const m of sqlBody(defs.get(fn)!).matchAll(/\b(?:public\s*\.\s*)?(\w+)\s*\(/gi)) {
      const callee = m[1].toLowerCase();
      if (defs.has(callee) && !seen.has(callee)) {
        seen.add(callee);
        queue.push(callee);
      }
    }
  }
  return seen;
}
