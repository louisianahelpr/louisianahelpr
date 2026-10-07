/**
 * docs/OPEN.md Q1187 and Q1188 (lh-authz-rls reviews of Q1180, 2026-10-03).
 *
 * Q1187, THE CLASS: the accept stamp (jobs.helper_confirmed_at, NULL -> a
 * time) written by something other than the accept. A ready Helpr's PATCH of
 * helper_confirmed_at (with status 'in_progress' in the same write, or
 * mark_helper_arrival after it) confirmed and started an offered job with no
 * "<name> accepted your offer" notice and every other application left
 * pending; the app's own pre-RPC fallback sent exactly that PATCH. Checked on
 * the definitions the migrations leave (effectiveDefs) and on the code:
 *   1. jobs_award_gate refuses an end-user UPDATE that confirms an accept
 *      unless the accept RPC wrote it (app.accept_rpc = '1'); the one write it
 *      admits without the flag is the CALLER taking an OPEN job with nobody on
 *      it and confirming it at once, which no client can make
 *      (trg_hire_columns_rpc_only, hireColumnsRpcOnly.test.ts).
 *   2. complete_job_accept sets the flag for its one UPDATE and clears it right
 *      after, reading FOUND first.
 *   3. Inventory from the world: every function whose effective definition
 *      writes a non-NULL helper_confirmed_at into jobs is one of those two
 *      kinds, or the gate refuses it in every user session (a writer that is
 *      neither is a broken door, or a new way around the accept).
 *   4. The app writes no confirmation; an edge function writes one only
 *      through the service role (exact list).
 * Q1188: expire_unanswered_offers expires each offer in its own
 * subtransaction, so one deadlocked offer (accept_job_offer takes profile then
 * job; the sweep's strike writes job then profile) rolls back alone and is
 * logged with its job, under the '-seed' source for seed rows.
 *
 * Behaviour, red then green: src/test/pglite/acceptGateHardening.pglite.mjs
 * (prod's bodies md5-checked; every [fix] check fails on them, 25/25 pass with
 * 20261004001807 applied 3x). The six rules whose registrations in
 * acceptCompletesAfterStripeSetup.test.ts mutate 20261003193541's superseded
 * text (the gate, complete_job_accept, the sweep) are registered here against
 * the definition the database now runs.
 */
