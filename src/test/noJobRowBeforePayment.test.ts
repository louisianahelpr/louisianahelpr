import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";
import { buildTurnoverPrefill } from "@/pages/post-job/turnoverPrefill";

/**
 * Q768 (docs/OPEN.md; owner decision 2026-09-27, pop-up: "Import as drafts").
 *
 * THE CLASS: a server path that creates a jobs row before anyone has paid for
 * it. str-ical-sync inserted one per guest checkout, payment_status 'unpaid':
 * invisible to every Helpr (browse lists only funded jobs) and, since Q767
 * removed Fund & Publish, unfundable by the host. A job is created by its
 * poster in Post a Job, who then pays; the only server insert left is a series
 * visit charge-recurring-visits books AFTER its charge succeeded.
 *
 * The inventory is EXACT and two-way: every edge function that inserts into
 * public.jobs, read from source.
 */

// @mutate supabase/functions/str-ical-sync/index.ts | const { error: notifyError } = await supabase.from('notifications').insert({ | await supabase.from('jobs').insert({ customer_id: conn.user_id, status: 'open' });\n          const { error: notifyError } = await supabase.from('notifications').insert({
// @mutate supabase/functions/str-ical-sync/index.ts | link:    `/post-job?turnover=${claim.id}`, | link:    `/posts`,
// @mutate src/pages/post-job/usePostJobForm.ts |  \|\| searchParams.get("turnover")); | );
// @mutate src/pages/post-job/useJobSubmit.ts |         await linkTurnoverJob(turnoverId, jobData.id); |         void jobData;
// @mutate src/pages/post-job/turnoverPrefill.ts |     alreadyPosted: row.job_id != null && !!row.jobs && row.jobs.status !== "cancelled" && FUNDED.has(row.jobs.payment_status ?? ""), |     alreadyPosted: row.job_id != null,
// @mutate supabase/migrations/20261007145950_str_turnover_link_job.sql |   ADD CONSTRAINT str_processed_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE SET NULL; |   ADD CONSTRAINT str_processed_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id);

const ROOT = resolve(__dirname, "../..");
const INSERTS_JOBS = /from\(\s*["'`]jobs["'`]\s*\)\s*\.\s*(?:insert|upsert)\s*\(/;

/** Edge functions allowed to insert a jobs row, and why it is never unpaid. */
const SERVER_JOB_INSERTS: Record<string, string> = {
  "supabase/functions/charge-recurring-visits/index.ts":
    "books a series visit only after its charge succeeded (\"Money is in. NOW the visit exists.\").",
};

const read = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

describe("Q768: no server path creates a jobs row before payment", () => {
  it("every edge function that inserts into jobs is on the reasoned list (exact, two-way)", () => {
    const files = walkSource([resolve(ROOT, "supabase/functions")], [".ts"])
      .filter((f) => !/\.test\.ts$/.test(f))
      .map((f) => relative(ROOT, f));
    expect(files.length, "the walk read nothing").toBeGreaterThan(50);
    const inserting = files.filter((f) => INSERTS_JOBS.test(read(f))).sort();
    expect(inserting).toEqual(Object.keys(SERVER_JOB_INSERTS).sort());
  });

  it("str-ical-sync imports a checkout and tells the host, linking Post a Job to it", () => {
    const sync = read("supabase/functions/str-ical-sync/index.ts");
    expect(sync).toMatch(/\.from\('str_processed_events'\)\s*\.insert\(\{[\s\S]*?job_id:\s*null,/);
    expect(sync).toContain("link:    `/post-job?turnover=${claim.id}`,");
    expect(sync).toContain("turnovers_imported");
    expect(sync).not.toMatch(/jobs_created/);
  });

  it("Post a Job opens a turnover pre-filled, skips the entry screen, and links the posted job", () => {
    expect(read("src/pages/post-job/useJobFormEffects.ts")).toMatch(/searchParams\.get\("turnover"\)[\s\S]*?fetchTurnoverPrefill\(turnoverId\)/);
    expect(read("src/pages/post-job/usePostJobForm.ts")).toContain('|| searchParams.get("turnover"));');
    expect(read("src/pages/post-job/usePostJobForm.ts")).toContain('turnoverId: searchParams.get("turnover"),');
    expect(read("src/pages/post-job/useJobSubmit.ts")).toContain("await linkTurnoverJob(turnoverId, jobData.id);");
    expect(read("src/pages/post-job/turnoverPrefill.ts")).toContain('supabase.rpc("link_str_turnover_job"');
  });

  it("the link RPC is the host's own, authenticated only, with a PGlite proof red without it", () => {
    const sql = readFileSync(resolve(ROOT, "supabase/migrations/20261007145950_str_turnover_link_job.sql"), "utf8");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.link_str_turnover_job(uuid, uuid) FROM PUBLIC, anon;");
    expect(sql).toMatch(/JOIN public\.str_calendar_connections c ON c\.id = e\.connection_id\s+WHERE e\.id = p_event_id AND c\.user_id = v_uid/);
    expect(sql, "an unpaid orphan job must stay deletable once a turnover points at it").toContain("REFERENCES public.jobs(id) ON DELETE SET NULL;");
    expect(sql).toMatch(/j\.customer_id = v_uid AND j\.status = 'open'/);
    const proof = readFileSync(resolve(ROOT, "src/test/pglite/strTurnoverLink.pglite.mjs"), "utf8");
    for (const c of ["L1 the host links", "L2 a turnover linked to a FUNDED job", "L3 another account cannot", "L4 the host cannot link", "L5 anon cannot",
      "L6 an unpaid orphan job", "L7 a turnover linked to a never-funded job", "L8 one turnover per job", "const expected = 8;"]) {
      expect(proof).toContain(c);
    }
  });

  it("the pre-filled job fits the jobs CHECKs and says when it was already posted", () => {
    const conn = { property_name: "The Very Long Bayou Cottage Name", property_address: "12 Bayou Rd, Houma, LA 70360", cleaning_budget: 95, cleaning_notes: null };
    const p = buildTurnoverPrefill({ id: "e1", checkout_date: "2026-10-09", job_id: null, str_calendar_connections: conn });
    expect(Array.from(p.title).length).toBeLessThanOrEqual(32);
    expect(p.title.startsWith("STR clean 2026-10-09")).toBe(true);
    expect(p).toMatchObject({ budget: "95", dateNeeded: "2026-10-09", location: conn.property_address, alreadyPosted: false });
    expect(p.description).toContain("Standard turnover clean");
    // "Already posted" only when the linked job is FUNDED (lh-authz-rls review: an abandoned checkout is not a post).
    const linked = (status: string, payment_status: string) =>
      buildTurnoverPrefill({ id: "e1", checkout_date: "2026-10-09", job_id: "j1", jobs: { status, payment_status }, str_calendar_connections: conn }).alreadyPosted;
    expect(linked("open", "escrow")).toBe(true);
    expect(linked("open", "unpaid")).toBe(false);
    expect(linked("open", "abandoned")).toBe(false);
    expect(linked("cancelled", "escrow")).toBe(false);
    expect(buildTurnoverPrefill({ id: "e1", checkout_date: "2026-10-09", job_id: null, str_calendar_connections: { ...conn, cleaning_budget: null } }).budget).toBe("");
  });
});
