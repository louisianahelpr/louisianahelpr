import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script shared with CI (race-runner.yml), no types.
import * as guard from "../../scripts/check-race-class.mjs";

// Q245: a second unguarded write of the same shape in an already-baselined
// file gets its own key (base#2), so it is NEW, not covered by the first's
// baseline entry.
// @mutate scripts/check-race-class.mjs | hits.push({ key: n === 1 ? base : `${base}#${n}`, file: relPath, line }); | hits.push({ key: base, file: relPath, line });

/**
 * Class guard for the job-row race proven on prod 2026-09-12 and fixed in
 * 20260913014328_lock_job_row_on_apply_and_confirm.sql (d0471d07f).
 *
 * Every case that says "flagged" was watched failing against the real pre-fix
 * code: the pre-fix SQL is the repo's own migration set with the fix migration
 * left out (the latest definition of enforce_application_job_state then comes
 * from 20260907063128), and the pre-fix client is `git show
 * d0471d07f^:src/components/job-card/activityActions/useOfferHandlers.ts`, frozen
 * in fixtures/raceClass/ so this runs in a shallow CI checkout.
 */

const FIX = "20260913014328";
// 20260915101102 rebuilt enforce_application_job_state from its LIVE (post-fix,
// FOR SHARE) body to change only its NULL-uid trust test, so it restates the
// fix. "Pre-fix" therefore means leaving both out.
const RESTATES_FIX = "20260915101102";
// Every LATER migration that redefines enforce_application_job_state from its
// live body also restates the FOR SHARE fix, so each one has to be excluded as
// well or "pre-fix" quietly stops meaning pre-fix and the first assertion below
// goes hollow. 20260921190002 added the self-application guard C3;
// 20260924020956 (Q341) added the block refusal.
const RESTATES_APP_JOB_STATE_FIX = [RESTATES_FIX, "20260921190002", "20260924020956"];
const FIXTURES = resolve(__dirname, "fixtures/raceClass");
const OFFER_HANDLERS = "src/components/job-card/activityActions/useOfferHandlers.ts";

type Hit = { key: string; file: string; line?: number };

// @mutate src/components/JobTracking.tsx | .in("status", ["accepted", "in_progress", "revision_requested"]) |
describe("race-class guard — red on the pre-fix code, green on the fix", () => {
  it("flags enforce_application_job_state when the FOR SHARE migration is absent", () => {
    const keys = guard.sqlHits(guard.readMigrations({ exclude: [FIX, ...RESTATES_APP_JOB_STATE_FIX] })).map((h: Hit) => h.key);
    expect(keys).toContain("sql:public.enforce_application_job_state");
  });

  it("passes enforce_application_job_state with the fix migration applied", () => {
    const keys = guard.sqlHits(guard.readMigrations()).map((h: Hit) => h.key);
    expect(keys).not.toContain("sql:public.enforce_application_job_state");
    // The new trigger function does not read jobs at all.
    expect(keys).not.toContain("sql:public.enforce_confirm_on_live_job");
  });

  it("flags the pre-fix helper confirm (helper_confirmed_at, no status predicate)", () => {
    const src = readFileSync(resolve(FIXTURES, "useOfferHandlers.prefix.ts.txt"), "utf8");
    const keys = guard.clientHitsInSource(OFFER_HANDLERS, src).map((h: Hit) => h.key);
    expect(keys).toContain(`client:${OFFER_HANDLERS}::helper_confirmed_at`);
  });

  it("passes the fixed helper confirm (.eq(\"status\", \"accepted\"))", () => {
    const src = readFileSync(resolve(FIXTURES, "useOfferHandlers.fixed.ts.txt"), "utf8");
    expect(guard.clientHitsInSource(OFFER_HANDLERS, src)).toEqual([]);
  });
});

