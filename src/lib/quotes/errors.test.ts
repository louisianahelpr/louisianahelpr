import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "../../test/helpers/blankNonCode";
import { latestFunctionDefs } from "../../test/helpers/rpcErrorInventory";
import { quoteErrorMessage } from "./errors";

/**
 * Q1875: EVERY REFUSAL A JOBS INSERT TRIGGER CAN GIVE A QUOTE BOOKING HAS WORDS.
 *
 * book_accepted_quote and switch_quote_request_to_set_price create the job
 * through quote_insert_job, so every jobs BEFORE INSERT trigger runs on them.
 * The budget range, the 5-open-jobs limit and the email gate came back as
 * "Something went wrong" (lh-money-escrow review, nit 5).
 *
 * Inventory from the migrations (newest definition of each trigger and
 * function, any dollar tag, comments blanked): every BEFORE INSERT trigger on
 * public.jobs, and every RAISE EXCEPTION literal its function can give. Each
 * one must read as its own sentence through quoteErrorMessage, or its function
 * must be in NOT_FROM_QUOTE_INSERT naming the jobs columns its raises depend
 * on, and quote_insert_job's INSERT must not write any of them.
 *
 * @mutate src/lib/quotes/errors.ts |   for (const r of JOB_INSERT_REFUSAL_COPY) if (r.match.test(code)) return r.copy; |   void JOB_INSERT_REFUSAL_COPY;
 * The open-jobs limit below is the trigger's own text as of 2026-10-17.
 * @mutate src/lib/quotes/errors.ts |   { match: /maximum of 5 open jobs at a time/, | { match: /maximum of 6 open jobs at a time/,
 * @mutate src/lib/quotes/errors.ts |   { match: /^Minimum budget is \$/, | { match: /^Minimum price is \$/,
 * An UPDATE-only refusal stays out of reach only while its INSERT branch returns first.
 * @mutate supabase/migrations/20261021111723_open_job_edit_tells_applicants.sql |   IF TG_OP = 'INSERT' THEN | IF TG_OP = 'NEVER' THEN
 */

const MIGRATIONS = resolve(__dirname, "../../../supabase/migrations");
const GENERIC = "Couldn't do that just now. Check your connection and try again.";

/** Trigger functions whose raises quote_insert_job cannot reach, and the jobs columns those raises depend on. */
const NOT_FROM_QUOTE_INSERT: Record<string, { columns: string[]; reason: string }> = {
  enforce_helper_award_gate: { columns: ["helper_id", "helper_confirmed_at"], reason: "raises only on an UPDATE or when helper_confirmed_at is set (an award)" },
  enforce_job_funded_before_award: { columns: ["helper_id", "helper_confirmed_at"], reason: "raises only when helper_id or helper_confirmed_at is set (an award)" },
  enforce_group_job_has_no_lead: { columns: ["helper_id", "is_group_job", "helpers_needed"], reason: "raises on a group job with a helper_id, or on an UPDATE of the crew shape" },
  jobs_instant_book_server_only: { columns: ["instant_booked_at", "instant_decline_until"], reason: "CMP-4 (20261101065105): an INSERT raises only when the client writes an instant-book stamp" },
  enforce_jobs_fee_model_lock: { columns: ["helper_fee_flat_cents"], reason: "raises only when the client writes the fee stamp" },
  enforce_chargeback_due_server_owned: { columns: ["chargeback_evidence_due_by"], reason: "raises only when the client writes the chargeback deadline" },
  enforce_dispute_markers_server_owned: { columns: ["status", "disputed_at", "disputed_by", "dispute_status", "dispute_deadline", "dispute_resolved_at", "dispute_reason", "dispute_helper_response"], reason: "raises only when the client writes a dispute marker" },
  enforce_jobs_dispute_evidence_append_only: { columns: ["dispute_evidence_urls"], reason: "an INSERT has its evidence cleared, never refused; raises only on an UPDATE" },
  enforce_series_columns_client_lock: { columns: ["parent_job_id", "series_ended_on", "recurrence_days", "series_split_ok"], reason: "on an INSERT raises only for parent_job_id / series_ended_on; the rest are UPDATE-only" },
  enforce_series_visit_within_end: { columns: ["parent_job_id", "helper_id"], reason: "returns at once for a job with no parent_job_id" },
  enforce_series_ban_marker_server_owned: { columns: ["series_ban_cancelled_at", "cancellation_reason"], reason: "raises only for the ban path's marker or reserved cancellation reason" },
  enforce_onboarding_fee_server_owned: { columns: ["onboarding_fee_amount"], reason: "raises only when the client writes the setup fee" },
  enforce_poster_marked_done_server_owned: { columns: ["poster_marked_done_at"], reason: "an INSERT has it cleared, never refused; raises only on an UPDATE that writes it" },
  enforce_job_completion_server_owned: { columns: ["status", "helper_completed_at"], reason: "raises only when the client writes completion" },
  refuse_under_18_member: { columns: ["helper_id"], reason: "under_18 has words; helper_unavailable is raised only for a helper_id being set" },
  // No column: the raise sits behind TG_OP, not a column the insert could leave empty (checked below).
  jobs_open_edit_tells_applicants: { columns: [], reason: "returns at TG_OP = 'INSERT' before any raise; category_locked_after_applications is raised only on an UPDATE of an existing job's category" },
};

/** Triggers created by EXECUTE format (no literal CREATE TRIGGER): name, function, the migration that attaches them to every table. */
const DYNAMIC_TRIGGERS = [{ fn: "refuse_unconfirmed_email_write", file: "20260927234313_refuse_unconfirmed_email_writes.sql" }];

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
}

