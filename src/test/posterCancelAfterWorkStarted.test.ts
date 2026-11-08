/**
 * Jobs audit 11-08 #1 (High) and #5 (Medium), migration 20261108200000.
 *
 * Behaviour (real Postgres): src/test/pglite/posterCancelAfterWorkStarted.pglite.mjs (2026-11-08: 13 PASS; 7 FAIL with
 * NEW_MIGRATION=skip, where an in-progress job with the Helpr on site cancelled for a 50% fee and the poster got the
 * other half back; 7 plants each red).
 *
 * This guard holds the rule on the EFFECTIVE definition and the app:
 *   - poster_cancel_job refuses 'work_started' for in progress / being fixed / on site / a live continue day, and a crew
 *     under way with anyone on it, BEFORE the job row is written;
 *   - the app has words for work_started (pointing at Report a problem), and the cancel quote offers no cancel then;
 *   - the no-money cancel notice and the last chance to approve are not System alerts ('warning').
 *
 * @mutate supabase/migrations/20261108200000_poster_cancel_refused_once_work_started.sql | WHERE t.job_id = p_job_id AND t.status IN ('arrived', 'working', 'done')) | WHERE false)
 * @mutate supabase/migrations/20261108200000_poster_cancel_refused_once_work_started.sql | OR j.status::text = 'revision_requested')) | OR j.status::text IN ('revision_requested', 'in_progress')))
 * @mutate supabase/migrations/20261108200000_poster_cancel_refused_once_work_started.sql |     IF public.job_work_started(v_job.id) THEN\n      INSERT INTO public.notifications |     IF false THEN\n      INSERT INTO public.notifications
 * @mutate supabase/migrations/20261108200000_poster_cancel_refused_once_work_started.sql | CASE WHEN v_helper_cut > 0 THEN 'payment' ELSE 'job_updates' END,\n      '/jobs?job=' | CASE WHEN v_helper_cut > 0 THEN 'payment' ELSE 'warning' END,\n      '/jobs?job='
 * @mutate src/lib/lifecycleErrorCopy.ts |     work_started:\n | 
 * @mutate supabase/functions/_shared/notification-templates.ts |         type: "work_status",\n        link: jobPage(f),\n      };\n    },\n  },\n  arrival_confirmed | type: "warning",\n        link: jobPage(f),\n      };\n    },\n  },\n  arrival_confirmed
 * @mutate supabase/functions/create-payment/index.ts |           return quoteJson({ can_cancel: false, reason: "work_started", quoted_at: nowIso }); |           void 0;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { RPC_ERROR_COPY } from "@/lib/lifecycleErrorCopy";
import { NOTIFICATION_TEMPLATES } from "../../supabase/functions/_shared/notification-templates";

const defs = effectiveDefs("supabase/migrations");
const body = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("a poster cannot cancel a job the Helpr started (Jobs audit 11-08 #1)", () => {
  const pcj = flat(body("poster_cancel_job"));
  it("the newest poster_cancel_job is the 20261108200000 one", () => {
    expect(defs.get("poster_cancel_job")?.file).toMatch(/^20261108200000_/);
  });
  it("work = real evidence (on site, tracker step, being fixed, agreed continue day), never in_progress alone", () => {
    const w = flat(body("job_work_started"));
    expect(w).toContain("j.helper_arrived_at IS NOT NULL OR j.poster_confirmed_arrival_at IS NOT NULL OR j.status::text = 'revision_requested'");
    expect(w).toContain("t.status IN ('arrived', 'working', 'done')");
    expect(w).toContain("c.status = 'set'");
    expect(w).not.toMatch(/in_progress/);
    expect(pcj).toContain("IF v_job.is_group_job IS NOT TRUE AND public.job_work_started(v_job.id) THEN RAISE EXCEPTION 'work_started'");
  });
  it("refuses a crew with a member on site or being fixed (an empty roster still cancels)", () => {
    expect(pcj).toMatch(/g\.helper_id IS NOT NULL AND \(g\.helper_arrived_at IS NOT NULL OR g\.poster_confirmed_arrival_at IS NOT NULL OR v_job\.status::text = 'revision_requested'\) \) THEN RAISE EXCEPTION 'work_started'/);
  });
  it("a block never settles a worked-on job: the admins decide", () => {
    const b = flat(body("block_user_and_settle"));
    expect(defs.get("block_user_and_settle")?.file).toMatch(/^20261108200000_/);
    const held = b.indexOf("IF public.job_work_started(v_job.id) THEN");
    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThan(b.indexOf("UPDATE public.jobs SET status = 'cancelled'"));
    expect(b.slice(held, held + 900)).toContain("'admin_review'");
  });
  it("refuses before anything is written", () => {
    const refuse = pcj.indexOf("RAISE EXCEPTION 'work_started'");
    const crewRefuse = pcj.lastIndexOf("RAISE EXCEPTION 'work_started'");
    const write = pcj.indexOf("UPDATE public.jobs SET status = 'cancelled'");
    const shares = pcj.indexOf("INSERT INTO public.crew_cancellation_fee_shares");
    expect(refuse).toBeGreaterThan(0);
    expect(crewRefuse).toBeLessThan(shares);
    expect(crewRefuse).toBeLessThan(write);
  });
  it("the no-money cancel notice is a job update, never a System alert", () => {
    expect(pcj).not.toContain("ELSE 'warning' END");
    expect((pcj.match(/ELSE 'job_updates' END/g) ?? []).length).toBe(2);
  });
  it("the last chance to approve is work_status", () => {
    expect(flat(body("sweep_release_last_chance"))).toMatch(/rec\.customer_id, 'work_status', 'Please review the work'/);
  });
  it("the app explains work_started and points at Report a problem", () => {
    const copy = (RPC_ERROR_COPY as unknown as Record<string, Record<string, string>>).poster_cancel_job?.work_started ?? "";
    expect(copy).toMatch(/Report a problem/);
  });
  it("the cancel quote offers no cancel for a started single job", () => {
    const cp = blankComments(readFileSync("supabase/functions/create-payment/index.ts", "utf8"));
    expect(cp).toContain('return quoteJson({ can_cancel: false, reason: "work_started", quoted_at: nowIso });');
    expect(cp).toContain(`supabaseAdmin.rpc("job_work_started", { p_job_id: jobId })`);
  });
  it("the fix ask is Work status, not a System alert (#5)", () => {
    const b = NOTIFICATION_TEMPLATES.revision_requested.build({
      job: { id: "J", title: "Yard", status: "revision_requested" }, senderRole: "poster", revisionDescription: "Edge the walk",
      senderName: "Dana",
    } as unknown as Parameters<(typeof NOTIFICATION_TEMPLATES)["revision_requested"]["build"]>[0]);
    expect(b?.type).toBe("work_status");
  });
});
