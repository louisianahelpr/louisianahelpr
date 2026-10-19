/**
 * CLASS GUARD: a scheduled sweep that notifies someone about a job checks the
 * job is still live.
 *
 * THE BUG (owner-reported, measured on prod 2026-10-19 ~02:00Z):
 * sweep_backout_notice_reminders (cron 'backout-notice-reminders', every 15
 * minutes) re-pushed an unacknowledged back-out notice every 2 hours inside 24
 * hours of the start and never read jobs.status. The owner cancelled job
 * 7440a72d and was pushed "Offer expired: ..." 12 more times until its start
 * passed; prod held 74 open notices, all on cancelled jobs. Fixed by
 * 20261019020032_backout_notices_close_on_closed_job.sql (PGlite:
 * src/test/pglite/backoutNoticeClosedJob.pglite.mjs).
 *
 * THE CLASS, from the app's own inventories:
 *   cron functions = every public function a scheduled job's NEWEST command
 *                    calls (helpers/cronWorkRegister.ts jobCommands), plus every
 *                    function those call, transitively (effective definitions,
 *                    helpers/effectiveFunctionDefs.ts);
 *   producers      = functions that write a notifications row
 *                    (helpers/notificationProducers.ts sqlProducers).
 * Every cron function that is a producer AND reads public.jobs must test the
 * job's status in its own body (a `status` comparison or a NOT IN / IN list),
 * or be in NO_STATUS_CHECK with why (two-way). Comments never count.
 *
 * RED on the original bug: with 20261019020032 removed,
 * sweep_backout_notice_reminders is listed (see the last test, which replays
 * the migrations before it).
 *
 * @mutate supabase/migrations/20261019020032_backout_notices_close_on_closed_job.sql | AND public.backout_notice_applies(n.backout_kind, j.status::text) | AND true
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, type FnDef } from "./helpers/effectiveFunctionDefs";
import { jobCommands, jobInventory, type MigrationFile } from "./helpers/cronWorkRegister";

const ROOT = process.cwd();
const MIG = join(ROOT, "supabase", "migrations");
const FIX = "20261019020032_backout_notices_close_on_closed_job.sql";

/**
 * Cron producers that read jobs but need no status test, each with why.
 */
// @two-way src/test/cronJobNotificationsCheckJobStatus.test.ts:listed but now checks status, or no longer a cron producer reading jobs
const NO_STATUS_CHECK: Record<string, string> = {};

const INSERTS_NOTIFICATIONS = /\binsert\s+into\s+(?:public\s*\.\s*)?"?notifications"?\s*\(/i;
const READS_JOBS = /\b(?:from|join|update)\s+(?:public\s*\.\s*)?"?jobs"?\b/i;
/**
 * Rule functions that decide whether a job is still live for a notice, each
 * taking the job's status (or row). A call to one counts as a status test; the
 * test below proves each one reads the status itself.
 */
const JOB_LIVENESS_RULES = ["job_announceable_to", "backout_notice_applies"];
const SQL_WORDS = new Set(["where", "on", "join", "left", "right", "inner", "cross", "for", "using", "set", "order", "group", "limit", "returning", "union", "and", "or", "natural", "full"]);

/** Names the body binds to a jobs row: `jobs j`, `jobs AS j`, `INTO v_job FROM jobs`, `v public.jobs%ROWTYPE`, `jobs`. */
function jobAliases(body: string): Set<string> {
  const out = new Set(["jobs"]);
  for (const m of body.matchAll(/\b(?:from|join|update)\s+(?:public\s*\.\s*)?"?jobs"?\s+(?:as\s+)?(\w+)/gi))
    if (!SQL_WORDS.has(m[1].toLowerCase())) out.add(m[1].toLowerCase());
  for (const m of body.matchAll(/\binto\s+(\w+)\s+from\s+(?:public\s*\.\s*)?"?jobs"?\b/gi)) out.add(m[1].toLowerCase());
  for (const m of body.matchAll(/\b(\w+)\s+(?:public\s*\.\s*)?jobs\s*%\s*rowtype\b/gi)) out.add(m[1].toLowerCase());
  return out;
}

/** The body tests a JOB's status: `<job alias>.status` compared or passed on, or a liveness rule called. */
function checksJobStatus(body: string): boolean {
  if (JOB_LIVENESS_RULES.some((fn) => new RegExp(`\\b${fn}\\s*\\(`, "i").test(body))) return true;
  for (const alias of jobAliases(body)) {
    const re = new RegExp(
      `\\b${alias}\\s*\\.\\s*status\\b\\s*(?:::\\s*\\w+\\s*)?(?:=|<>|!=|\\bin\\b|\\bnot\\s+in\\b|\\bis\\s+(?:not\\s+)?distinct\\b|[,)])`,
      "i",
    );
    if (re.test(body)) return true;
  }
  return false;
}

function load(before?: string): MigrationFile[] {
  return readdirSync(MIG)
    .filter((f) => f.endsWith(".sql") && (!before || f < before))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIG, file), "utf8") }));
}