describe("race-class guard — dispute settlement wave (BUILT 2026-09-14, no prod proof yet)", () => {
  /**
   * The three dispute targets, fixed in
   * 20260915034822_dispute_settlement_claim_and_race_locks.sql.
   *
   * NOT yet measured on prod — the prod probes exist
   * (scripts/probes/settle-dispute-race.prod.mjs,
   * admin-release-vs-refund.prod.mjs, dispute-open-race.prod.mjs) and this lane
   * deliberately did not run them. The local numbers are PGlite's, from
   * scripts/probes/dispute-races.pglite.mjs (20 rounds each): claim 20/20 → 0/20,
   * open-vs-cancel 20/20 → 0/20, double submit 20/20 → 0/20.
   */
  const DISPUTE_DIALOG = "src/components/DisputeDialog.tsx";
  const REPO_ROOT = resolve(__dirname, "../..");

  /**
   * settle_dispute_record stays BASELINED after the fix, and that is correct.
   * The scanner's rule is "a jobs read that decides a write must lock it", and
   * this function's jobs read is deliberately unlocked — the lock is on its own
   * `disputes` row, two statements above, which the scanner cannot see. A lock
   * on `jobs` was the first draft and it created an ABBA deadlock with
   * rpc_withdraw_dispute / rpc_decide_dispute. So the assertion here is that
   * the entry carries the re-audit, not that the hit disappeared: a baseline
   * entry still saying "not yet re-audited" is the thing that must fail.
   */
  it("keeps settle_dispute_record flagged (its jobs read is unlocked on purpose)", () => {
    const keys = guard.sqlHits(guard.readMigrations()).map((h: Hit) => h.key);
    expect(keys).toContain("sql:public.settle_dispute_record");
  });

  it("records the re-audit against it instead of leaving it unexplained", () => {
    const reason = guard.loadBaseline().allow["sql:public.settle_dispute_record"];
    expect(reason).toMatch(/Re-audited 2026-09-14/);
    expect(reason).not.toMatch(/Not yet re-audited/i);
  });

  it("flags the pre-fix dispute filing (status, no status predicate)", () => {
    const src = readFileSync(resolve(FIXTURES, "DisputeDialog.prefix.tsx.txt"), "utf8");
    const keys = guard.clientHitsInSource(DISPUTE_DIALOG, src).map((h: Hit) => h.key);
    expect(keys).toContain(`client:${DISPUTE_DIALOG}::status`);
  });

  it("passes the live dispute filing now that the fallback carries .in(\"status\", …)", () => {
    const src = readFileSync(resolve(REPO_ROOT, DISPUTE_DIALOG), "utf8");
    const keys = guard.clientHitsInSource(DISPUTE_DIALOG, src).map((h: Hit) => h.key);
    expect(keys).not.toContain(`client:${DISPUTE_DIALOG}::status`);
  });

  it("a second write of an already-baselined shape in the same file is NEW (Q245)", () => {
    const one = `supabase.from("jobs").update({ status: "open" }).eq("id", id);`;
    const path = "src/example/Probe.ts";
    const first = guard.clientHitsInSource(path, one);
    const both = guard.clientHitsInSource(path, `${one}\n${one}`);
    expect(first.map((h: Hit) => h.key)).toEqual([`client:${path}::status`]);
    const baseline = { allow: { [`client:${path}::status`]: "one audited write" }, safe: {} };
    expect(guard.compare(first, baseline).unexpected).toEqual([]);
    expect(guard.compare(both, baseline).unexpected.map((h: Hit) => h.key)).toEqual([`client:${path}::status#2`]);
  });

  it("keeps the whole inventory baselined — 0 new, 0 stale", () => {
    const { unexpected, stale } = guard.compare(guard.allHits(), guard.loadBaseline());
    expect({ unexpected: unexpected.map((h: Hit) => h.key), stale }).toEqual({ unexpected: [], stale: [] });
  });
});