/** fn name for every BEFORE INSERT trigger on public.jobs, newest event per trigger name. */
function jobsInsertTriggerFns(): Set<string> {
  const trig = new Map<string, string>();
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+"?(\w+)"?\s+(BEFORE|AFTER)\s+([\s\S]*?)\s+ON\s+(?:"?public"?\.)?"?(\w+)"?[\s\S]*?EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:"?public"?\.)?"?(\w+)"?\s*\(|DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+(?:"?public"?\.)?"?(\w+)"?/gi;
  for (const f of migrationFiles()) {
    const sql = blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"));
    for (const m of sql.matchAll(re)) {
      if (m[1]) {
        if (m[4] !== "jobs") continue;
        if (m[2].toUpperCase() === "BEFORE" && /\bINSERT\b/i.test(m[3])) trig.set(m[1], m[5]);
        else trig.delete(m[1]);
      } else if (m[7] === "jobs") trig.delete(m[6]);
    }
  }
  return new Set(trig.values());
}

/** Every RAISE EXCEPTION literal in a function body; format placeholders filled. */
function raisedMessages(body: string): string[] {
  const out = new Set<string>();
  for (const m of blankSqlComments(body).matchAll(/RAISE\s+EXCEPTION\s+'((?:[^']|'')*)'/gi)) {
    if (m[1] === "%") continue; // re-raises a message built elsewhere (helper_accept_block_reason)
    out.add(m[1].replace(/''/g, "'").replace(/%/g, "x"));
  }
  return [...out];
}

const defs = latestFunctionDefs(MIGRATIONS);
const triggerFns = new Set([...jobsInsertTriggerFns(), ...DYNAMIC_TRIGGERS.map((d) => d.fn)]);

function insertColumns(): string[] {
  const body = blankSqlComments(defs.get("quote_insert_job")?.body ?? "");
  const m = /INSERT\s+INTO\s+(?:public\.)?jobs\s*\(([^)]*)\)/i.exec(body);
  return m ? m[1].split(",").map((c) => c.trim()) : [];
}

describe("Q1875: jobs INSERT trigger refusals have words on the quote booking paths", () => {
  it("the inventory still sees the world", () => {
    expect(triggerFns.size).toBeGreaterThan(15);
    expect(triggerFns.has("validate_job_budget")).toBe(true);
    expect(triggerFns.has("enforce_open_job_limit")).toBe(true);
    expect(insertColumns()).toContain("budget");
    expect(insertColumns().length).toBeGreaterThan(10);
    // The dynamic email gate really is attached by its migration, and raises the code.
    for (const d of DYNAMIC_TRIGGERS) {
      const sql = blankSqlComments(readFileSync(join(MIGRATIONS, d.file), "utf8"));
      expect(sql).toMatch(new RegExp(`BEFORE INSERT[\\s\\S]{0,200}EXECUTE FUNCTION public\\.${d.fn}\\(`));
      expect(raisedMessages(defs.get(d.fn)?.body ?? "")).toContain("email_unconfirmed");
    }
  });

  it("every raise a quote booking can reach reads as its own sentence", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const fn of triggerFns) {
      if (NOT_FROM_QUOTE_INSERT[fn] && fn !== "refuse_under_18_member") continue;
      const def = defs.get(fn);
      if (!def) continue;
      for (const msg of raisedMessages(def.body)) {
        if (fn === "refuse_under_18_member" && msg === "helper_unavailable") continue;
        checked++;
        if (quoteErrorMessage(new Error(msg)) === GENERIC) missing.push(`${fn}: ${msg}`);
      }
    }
    expect(checked).toBeGreaterThan(5);
    expect(missing, "add words to JOB_INSERT_REFUSAL_COPY (src/lib/quotes/errors.ts), or a NOT_FROM_QUOTE_INSERT entry here").toEqual([]);
  });

  it("every function said to be out of reach depends only on columns quote_insert_job does not write", () => {
    const cols = new Set(insertColumns());
    const wrong: string[] = [];
    for (const [fn, { columns }] of Object.entries(NOT_FROM_QUOTE_INSERT)) {
      if (!triggerFns.has(fn)) wrong.push(`${fn}: no longer a jobs BEFORE INSERT trigger function`);
      for (const c of columns) if (cols.has(c)) wrong.push(`${fn}: quote_insert_job now writes ${c}`);
    }
    expect(wrong).toEqual([]);
  });

  it("a function said to be out of reach with no column returns on INSERT before its first raise", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const [fn, { columns }] of Object.entries(NOT_FROM_QUOTE_INSERT)) {
      if (columns.length) continue;
      checked++;
      const body = blankSqlComments(defs.get(fn)?.body ?? "");
      const insertReturn = /IF\s+TG_OP\s*=\s*'INSERT'\s+THEN[\s\S]*?RETURN\s+NEW;\s*END\s+IF;/i.exec(body);
      const firstRaise = body.search(/RAISE\s+EXCEPTION/i);
      if (!insertReturn || firstRaise < 0 || insertReturn.index + insertReturn[0].length > firstRaise) {
        wrong.push(`${fn}: no RETURN NEW for TG_OP = 'INSERT' ahead of its first RAISE EXCEPTION`);
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });

  it("the poster's own price and the open-job limit name what to do", () => {
    expect(quoteErrorMessage(new Error("Minimum budget is $10"))).toBe("Set a price of at least $10.");
    expect(quoteErrorMessage(new Error("You can have a maximum of 5 open jobs at a time. Please wait for existing jobs to be accepted or close them first.")))
      .toMatch(/up to 5 open jobs/);
    expect(quoteErrorMessage(new Error("email_unconfirmed"))).toMatch(/Confirm your email/);
  });
});
