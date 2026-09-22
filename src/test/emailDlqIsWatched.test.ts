/**
 * An email dead-letter queue can never accumulate unwatched.
 *
 * ── The bug this class check exists for (measured on prod 2026-09-22) ───────
 * `process-email-queue` moves a permanently-failed message into
 * `pgmq.q_<queue>_dlq` and nothing anywhere read those tables: `_dlq` occurred
 * in exactly ONE file in the repo, the edge function that WRITES it. No cron,
 * no alert, no test. Live at the time: `auth_emails_dlq` held a password-reset
 * from 2026-09-12 and `transactional_emails_dlq` held 50 notifications from
 * 09-13, while every other email signal read healthy (140 sent / 0 failed).
 *
 * Email confirmation is the only gate between signup and account access
 * (`ProtectedRoute.tsx` blocks on `email_confirmed_at`), so an auth message
 * dying in a DLQ is a person permanently locked out with nobody told.
 *
 * ── What this guards, as a class ───────────────────────────────────────────
 * Not "the 2026-09-22 DLQs are watched" — that is a list checked against
 * itself. The inventory is read out of the edge function that CREATES DLQ
 * names (`for (const queue of [...])` + `` `${queue}_dlq` ``), and every name
 * it can produce must be watched by `sweep_email_dlqs()`. Add a third email
 * queue tomorrow and this fails until its DLQ is watched too.
 *
 * It also checks the three things that decide whether "watched" means
 * anything: the auth DLQ's severity must be one `trg_error_logs_slack`
 * actually pages on, every severity must be storable under the error_logs
 * CHECK, and the sweep must dedupe on the backlog's identity rather than write
 * a fresh row every run (the 616-row loop of 2026-09-14).
 *
 * RED proof: see the two @mutate registrations below — dropping the auth queue
 * from the watched list fails "every DLQ ... is watched", and downgrading its
 * severity to 'error' fails "the auth DLQ is graded at a severity that pages".
 */
// @mutate supabase/migrations/20260922155258_email_dlq_alerting.sql | 'dlq', 'auth_emails_dlq', | 'dlq', 'auth_emails_dlq_unwatched',
// @mutate supabase/migrations/20260922155258_email_dlq_alerting.sql | 'severity', 'fatal', | 'severity', 'error',
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const FUNCTIONS = join(ROOT, "supabase", "functions");

/** error_logs.severity CHECK, verified live on prod 2026-09-22. */
const STORABLE_SEVERITIES = ["info", "warning", "error", "fatal"];

function migrationFiles(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS, file), "utf8") }));
}

/** The latest migration that defines a given function, i.e. the live body. */
function latestDefining(needle: string): { file: string; sql: string } {
  const hit = migrationFiles().filter((f) => f.sql.includes(needle)).pop();
  if (!hit) throw new Error(`No migration defines ${needle}`);
  return hit;
}

/**
 * INVENTORY, from the app's own source: every DLQ name `process-email-queue`
 * can construct. It builds them as `${queue}_dlq` over a literal queue list, so
 * the list is the inventory. Deliberately NOT read from the migration it is
 * compared against.
 */
export function dlqsTheAppCanWrite(src: string): string[] {
  const loop = /for\s*\(\s*const\s+queue\s+of\s*\[([^\]]+)\]\s*\)/.exec(src);
  if (!loop) throw new Error("process-email-queue no longer loops over a literal queue list — re-derive the DLQ inventory");
  const suffix = /const\s+dlq\s*=\s*`\$\{queue\}(_[a-z]+)`/.exec(src);
  if (!suffix) throw new Error("process-email-queue no longer derives its DLQ name as `${queue}<suffix>` — re-derive the inventory");
  return [...loop[1].matchAll(/['"]([a-z0-9_]+)['"]/gi)].map((m) => m[1] + suffix[1]);
}

/** The DLQs `sweep_email_dlqs()` watches, and the severity each is graded at. */
export function watchedDlqs(sql: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of sql.matchAll(
    /'dlq',\s*'([a-z0-9_]+)',[\s\S]{0,200}?'severity',\s*'([a-z]+)'/gi,
  )) {
    out.set(m[1], m[2]);
  }
  return out;
}

describe("email dead-letter queues are watched", () => {
  const emailQueueSrc = readFileSync(join(FUNCTIONS, "process-email-queue", "index.ts"), "utf8");
  const sweep = latestDefining("FUNCTION public.sweep_email_dlqs()");

  it("the inventory is read from the edge function, not from a list", () => {
    const inventory = dlqsTheAppCanWrite(emailQueueSrc);
    expect(inventory.length).toBeGreaterThan(1);
    expect(inventory).toContain("auth_emails_dlq");
    // Nothing else in the codebase invents a DLQ name, so this loop really is
    // the whole inventory. If that changes, the inventory above is incomplete.
    const otherWriters = readdirSync(FUNCTIONS, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "process-email-queue")
      .filter((d) => {
        try {
          return readFileSync(join(FUNCTIONS, d.name, "index.ts"), "utf8").includes("_dlq");
        } catch {
          return false;
        }
      })
      .map((d) => d.name);
    expect(otherWriters).toEqual([]);
  });

  it("every DLQ the app can write to is watched by a sweep that alerts", () => {
    const watched = watchedDlqs(sweep.sql);
    const unwatched = dlqsTheAppCanWrite(emailQueueSrc).filter((q) => !watched.has(q));
    expect(unwatched).toEqual([]);
  });

  it("the auth DLQ is graded at a severity that actually pages", () => {
    // `notify_slack_on_error_log()` posts a server-written row only for
    // severity = 'fatal' or a source on its money/security allow-list. A
    // severity outside that is counted, not posted — so grading the auth queue
    // below it would be a watch that never wakes anybody.
    const trigger = latestDefining("FUNCTION public.notify_slack_on_error_log()");
    const pagingSeverity = /NEW\.severity\s*=\s*'([a-z]+)'/.exec(trigger.sql)?.[1];
    expect(pagingSeverity).toBe("fatal");
    expect(watchedDlqs(sweep.sql).get("auth_emails_dlq")).toBe(pagingSeverity);
  });

  it("every severity the sweep writes is storable under the error_logs CHECK", () => {
    for (const [queue, severity] of watchedDlqs(sweep.sql)) {
      expect(STORABLE_SEVERITIES, `${queue} is graded '${severity}'`).toContain(severity);
    }
  });

  it("the sweep cannot loop: it dedupes on the backlog's identity, not a clock", () => {
    // pgmq msg_ids are monotonic and never reused, so a high-water mark reports
    // a stuck message once and a new one always. A `created_at > ...` window
    // would either re-page forever or go quiet on a real new failure.
    expect(sweep.sql).toMatch(/high_water_msg_id/);
    expect(sweep.sql).toMatch(/v_last_id\s*>=\s*v_max_id/);
    expect(sweep.sql).not.toMatch(/created_at\s*>\s*date_trunc/);
  });

  it("the sweep is scheduled and is itself watched for liveness", () => {
    const all = migrationFiles().map((f) => f.sql).join("\n");
    expect(all).toMatch(/cron\.schedule\(\s*'sweep-email-dlqs'/);
    expect(all).toMatch(/\('sweep-email-dlqs',\s*interval '1 hour'\)/);
  });
});