// Q1187, the gate.
// @mutate supabase/migrations/20261007051854_series_claim_is_an_accept.sql | IF TG_OP = 'UPDATE' AND current_setting('app.accept_rpc', true) IS DISTINCT FROM '1' THEN | IF false THEN
// Q1187, the one writer of an accept.
// @mutate supabase/migrations/20261004001807_accept_stamp_needs_accept_rpc.sql |   PERFORM set_config('app.accept_rpc', '1', true);\n  UPDATE public.jobs |   UPDATE public.jobs
// @mutate supabase/migrations/20261004001807_accept_stamp_needs_accept_rpc.sql |   PERFORM set_config('app.accept_rpc', '0', true);\n  IF NOT v_done THEN |   IF NOT v_done THEN
// @mutate supabase/migrations/20261004001807_accept_stamp_needs_accept_rpc.sql |   v_done := FOUND;\n  PERFORM set_config('app.accept_rpc', '0', true); |   PERFORM set_config('app.accept_rpc', '0', true);\n  v_done := FOUND;
// Q1187, the app and the edge functions.
// @mutate src/components/job-card/activityActions/useOfferHandlers.ts | report(acceptError, { tags: { source: "useOfferHandlers.acceptJobOffer" } }); | await supabase.from("jobs").update({ helper_confirmed_at: new Date().toISOString() }).eq("id", app.job_id); report(acceptError, { tags: { source: "useOfferHandlers.acceptJobOffer" } });
// @mutate supabase/functions/auto-expire-jobs/index.ts | .update({ status: "open", helper_id: null }) | .update({ status: "open", helper_id: null, helper_confirmed_at: new Date().toISOString() })
// Q1188.
// @mutate supabase/migrations/20261006022526_crew_unconfirmed_spot_never_blocks_completion.sql |     EXCEPTION WHEN OTHERS THEN\n      -- A seed/E2E offer |     EXCEPTION WHEN division_by_zero THEN\n      -- A seed/E2E offer
// @mutate supabase/migrations/20261006022526_crew_unconfirmed_spot_never_blocks_completion.sql | 'expire_unanswered_offers' \|\| CASE WHEN v_job.seed THEN '-seed' ELSE '' END | 'expire_unanswered_offers'
// @mutate supabase/migrations/20261006022526_crew_unconfirmed_spot_never_blocks_completion.sql | jsonb_build_object('job_id', v_job.id, 'helper_id', v_job.helper_id, 'err', SQLERRM, 'sqlstate', SQLSTATE) | jsonb_build_object('err', SQLERRM)
// @mutate supabase/migrations/20261006022526_crew_unconfirmed_spot_never_blocks_completion.sql | (coalesce(j.is_seed, false) OR coalesce(hp.is_seed, false)) AS seed | coalesce(j.is_seed, false) AS seed
// @mutate supabase/migrations/20260923092838_user_error_screen_repeat_cap_and_client_seed_tag.sql | OR coalesce(p_tags ->> 'source', p_tags ->> 'area', '') LIKE '%-seed' | OR false
// Re-registered from acceptCompletesAfterStripeSetup.test.ts (its lines target 20261003193541, superseded here).
// @mutate supabase/migrations/20261007051854_series_claim_is_an_accept.sql |     RAISE EXCEPTION 'accept_required' USING ERRCODE = '42501';\n  END IF;\n\n  v_awarding := |     RAISE NOTICE 'accept_required';\n  END IF;\n\n  v_awarding :=
// @mutate supabase/migrations/20261007051854_series_claim_is_an_accept.sql | AND NEW.status::text IN ('in_progress', 'revision_requested', 'completed', 'disputed')) | AND NEW.status::text IN ('in_progress', 'revision_requested', 'completed'))
// @mutate supabase/migrations/20261007051854_series_claim_is_an_accept.sql |           AND TG_OP = 'UPDATE' AND OLD.helper_id IS DISTINCT FROM NEW.helper_id); |           AND false);
// @mutate supabase/migrations/20261004001807_accept_stamp_needs_accept_rpc.sql |       v_name \|\| ' accepted your offer', |       'Offer update',
// @mutate supabase/migrations/20261006022526_crew_unconfirmed_spot_never_blocks_completion.sql |       IF NOT v_no_strike THEN |       IF true THEN
// @mutate supabase/migrations/20261004001807_accept_stamp_needs_accept_rpc.sql |      AND public.job_payment_is_funded(payment_status::text)\n  RETURNING |      AND true\n  RETURNING
import { describe, it, expect } from "vitest";
import { join, relative } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { walkSource, readSource } from "./helpers/walkSource";

const ROOT = join(__dirname, "..", "..");
const defs = effectiveDefs(join(ROOT, "supabase", "migrations"));
const body = (fn: string) => {
  const d = defs.get(fn);
  if (!d) throw new Error(`${fn}: no definition left by the migrations`);
  return blankSqlComments(d.stmt);
};

/** Every write of a non-NULL helper_confirmed_at into jobs, by function, with its statement. */
function stampWriters(): { fn: string; stmt: string; at: number; code: string }[] {
  const out: { fn: string; stmt: string; at: number; code: string }[] = [];
  for (const [fn, d] of defs) {
    const code = blankSqlComments(d.stmt);
    for (const m of code.matchAll(/\bUPDATE\s+(?:public\.)?jobs\b[\s\S]*?;/gi)) {
      const set = /\bSET\b([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|;)/i.exec(m[0])?.[1] ?? "";
      // `=(?!\s*NULL)`, not `=\s*(?!NULL)`: the second would backtrack its \s* and call a clear a stamp.
      if (/(?<![.\w])helper_confirmed_at\s*=(?!\s*NULL\b)/i.test(set)) out.push({ fn, stmt: m[0], at: m.index!, code });
    }
    for (const m of code.matchAll(/\bINSERT\s+INTO\s+(?:public\.)?jobs\s*\(([^)]*)\)[\s\S]*?;/gi)) {
      if (/\bhelper_confirmed_at\b/i.test(m[1])) out.push({ fn, stmt: m[0], at: m.index!, code });
    }
  }
  return out;
}

