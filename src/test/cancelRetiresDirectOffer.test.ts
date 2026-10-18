/**
 * Q1891: a cancelled job never keeps a pending direct offer, and the expiry
 * sweep never tells a poster that a job which is not open "is now open".
 *
 * WHAT WAS BROKEN (read live 2026-10-17): poster_cancel_job set status
 * 'cancelled' and left direct_offer_status 'pending'. The offered Helpr's
 * /jobs showed a cancelled job with a countdown and Accept Job, and at the
 * deadline expire_pending_direct_offers told the poster their cancelled job
 * "is now open to everyone".
 *
 * THE CLASS: every path that ends a job. The retire lives in one BEFORE
 * UPDATE OF status trigger on jobs, so it runs inside every cancel, whichever
 * writer issues it. This guard
 *   1. reads the newest trigger function and the newest CREATE TRIGGER and
 *      requires the retire, on status, after trg_hire_columns_rpc_only;
 *   2. inventories the writers that cancel a job from the migrations' newest
 *      function bodies and from the edge functions, and requires that none of
 *      them re-arms 'pending' or switches triggers off around its write;
 *   3. requires the sweep's UPDATE to be limited to open jobs.
 * Behaviour, red then green: src/test/pglite/cancelRetiresDirectOffer.pglite.mjs
 * (applied 3x: ALL PASS; NEW_MIGRATION=skip: 4 FAILED).
 */
// @mutate supabase/migrations/20261017134720_cancel_retires_direct_offer.sql |     NEW.direct_offer_status := 'withdrawn'; |     NULL;
// @mutate supabase/migrations/20261017134720_cancel_retires_direct_offer.sql |   BEFORE UPDATE OF status ON public.jobs | BEFORE UPDATE OF title ON public.jobs
// @mutate supabase/migrations/20261017134720_cancel_retires_direct_offer.sql |        AND status::text = 'open' |        AND true
import { describe, it, expect } from "vitest";
import { join, relative } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { triggerInventory, bodyOf } from "./helpers/migrationTriggers";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const files = migrationFiles(MIG_DIR).map((f) => ({ name: f, sql: readFileSync(join(MIG_DIR, f), "utf8") }));
const defs = effectiveDefs(MIG_DIR);
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ").toLowerCase();

describe("Q1891 layer 1: the cancel itself retires a pending offer", () => {
  const fn = defs.get("jobs_cancel_retires_direct_offer");
  const body = flat(bodyOf(fn?.stmt ?? ""));
  const trg = triggerInventory(files).get("jobs.zzz_jobs_cancel_retires_direct_offer");

  it("the trigger function moves a pending offer off 'pending' when the status becomes cancelled", () => {
    expect(fn?.file, "jobs_cancel_retires_direct_offer is gone").toBeTruthy();
    expect(body).toMatch(/if new\.status::text = 'cancelled' and old\.status::text is distinct from 'cancelled' and new\.direct_offer_status = 'pending' then new\.direct_offer_status := '(\w+)';/);
    const to = /new\.direct_offer_status := '(\w+)';/.exec(body)?.[1];
    // Not 'expired' / 'declined': record_backout_notice reads those as the Helpr backing out.
    expect(["expired", "declined", "pending"]).not.toContain(to);
  });

  it("is attached BEFORE UPDATE OF status on jobs, and fires after the client gate", () => {
    expect(trg, "the trigger is not attached (or a later migration drops it)").toBeTruthy();
    expect(trg!.timing).toBe("BEFORE");
    expect(trg!.events).toMatch(/^UPDATE OF STATUS\b|^UPDATE$/);
    expect(trg!.fn).toBe("jobs_cancel_retires_direct_offer");
    expect("zzz_jobs_cancel_retires_direct_offer" > "trg_hire_columns_rpc_only").toBe(true);
  });
});