/** The body between the function's dollar-quote tags, comments blanked. */
function bodyOf(def: FnDef): string {
  const code = blankSqlComments(def.stmt);
  const m = /\bas\s+(\$[A-Za-z_]*\$)([\s\S]*)\1/i.exec(code);
  return m ? m[2] : code;
}

function cronFunctions(files: MigrationFile[], defs: Map<string, FnDef>): Map<string, string> {
  const scheduled = new Set([...jobInventory(files)].filter(([, k]) => k === "scheduled").map(([n]) => n));
  const reachedFrom = new Map<string, string>();
  const queue: string[] = [];
  for (const [job, { command }] of jobCommands(files)) {
    if (!scheduled.has(job)) continue;
    for (const m of blankSqlComments(command).matchAll(/\b(?:public\s*\.\s*)?(\w+)\s*\(/gi)) {
      const fn = m[1].toLowerCase();
      if (defs.has(fn) && !reachedFrom.has(fn)) {
        reachedFrom.set(fn, job);
        queue.push(fn);
      }
    }
  }
  while (queue.length) {
    const fn = queue.shift()!;
    for (const m of bodyOf(defs.get(fn)!).matchAll(/\b(?:public\s*\.\s*)?(\w+)\s*\(/gi)) {
      const callee = m[1].toLowerCase();
      if (defs.has(callee) && !reachedFrom.has(callee)) {
        reachedFrom.set(callee, reachedFrom.get(fn)!);
        queue.push(callee);
      }
    }
  }
  return reachedFrom;
}

function inventory(before?: string) {
  const files = load(before);
  const defs = effectiveDefs(MIG, before ? { before } : {});
  const cron = cronFunctions(files, defs);
  const producers = [...cron.keys()].filter((fn) => {
    const body = bodyOf(defs.get(fn)!);
    return INSERTS_NOTIFICATIONS.test(body) && READS_JOBS.test(body);
  });
  const unchecked = producers.filter((fn) => !checksJobStatus(bodyOf(defs.get(fn)!))).sort();
  return { cron, producers: producers.sort(), unchecked, defs };
}

const now = inventory();

describe("a cron sweep that notifies about a job checks the job is still live", () => {
  it("the inventory is real (cron functions, and producers among them that read jobs)", () => {
    expect(now.cron.size).toBeGreaterThan(40);
    expect(now.producers.length).toBeGreaterThan(5);
    expect(now.producers).toContain("sweep_backout_notice_reminders");
  });

  it("every cron producer that reads jobs tests the job's status (or is listed with why)", () => {
    const offenders = now.unchecked.filter((fn) => !(fn in NO_STATUS_CHECK));
    expect(offenders, offenders.map((fn) => `${fn} (cron '${now.cron.get(fn)}')`).join("\n")).toEqual([]);
  });

  it("each liveness rule reads the job's status itself", () => {
    expect(JOB_LIVENESS_RULES.length).toBeGreaterThan(1);
    for (const fn of JOB_LIVENESS_RULES) {
      const def = now.defs.get(fn);
      expect(def, `${fn} is not defined by any migration`).toBeDefined();
      expect(bodyOf(def!), `${fn} never reads a status`).toMatch(/status/i);
    }
  });

  it("NO_STATUS_CHECK is two-way: every entry is still an unchecked cron producer", () => {
    const stale = Object.keys(NO_STATUS_CHECK).filter((fn) => !now.unchecked.includes(fn));
    expect(stale).toEqual([]);
  });

  it("RED on the original bug: before the fix, the back-out reminder sweep is caught", () => {
    const before = inventory(FIX);
    expect(before.unchecked).toContain("sweep_backout_notice_reminders");
    expect(now.unchecked).not.toContain("sweep_backout_notice_reminders");
  });
});