describe("race-class guard — edge functions (create-payment release, proven on prod 2026-09-12)", () => {
  const CP = "supabase/functions/create-payment/index.ts";

  it("flags the three pre-fix id-only lifecycle writes", () => {
    const src = readFileSync(resolve(FIXTURES, "createPaymentRelease.prefix.ts.txt"), "utf8");
    const keys = guard.clientHitsInSource(CP, src, "edge").map((h: Hit) => h.key);
    expect(keys).toEqual([
      `edge:${CP}::opaque:updateFields`,
      `edge:${CP}::payment_status+status`,
      `edge:${CP}::payment_status+status#2`,
    ]);
  });

  it("the live release / Quick Release / Quick Refund writes carry a status predicate", () => {
    const live = readFileSync(resolve(__dirname, "../..", CP), "utf8");
    const keys = guard.clientHitsInSource(CP, live, "edge").map((h: Hit) => h.key);
    expect(keys).not.toContain(`edge:${CP}::opaque:updateFields`);
    const flips = keys.filter((k: string) => k.startsWith(`edge:${CP}::payment_status+status`));
    // Only cancel_escrow's claim-only fallback flip (audited safe 2026-09-14,
    // in baseline.safe) remains. admin_refund_general's full-refund flip left
    // the inventory on the dispute-races branch: it is pinned to the status and
    // payment_status it read.
    expect(flips).toHaveLength(1);
    expect(live).toMatch(/\}\)\.eq\("id", jobId\)\.eq\("status", job\.status\);\s*\n\s*generalFlip = job\.payment_status == null/);
    expect(live).toMatch(/\.update\(updateFields\)\s*\n\s*\.eq\("id", jobId\)\s*\n\s*\.eq\("status", job\.status\)/);
    expect(live.match(/\.eq\("id", jobId\)\.eq\("status", "disputed"\)\.select\("id"\)/g)).toHaveLength(2);
  });

  it("the 2026-09-14 lifecycle-writes audit: every fixed write is flagged pre-fix and clean (or audited-safe) live", () => {
    const blocks = readFileSync(resolve(FIXTURES, "edgeLifecycleWrites.prefix.ts.txt"), "utf8").split(/^\/\/ @@ /m).slice(1);
    const prefix = blocks.flatMap((b) => {
      const path = b.slice(0, b.indexOf("\n")).trim();
      return guard.clientHitsInSource(path, b, "edge").map((h: Hit) => h.key);
    });
    const AR = "supabase/functions/auto-release-payment/index.ts";
    const AD = "supabase/functions/auto-resolve-disputes/index.ts";
    const CB = "supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts";
    expect(prefix).toEqual([
      `edge:${AR}::payment_status+status`,
      `edge:${AD}::payment_status+status`,
      `edge:${CP}::opaque:{ stripe_session_id: newSessio`,
      `edge:${CP}::status`,
      `edge:${CP}::revision_completed_at`,
      `edge:${CP}::payment_status`,
      `edge:${CP}::payment_status+status`,
      `edge:${CB}::opaque:{ ...(shouldBlockPayout ? { pa`,
    ]);

    const liveKeys = (p: string) =>
      guard.clientHitsInSource(p, readFileSync(resolve(__dirname, "../..", p), "utf8"), "edge").map((h: Hit) => h.key);
    // Status-predicate fixes leave no hit at all.
    expect(liveKeys(AR)).toEqual([]);
    expect(liveKeys(AD)).toEqual([]);
    const cp = liveKeys(CP);
    for (const gone of ["status", "revision_completed_at", "payment_status"]) expect(cp).not.toContain(`edge:${CP}::${gone}`);
    // payment_status-CAS fixes the scanner cannot read are pinned by source, and
    // listed in baseline.safe — never in the grandfathered `allow`.
    const cpSrc = readFileSync(resolve(__dirname, "../..", CP), "utf8");
    expect(cpSrc).toMatch(/\.eq\("id", jobId\)\s*\n\s*\.or\("payment_status\.is\.null,payment_status\.in\.\(unpaid,abandoned,failed\)"\)/);
    expect(cpSrc).toMatch(/\.eq\("id", jobId\)\.eq\("status", job\.status\)\.eq\("payment_status", "cancelling"\)\.select\("id"\)/);
    const cbSrc = readFileSync(resolve(__dirname, "../..", CB), "utf8");
    expect(cbSrc).toMatch(/\.eq\("id", chargebackJob\.id\)\s*\n\s*\.in\("payment_status", \["payout_pending", "escrow"\]\)\s*\n\s*\.select\("id"\)/);
    const baseline = guard.loadBaseline() as { allow: Record<string, string>; safe: Record<string, string> };
    // cancel_escrow's fallback: forced cancelled only while OUR claim still holds, and paged.
    expect(cpSrc).toMatch(/\.eq\("id", jobId\)\.eq\("payment_status", "cancelling"\)\.select\("id"\);\s*\n\s*cancelUpdated = forced;/);
    expect(Object.keys(baseline.safe)).toEqual(expect.arrayContaining([
      `edge:${CP}::opaque:{ stripe_session_id: newSessio`,
      `edge:${CP}::payment_status+status`,
      `edge:${CB}::payment_status`,
    ]));
    // The two writes deferred to the dispute-races branch are closed there:
    // admin_refund_general's flip carries a status predicate (no hit at all),
    // and execute-dispute-split's settlement write runs under the shared
    // settlement claim (audited safe). Nothing edge-side is grandfathered.
    expect(Object.keys(baseline.allow).filter((k) => k.startsWith("edge:"))).toEqual([]);
    expect(Object.keys(baseline.safe)).toContain("edge:supabase/functions/execute-dispute-split/index.ts::opaque:jobPatch");
    expect(readFileSync(resolve(__dirname, "../..", "supabase/functions/execute-dispute-split/index.ts"), "utf8"))
      .toMatch(/"claim_dispute_settlement",\s*\n\s*\{ _job_id: job\.id, _action: "split"/);
  });

  it("the edge scan is part of the live-repo inventory", () => {
    expect(guard.allHits().some((h: Hit) => h.key.startsWith("edge:"))).toBe(true);
  });
});