/** The accept RPC's write: the flag set right before the UPDATE and cleared right after it. */
const flagged = (w: { stmt: string; at: number; code: string }) =>
  /PERFORM\s+set_config\('app\.accept_rpc',\s*'1',\s*true\);\s*$/.test(w.code.slice(0, w.at)) &&
  /^\s*(?:\w+\s*:=\s*FOUND;\s*)?PERFORM\s+set_config\('app\.accept_rpc',\s*'0',\s*true\);/.test(w.code.slice(w.at + w.stmt.length));

/** The caller taking an open job and confirming it in the same write (the gate's one exemption). */
const takesOpenJob = (w: { stmt: string; code: string }) => {
  const set = /\bSET\b([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|;)/i.exec(w.stmt)?.[1] ?? "";
  const caller = /\bhelper_id\s*=\s*auth\.uid\(\)/i.test(set) ||
    (/\bhelper_id\s*=\s*v_uid\b/i.test(set) && /\bv_uid\s+uuid\s*:=\s*auth\.uid\(\)/i.test(w.code));
  return caller && /\bstatus\s*=\s*'accepted'/i.test(set);
};

describe("Q1187: the accept of an offer is written only by the accept RPC", () => {
  it("jobs_award_gate refuses an end-user confirmation the accept RPC did not write", () => {
    const gate = body("enforce_helper_award_gate");
    const check = gate.indexOf("IF TG_OP = 'UPDATE' AND current_setting('app.accept_rpc', true) IS DISTINCT FROM '1' THEN");
    expect(check, "the gate no longer asks whether the accept RPC wrote the confirmation").toBeGreaterThan(-1);
    // after the server-context return and after v_awarding, before the readiness judgement
    expect(gate.indexOf("is_server_context()")).toBeLessThan(check);
    expect(gate.indexOf("IF NOT v_awarding THEN")).toBeLessThan(check);
    expect(check).toBeLessThan(gate.indexOf("v_reason := public.helper_accept_block_reason(NEW.helper_id);"));
    // Q1214 (2): no exemption any more (the series pickup sets the flag itself,
    // src/test/seriesClaimIsAnAccept.test.ts): refused outright.
    expect(gate.slice(check)).toMatch(/^IF TG_OP = 'UPDATE' AND current_setting\('app\.accept_rpc', true\) IS DISTINCT FROM '1' THEN\s+RAISE EXCEPTION 'accept_required' USING ERRCODE = '42501',/);
    expect(gate).not.toMatch(/v_takes_open_job/);
  });

  it("the gate's Q1180 rules still stand (nothing starts on an unaccepted offer; a re-pointed confirmation is an accept)", () => {
    const gate = body("enforce_helper_award_gate");
    expect(gate).toMatch(
      /IF TG_OP = 'UPDATE' AND NEW\.helper_id IS NOT NULL AND NEW\.helper_confirmed_at IS NULL\s+AND \(\(OLD\.status::text = 'accepted'\s+AND NEW\.status::text IN \('in_progress', 'revision_requested', 'completed', 'disputed'\)\)\s+OR \(NEW\.helper_completed_at IS NOT NULL AND OLD\.helper_completed_at IS NULL\)\) THEN\s+RAISE EXCEPTION 'accept_required' USING ERRCODE = '42501';/,
    );
    expect(gate).toMatch(/NEW\.helper_id IS NOT NULL AND NEW\.helper_confirmed_at IS NOT NULL\s+AND TG_OP = 'UPDATE' AND OLD\.helper_id IS DISTINCT FROM NEW\.helper_id\);/);
  });

  it("complete_job_accept holds the flag for its one UPDATE, reading FOUND before clearing it", () => {
    const done = body("complete_job_accept");
    const w = stampWriters().find((x) => x.fn === "complete_job_accept");
    expect(w, "complete_job_accept no longer writes the confirmation").toBeDefined();
    expect(flagged(w!)).toBe(true);
    expect(done).toMatch(/v_done := FOUND;\s+PERFORM set_config\('app\.accept_rpc', '0', true\);\s+IF NOT v_done THEN\s+RETURN false;/);
    // Q1180's completion is otherwise intact: funded, once, the others closed, the poster told
    expect(done).toMatch(/AND helper_confirmed_at IS NULL[\s\S]*AND public\.job_payment_is_funded\(payment_status::text\)\s+RETURNING/);
    expect(done).toMatch(/UPDATE public\.applications\s+SET status = 'rejected'/);
    expect(done).toContain("v_name || ' accepted your offer'");
  });

  it("every function that writes a confirmation is the accept RPC's write or a take-an-open-job write (inventory from the world)", () => {
    const writers = stampWriters();
    // 2026-10-03: complete_job_accept (flagged), claim_series_dates and respond_to_direct_offer (take-an-open-job);
    // 20261003214350 (Q1185) routes respond_to_direct_offer through complete_job_accept.
    expect(writers.length).toBeGreaterThanOrEqual(2);
    expect(writers.some((w) => w.fn === "complete_job_accept" && flagged(w))).toBe(true);
    expect(writers.some((w) => w.fn === "claim_series_dates" && takesOpenJob(w))).toBe(true);
    const neither = writers.filter((w) => !flagged(w) && !takesOpenJob(w)).map((w) => `${w.fn}: ${w.stmt.replace(/\s+/g, " ").slice(0, 160)}`);
    expect(
      neither,
      "these write jobs.helper_confirmed_at but jobs_award_gate refuses the write in a user session: set app.accept_rpc " +
        "around it the way complete_job_accept does (better: call complete_job_accept, which also tells the poster), " +
        "or prove it only ever runs as the server",
    ).toEqual([]);
  });
});