describe("Q1891 layer 2: every path that ends a job goes through that trigger", () => {
  // SQL writers: newest bodies whose UPDATE of jobs sets status cancelled.
  const JOBS_UPDATE = /update\s+(?:public\.)?jobs\b(?:\s+\w+)?\s+set\s+([\s\S]*?)(?:\bwhere\b|;|\breturning\b)/gi;
  const CANCELS = /(?<![\w.])status\s*=\s*'cancelled'/i;
  const sqlWriters = new Map<string, string[]>();
  for (const [name, def] of defs) {
    const code = blankSqlComments(def.stmt);
    const sets = [...code.matchAll(JOBS_UPDATE)].map((m) => m[1]);
    if (sets.some((s) => CANCELS.test(s))) sqlWriters.set(name, sets);
  }
  // Edge writers: `.from("jobs").update({ … status: "cancelled" … })`.
  const edgeFiles = walkSource([join(ROOT, "supabase/functions")]).filter((f) => !/\.test\.ts$/.test(f));
  const edgeWriters: string[] = [];
  const edgeCode = new Map<string, string>();
  for (const f of edgeFiles) {
    const src = readSource(f);
    if (!src) continue;
    const code = blankComments(src);
    for (const m of code.matchAll(/\.from\(\s*["']jobs["']\s*\)/g)) {
      const chain = code.slice(m.index!, m.index! + 1500);
      const upd = /\.update\(\s*\{([\s\S]*?)\}\s*\)/.exec(chain);
      if (upd && upd.index < 200 && /status\s*:\s*["']cancelled["']/.test(upd[1])) {
        edgeWriters.push(relative(ROOT, f));
        edgeCode.set(relative(ROOT, f), code);
      }
    }
  }

  it("the inventory sees the known cancel paths", () => {
    expect(defs.size).toBeGreaterThan(100);
    // Measured 2026-10-17: poster_cancel_job, block_user_and_settle,
    // settle_one_off_jobs_for_banned_account, end_series_for_banned_account.
    expect(sqlWriters.size).toBeGreaterThan(3);
    for (const n of ["poster_cancel_job", "block_user_and_settle", "settle_one_off_jobs_for_banned_account", "end_series_for_banned_account"]) {
      expect(sqlWriters.has(n), `${n} not recognised as a cancel path: the scan is blind`).toBe(true);
    }
    expect(new Set(edgeWriters).size).toBeGreaterThan(1);
    expect(edgeWriters.some((f) => f.includes("auto-expire-jobs"))).toBe(true);
  });

  it("no SQL cancel path re-arms a pending offer or switches triggers off", () => {
    const bad: string[] = [];
    for (const [name, sets] of sqlWriters) {
      // An ASSIGNMENT in a SET list (a comparison inside WHERE or CASE WHEN is fine).
      if (sets.some((s) => /(?:^|,)\s*direct_offer_status\s*=\s*'pending'\s*(?:,|$)/i.test(s))) bad.push(`${name}: sets direct_offer_status = 'pending'`);
      const code = blankSqlComments(defs.get(name)!.stmt);
      if (/session_replication_role|disable\s+trigger/i.test(code)) bad.push(`${name}: switches triggers off`);
    }
    expect(bad).toEqual([]);
  });

  it("no edge cancel path re-arms a pending offer", () => {
    const bad = [...edgeCode].filter(([, code]) => /direct_offer_status\s*:\s*["']pending["']/.test(code)).map(([f]) => f);
    expect(bad).toEqual([]);
  });
});

describe("Q1891 layer 3: the expiry sweep only expires an offer on an open job", () => {
  const code = flat(bodyOf(defs.get("expire_pending_direct_offers")?.stmt ?? ""));
  it("its UPDATE is limited to status open", () => {
    const where = /update public\.jobs set direct_offer_status = 'expired' where ([\s\S]*?) returning/.exec(code)?.[1] ?? "";
    expect(where, "the sweep's UPDATE was not found").not.toBe("");
    expect(where).toMatch(/status(::text)? = 'open'/);
  });
});