describe("race-class guard — job completion (helper Done vs poster confirm / cancel, 20260914215112)", () => {
  const JT = "src/components/JobTracking.tsx";
  const COMPLETION_FIX = "20260914215112";
  // 20260924220318 restates the live bodies (guards included) to rename the
  // tab addresses, so every pre-guard baseline excludes it too.
  const RENAMES_TAB_ADDRESSES = "20260924220318";
  const latestDefinition = (name: string, exclude: string[] = []) => {
    let body: string | null = null;
    for (const { sql } of guard.readMigrations({ exclude })) {
      const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$(function)?\\$([\\s\\S]*?)\\$(function)?\\$`, "gi");
      for (const m of sql.matchAll(re)) body = m[2];
    }
    return body ?? "";
  };
  const triggerDefined = (exclude: string[] = []) =>
    guard.readMigrations({ exclude }).some(({ sql }: { sql: string }) => /CREATE\s+TRIGGER\s+trg_completion_on_live_job\s+BEFORE\s+UPDATE\s+OF\s+helper_completed_at/i.test(sql));

  it("flags the pre-fix Done stamp (helper_completed_at, id predicate only)", () => {
    const src = readFileSync(resolve(FIXTURES, "JobTrackingDone.prefix.tsx.txt"), "utf8");
    const keys = guard.clientHitsInSource(JT, src).map((h: Hit) => h.key);
    expect(keys).toContain(`client:${JT}::helper_completed_at`);
  });

  it("the live Done stamp carries the live-status predicate", () => {
    const live = readFileSync(resolve(__dirname, "../..", JT), "utf8");
    const keys = guard.clientHitsInSource(JT, live).map((h: Hit) => h.key);
    expect(keys).not.toContain(`client:${JT}::helper_completed_at`);
  });

  it("without the fix migration there is no status guard on helper_completed_at and a done job is cancellable", () => {
    expect(triggerDefined([COMPLETION_FIX])).toBe(false);
    expect(latestDefinition("poster_cancel_job", [COMPLETION_FIX, RENAMES_TAB_ADDRESSES])).not.toMatch(/helper_completed_at\s+IS\s+NOT\s+NULL/i);
  });

  it("with it: the trigger judges OLD.status and pins a re-stamp; poster_cancel_job refuses a job marked done", () => {
    expect(triggerDefined()).toBe(true);
    const trg = latestDefinition("enforce_completion_on_live_job");
    expect(trg).toMatch(/OLD\.status::text\s+NOT\s+IN\s+\('accepted',\s*'in_progress',\s*'revision_requested'\)/);
    expect(trg).toMatch(/NEW\.helper_completed_at\s*:=\s*OLD\.helper_completed_at/);
    const cancel = latestDefinition("poster_cancel_job");
    expect(cancel).toMatch(/FOR\s+UPDATE;[\s\S]*v_job\.helper_completed_at\s+IS\s+NOT\s+NULL\s+THEN\s+RAISE\s+EXCEPTION\s+'not_cancellable'/i);
  });

  it("no exit around the stamp: clearing it, a block, a no-show report or a Helpr cancel cannot undo a job marked done", () => {
    const without = {
      // 20260915101102 (the NULL-uid trust swap) re-derives this guard from its
      // LIVE body to change only its role test, so it restates the fix — exclude
      // it too, or the pre-guard baseline still finds a definition.
      trg: latestDefinition("enforce_completion_on_live_job", [COMPLETION_FIX, RESTATES_FIX]),
      // 20260923075415 (Q88: fee tier follows commitment) restates the whole
      // function WITH the done-stamp guard, so the pre-guard baseline must
      // exclude it too — same as RESTATES_FIX above.
      // 20260923232809 (Q301) and 20260924023843 (Q345) restate it the same way.
      block: latestDefinition("block_user_and_settle", [COMPLETION_FIX, "20260923075415", "20260923232809", "20260924023843", RENAMES_TAB_ADDRESSES]),
      // Also exclude the arrival migration (20260915044137): it legitimately
      // made report_helper_no_show read helper_completed_at for a STRONGER
      // no-show guard (refuses if arrived OR completed). The pre-guard baseline
      // is the definition before both guard-adders. 20260915074058 (VN-33(b))
      // restates that guard after prod lost it to an out-of-order apply, and
      // 20260924060512 (DH-006: one report per job+Helpr) restates it again.
      noShow: latestDefinition("report_helper_no_show", [COMPLETION_FIX, "20260915044137", "20260915074058", "20260924060512"]),
      helperCancel: latestDefinition("helper_cancel_booking", [COMPLETION_FIX, RENAMES_TAB_ADDRESSES]),
    };
    expect(without.trg).toBe("");
    expect(without.block).not.toMatch(/helper_completed_at/);
    expect(without.noShow).not.toMatch(/helper_completed_at/);
    expect(without.helperCancel).not.toMatch(/helper_completed_at/);

    // 20260915101102 strengthened this clause from `auth.uid() IS NOT NULL`
    // (which trusted any NULL uid, anon included) to `NOT is_server_context()`,
    // so only a true server session may clear the payout stamp.
    expect(latestDefinition("enforce_completion_on_live_job")).toMatch(
      /NEW\.helper_completed_at\s+IS\s+NULL\s+AND\s+NOT\s+public\.is_server_context\(\)\s+THEN\s+RAISE\s+EXCEPTION\s+'helper_completed_at_not_clearable'/i,
    );
    const block = latestDefinition("block_user_and_settle");
    expect(block.match(/helper_completed_at\s+IS\s+NULL/gi)).toHaveLength(2); // the locked SELECT and the UPDATE predicate
    // 20260915044137 broadened this guard: a no-show is now refused when the
    // Helpr has arrived OR completed, raising 'helper_already_arrived'. The
    // done-stamp still blocks the report — the protection is intact/stronger.
    expect(latestDefinition("report_helper_no_show")).toMatch(/v_helper_completed_at\s+IS\s+NOT\s+NULL\s+THEN\s+RAISE\s+EXCEPTION\s+'helper_already_arrived'/i);
    expect(latestDefinition("helper_cancel_booking")).toMatch(/v_job\.helper_completed_at\s+IS\s+NOT\s+NULL\s+THEN\s+RAISE\s+EXCEPTION\s+'not_cancellable'/i);
  });
});

describe("race-class guard — detector units", () => {
  const fn = (body: string, returnsTrigger = false) => ({
    file: "x.sql",
    body,
    language: "plpgsql",
    returnsTrigger,
  });

  it("an unlocked read that decides an insert elsewhere is flagged; FOR UPDATE / FOR SHARE clear it", () => {
    const racy = `BEGIN SELECT status INTO s FROM public.jobs WHERE id = p; IF s <> 'open' THEN RAISE EXCEPTION 'x'; END IF; INSERT INTO public.applications(job_id) VALUES (p); END`;
    expect(guard.analyzeFunctionBody(fn(racy))).not.toBeNull();
    expect(guard.analyzeFunctionBody(fn(racy.replace("WHERE id = p;", "WHERE id = p FOR UPDATE;")))).toBeNull();
    expect(guard.analyzeFunctionBody(fn(racy.replace("WHERE id = p;", "WHERE id = p FOR SHARE;")))).toBeNull();
  });

  it("a trigger function gating its own row write counts as a dependent write", () => {
    const body = `BEGIN SELECT status INTO s FROM jobs WHERE id = NEW.job_id; IF s <> 'open' THEN RAISE EXCEPTION 'x'; END IF; RETURN NEW; END`;
    expect(guard.analyzeFunctionBody(fn(body, true))).not.toBeNull();
    expect(guard.analyzeFunctionBody(fn(body, false))).toBeNull();
  });

  it("a read whose only write is to jobs itself is not this class", () => {
    const body = `BEGIN SELECT status INTO s FROM public.jobs WHERE id = p; IF s = 'open' THEN UPDATE public.jobs SET status = 'x' WHERE id = p; END IF; END`;
    expect(guard.analyzeFunctionBody(fn(body))).toBeNull();
  });

  it("latest definition wins, and DROP FUNCTION removes it", () => {
    const racy = `CREATE OR REPLACE FUNCTION public.f() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN SELECT status INTO s FROM jobs WHERE id = NEW.job_id; IF s <> 'open' THEN RAISE EXCEPTION 'x'; END IF; RETURN NEW; END $$;`;
    const locked = racy.replace("WHERE id = NEW.job_id;", "WHERE id = NEW.job_id FOR SHARE;");
    expect(guard.sqlHits([{ name: "1.sql", sql: racy }]).map((h: Hit) => h.key)).toEqual(["sql:public.f"]);
    expect(guard.sqlHits([{ name: "1.sql", sql: racy }, { name: "2.sql", sql: locked }])).toEqual([]);
    expect(guard.sqlHits([{ name: "1.sql", sql: locked }, { name: "2.sql", sql: racy }])).toHaveLength(1);
    expect(guard.sqlHits([{ name: "1.sql", sql: racy }, { name: "2.sql", sql: "DROP FUNCTION IF EXISTS public.f();" }])).toEqual([]);
  });

  it("client: lifecycle column without status predicate is flagged; .eq/.in status clears it; non-lifecycle ignored", () => {
    const hit = (s: string) => guard.clientHitsInSource("a.ts", s).map((h: Hit) => h.key);
    expect(hit(`await supabase.from("jobs").update({ status: "cancelled" }).eq("id", id);`)).toEqual([
      "client:a.ts::status",
    ]);
    expect(hit(`await supabase.from("jobs").update({ payment_status: "paid" }).eq("id", id).eq("status", "accepted");`)).toEqual([]);
    expect(hit(`await supabase\n  .from("jobs")\n  .update({ helper_id: h })\n  .in("status", ["open"]);`)).toEqual([]);
    expect(hit(`await supabase.from("jobs").update({ title: t }).eq("id", id);`)).toEqual([]);
    expect(hit(`await supabase.from("jobs").update({ poster_completed_at: n }).eq("id", id);`)).toEqual([
      "client:a.ts::poster_completed_at",
    ]);
    expect(hit(`await supabase.from("jobs").update(patch).eq("id", id);`)).toEqual(["client:a.ts::opaque:patch"]);
    expect(hit(`await supabase.from("jobs").update({ ...rest, title }).eq("id", id);`)).toHaveLength(1);
  });
});

describe("race-class guard — baseline over the live repo", () => {
  const hits: Hit[] = guard.allHits();
  const baseline = guard.loadBaseline() as { allow: Record<string, string>; safe?: Record<string, string> };
  const { unexpected, stale } = guard.compare(hits, baseline);

  it("has no new hits (lock the jobs read, or add .eq(\"status\", …))", () => {
    expect(unexpected.map((h: Hit) => `${h.key} ${h.file}${h.line ? `:${h.line}` : ""}`)).toEqual([]);
  });

  it("baseline only shrinks: every allowlisted entry still matches a real hit", () => {
    expect(stale).toEqual([]);
  });

  it("every baseline entry carries a one-line reason", () => {
    for (const [key, reason] of Object.entries({ ...baseline.allow, ...(baseline.safe ?? {}) })) {
      expect(reason.trim().length, key).toBeGreaterThan(20);
      expect(reason.includes("\n"), key).toBe(false);
    }
  });

  it("the check can fail on the live repo: dropping any baseline entry turns it red", () => {
    const [first] = Object.keys(baseline.allow);
    const rest = Object.fromEntries(Object.entries(baseline.allow).filter(([k]) => k !== first));
    expect(guard.compare(hits, { ...baseline, allow: rest }).unexpected.map((h: Hit) => h.key)).toEqual([first]);
    expect(guard.compare(hits, { ...baseline, allow: { ...baseline.allow, "sql:public.gone": "x" } }).stale).toEqual([
      "sql:public.gone",
    ]);
  });

  it("the audited-safe list is enforced the same way: dropping a safe entry turns it red, a stale one too", () => {
    const safe = baseline.safe ?? {};
    const [firstSafe] = Object.keys(safe);
    expect(firstSafe).toBeDefined();
    const rest = Object.fromEntries(Object.entries(safe).filter(([k]) => k !== firstSafe));
    expect(guard.compare(hits, { ...baseline, safe: rest }).unexpected.map((h: Hit) => h.key)).toEqual([firstSafe]);
    expect(guard.compare(hits, { ...baseline, safe: { ...safe, "edge:gone.ts::status": "x" } }).stale).toEqual([
      "edge:gone.ts::status",
    ]);
  });
});