describe("Q1187: the app writes no confirmation; an edge function only as the server", () => {
  const STAMP = /(?<![\w.])helper_confirmed_at\s*:(?!\s*null\b)/;
  function clientStampWrites(roots: string[]): string[] {
    const hits: string[] = [];
    for (const f of walkSource(roots).filter((x) => !/\.test\.tsx?$|\/src\/test\/|\/__tests__\//.test(x))) {
      const src = readSource(f);
      if (!src) continue;
      const code = blankComments(src);
      for (const m of code.matchAll(/\.from\(\s*["']jobs["']\s*\)/g)) {
        const end = code.indexOf(";", m.index!);
        const chain = code.slice(m.index!, end === -1 ? undefined : end);
        if (/\.(update|upsert|insert)\s*\(/.test(chain) && STAMP.test(chain)) hits.push(relative(ROOT, f));
      }
    }
    return [...new Set(hits)].sort();
  }

  /** Edge functions that write a confirmation, with the proof their client is the service role. */
  const EDGE_SERVER_WRITERS: Record<string, RegExp> = {
    // books a funded series visit to the date's holder (Q210); no user JWT reaches this client
    "supabase/functions/charge-recurring-visits/index.ts":
      /createClient\(\s*Deno\.env\.get\("SUPABASE_URL"\)\s*\?\?\s*"",\s*\(Deno\.env\.get\("SECRET_KEY"\)\s*\?\?\s*Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)\)\s*\?\?\s*"",?\s*(?:\{\s*global:\s*\{\s*fetch:\s*boundedFetch\(\)\s*\}\s*\},?\s*)?\)/,
  };

  it("no client write in src/ stamps helper_confirmed_at (the accept is accept_job_offer)", () => {
    expect(walkSource([join(ROOT, "src")]).length).toBeGreaterThan(800);
    expect(clientStampWrites([join(ROOT, "src")])).toEqual([]);
  });

  it("the edge functions that stamp it are exactly the listed service-role ones", () => {
    const found = clientStampWrites([join(ROOT, "supabase", "functions")]);
    expect(found).toEqual(Object.keys(EDGE_SERVER_WRITERS).sort());
    for (const [file, proof] of Object.entries(EDGE_SERVER_WRITERS)) {
      const code = blankComments(readSource(join(ROOT, file)) ?? "");
      const calls = [...code.matchAll(/\bcreateClient\(/g)].length;
      expect(calls, `${file}: one client, and it is the service role`).toBe(1);
      expect(code, `${file}: its client is no longer the service role`).toMatch(proof);
    }
  });
});

describe("Q1188: one offer that cannot expire never rolls back the sweep", () => {
  it("each offer expires in its own subtransaction, the strike inside it", () => {
    const sweep = body("expire_unanswered_offers");
    const loop = sweep.indexOf("LOOP");
    // 20261005184940 widened the re-read (the start columns for the capped-window no-strike rule).
    const begin = sweep.search(/LOOP\s+BEGIN\s+SELECT j\.id, j\.title, j\.customer_id, j\.helper_id[^;]*?\s+INTO v_locked/);
    const handler = sweep.indexOf("EXCEPTION WHEN OTHERS THEN");
    expect(loop).toBeGreaterThan(-1);
    expect(begin, "the locked re-read is no longer the first statement of a per-offer block").toBe(loop);
    expect(handler).toBeGreaterThan(sweep.indexOf("v_count := v_count + 1;"));
    const strike = sweep.indexOf("PERFORM public.apply_job_denial_consequence(");
    expect(strike).toBeGreaterThan(begin);
    expect(strike).toBeLessThan(handler);
    expect(sweep).toMatch(/END;\s+END LOOP;\s+RETURN v_count;/);
    // Q1180's no-strike rule rides inside the block unchanged
    expect(sweep).toMatch(/IF NOT v_no_strike THEN\s+PERFORM public\.apply_job_denial_consequence/);
    // the locked re-read still takes only unconfirmed offers (unassignClearsAcceptStamp's proof)
    expect(sweep).toMatch(/AND j\.helper_confirmed_at IS NULL\s+FOR UPDATE SKIP LOCKED;/);
  });

  it("a failure is logged with its job, and a seed offer under the '-seed' source", () => {
    const sweep = body("expire_unanswered_offers");
    expect(sweep).toMatch(/\(coalesce\(j\.is_seed, false\) OR coalesce\(hp\.is_seed, false\)\) AS seed/);
    expect(sweep).toMatch(/LEFT JOIN public\.profiles hp ON hp\.user_id = j\.helper_id/);
    expect(sweep).toMatch(
      /EXCEPTION WHEN OTHERS THEN\s+INSERT INTO public\.error_logs \(severity, message, tags, context\)\s+VALUES \(\s+CASE WHEN v_job\.seed THEN 'info' ELSE 'error' END,/,
    );
    expect(sweep).toContain("'expire_unanswered_offers' || CASE WHEN v_job.seed THEN '-seed' ELSE '' END");
    expect(sweep).toContain("jsonb_build_object('job_id', v_job.id, 'helper_id', v_job.helper_id, 'err', SQLERRM, 'sqlstate', SQLSTATE)");
    // the '-seed' convention is error_log_is_seed's, which keeps seed rows out of Slack and the ledger
    expect(body("error_log_is_seed")).toContain("OR coalesce(p_tags ->> 'source', p_tags ->> 'area', '') LIKE '%-seed'");
  });
});
