// @mutate supabase/migrations/20260923034829_notification_links_die_with_their_job.sql | AFTER DELETE ON public.jobs | AFTER UPDATE ON public.jobs
/**
 * A LINK THE READER CAN TAP MUST NOT OUTLIVE THE JOB IT NAMES — the class
 * guard for "tapped a notification, landed on a job that is gone".
 *
 * The original (press-every-control run 35805671843, issue #1582): the helper
 * persona pressed a row in the dashboard notification panel and got "We can't
 * open this job right now — it may have been filled or taken down. If you just
 * got the alert, try again in a few minutes." Measured on prod 2026-09-22: the
 * helper's row `link = '/jobs/5eed0b10-0000-4000-8000-000000000005'` names a
 * job id with NO row in public.jobs, and 138 of 1,744 notifications were in
 * the same state (/messages?jobId= 80, /my-posts?job= 47, /dashboard?job= 4,
 * /jobs/ 4, /my-jobs?job= 3).
 *
 * The layer: notifications.job_id is ON DELETE SET NULL, and a row with no
 * job_id falls back to its `link` string (notificationDestination.ts). Nothing
 * cleared the string, so deleting a job left every notification about it
 * holding a tap target into nothing. Only the database knows the moment a job
 * goes, so the fix is a trigger: 20260923034829_notification_links_die_with_their_job.sql.
 *
 * ── The inventory ──────────────────────────────────────────────────────────
 * Every table that (a) the migrations give a `link` column and (b) the client
 * reads with `.from("<table>")` is a rendered tap target. Each must have its
 * `link` nulled by an AFTER DELETE trigger on public.jobs, matching the job id
 * ANYWHERE in the string — a list of URL shapes is how the earlier sweeps
 * (20260831232514, 20260901021929) each missed a producer.
 *
 * Derived from the migrations and src/, not a hand list; a new rendered table
 * with a `link` column fails here until its links die with their job.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const MIG_DIR = join(ROOT, "supabase", "migrations");
const SRC = join(ROOT, "src");

type Mig = { name: string; sql: string };

const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "");

function migrations(): Mig[] {
  return readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: stripComments(readFileSync(join(MIG_DIR, name), "utf8")) }));
}

function srcText(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === "test" || e === "node_modules" || e === "integrations") continue;
      srcText(p, acc);
    } else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.(ts|tsx)$/.test(e)) {
      acc.push(readFileSync(p, "utf8"));
    }
  }
  return acc;
}

/** Tables the migrations give a `link` column. */
function tablesWithLink(migs: Mig[]): Set<string> {
  const out = new Set<string>();
  for (const { sql } of migs) {
    for (const m of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\s*\);/gi)) {
      if (/^\s*link\s+text\b/im.test(m[2])) out.add(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?(\w+)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?link\s+text/gi)) {
      out.add(m[1].toLowerCase());
    }
  }
  return out;
}

/**
 * For each table, is its `link` nulled when a job is deleted? Walks migrations
 * in order so a later DROP TRIGGER / redefinition is honoured.
 */
function unlinkedOnJobDelete(migs: Mig[]): Map<string, string> {
  const fnBody = new Map<string, string>(); // function name -> latest body
  const triggers = new Map<string, string>(); // trigger name -> function name (AFTER DELETE ON jobs)
  for (const { sql } of migs) {
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\([^)]*\)[\s\S]*?AS\s+(\$\w*\$)([\s\S]*?)\2/gi)) {
      fnBody.set(m[1].toLowerCase(), m[3]);
    }
    for (const m of sql.matchAll(/DROP TRIGGER\s+(?:IF EXISTS\s+)?(\w+)\s+ON\s+(?:public\.)?jobs\b/gi)) {
      triggers.delete(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(\w+)\s+AFTER\s+DELETE\s+ON\s+(?:public\.)?jobs\b[\s\S]*?EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?(\w+)\s*\(/gi)) {
      triggers.set(m[1].toLowerCase(), m[2].toLowerCase());
    }
  }
  const covered = new Map<string, string>(); // table -> trigger
  for (const [trg, fn] of triggers) {
    const body = fnBody.get(fn) ?? "";
    for (const m of body.matchAll(/UPDATE\s+(?:public\.)?(\w+)[\s\S]*?SET\s+link\s*=\s*NULL([\s\S]*?);/gi)) {
      const where = m[2];
      // Shape-agnostic: the deleted id anywhere in the link, not a URL regex.
      const anywhere = /strpos\s*\(\s*lower\s*\(\s*\w+\.link\s*\)\s*,\s*\w+\.id::text\s*\)\s*>\s*0/i.test(where)
        || /position\s*\(\s*\w+\.id::text\s+in\s+lower\s*\(\s*\w+\.link\s*\)\s*\)\s*>\s*0/i.test(where);
      if (anywhere) covered.set(m[1].toLowerCase(), trg);
    }
  }
  return covered;
}

function rendered(tables: Set<string>): string[] {
  const src = srcText(SRC).join("\n");
  return [...tables].filter((t) => new RegExp(`\\.from\\(\\s*["'\`]${t}["'\`]`).test(src)).sort();
}

describe("a notification link dies with the job it names", () => {
  const migs = migrations();
  const inventory = rendered(tablesWithLink(migs));

  it("the inventory is real: notifications is a rendered link table", () => {
    expect(migs.length, "read no migrations").toBeGreaterThan(500);
    expect(inventory).toContain("notifications");
    // notification_dedupe_suppressions has a link column but is an audit log
    // the client never reads — the inventory must not need a hand exclusion.
    expect(inventory).not.toContain("notification_dedupe_suppressions");
  });

  it("every rendered link table has its links nulled on job DELETE, matched by id anywhere", () => {
    const covered = unlinkedOnJobDelete(migs);
    const missing = inventory.filter((t) => !covered.has(t));
    expect(missing, "add an AFTER DELETE ON public.jobs trigger that nulls <table>.link where it names the deleted job").toEqual([]);
  });

  it("the check can fail: without 20260923034829 notifications is uncovered (the original bug)", () => {
    const before = migs.filter((m) => m.name < "20260923034829");
    expect(unlinkedOnJobDelete(before).has("notifications")).toBe(false);
  });

  it("a shape-list matcher does not count as coverage", () => {
    const fake: Mig[] = [{
      name: "x.sql",
      sql: `CREATE OR REPLACE FUNCTION public.f() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
              UPDATE public.notifications n SET link = NULL FROM gone g WHERE n.link = '/jobs/' || g.id::text;
              RETURN NULL; END $$;
            CREATE TRIGGER t AFTER DELETE ON public.jobs REFERENCING OLD TABLE AS gone FOR EACH STATEMENT EXECUTE FUNCTION public.f();`,
    }];
    expect(unlinkedOnJobDelete(fake).has("notifications")).toBe(false);
  });
});
