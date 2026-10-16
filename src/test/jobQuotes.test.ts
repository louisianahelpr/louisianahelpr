/**
 * Quotes on jobs, slice 1 (owner decisions Q1-Q8, docs/specs/louisiana-hub-roadmap.md).
 *
 * Behaviour (switch off, private quotes under RLS, turns, 48 h expiry, contact
 * filter, under-18 / banned / blocked refusals, accept closes the others, the
 * one-accepted backstop, booking ONE unpaid job at the agreed price through the
 * real jobs INSERT column lock, switch-to-my-own-price): the PGlite proof
 * src/test/pglite/jobQuotes.pglite.mjs (--before: 0/12; after, applied 3x:
 * 12/12; six planted defects each RED, recorded in the lane report).
 *
 * PGlite is one connection, so it cannot race two accepts. This file pins the
 * locks that make the race safe, on the NEWEST definition of each RPC: the
 * request row is taken FOR UPDATE before any quote row in every RPC that
 * closes or decides, and FOR SHARE in submit, so two accepts (or an accept and
 * a switch / cancel / late quote) serialize and the loser sees the new status.
 * It also pins that the agreed price reaches the job only through the jobs
 * INSERT (create-payment then charges jobs.budget: one payment path, Q8), and
 * that the switch stays registered and created OFF.
 *
 * @mutate supabase/migrations/20261015091114_job_quotes.sql | SELECT * INTO v_req FROM public.job_quote_requests WHERE id = v_req_id FOR UPDATE; | SELECT * INTO v_req FROM public.job_quote_requests WHERE id = v_req_id;
 * @mutate supabase/migrations/20261015091114_job_quotes.sql | SELECT * INTO v_req FROM public.job_quote_requests WHERE id = p_request_id FOR SHARE; | SELECT * INTO v_req FROM public.job_quote_requests WHERE id = p_request_id;
 * @mutate supabase/migrations/20261015091114_job_quotes.sql | VALUES ('quotes', 'off', | VALUES ('quotes', 'everyone',
 * @mutate supabase/migrations/20261015091114_job_quotes.sql |                   WHERE r.job_id = OLD.id AND r.status IN ('agreed', 'cancelled')) THEN |                   WHERE false) THEN
 * @mutate src/config/featureSwitches.ts |   "quotes",\n  // Declutter haul-away | // Declutter haul-away
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { FEATURE_SWITCH_KEYS } from "@/config/featureSwitches";

const root = resolve(__dirname, "../..");
const DIR = resolve(root, "supabase/migrations");
const THIS = "20261015091114_job_quotes.sql";
const EFFECTIVE = effectiveDefs(DIR);
const body = (fn: string) => blankSqlComments(EFFECTIVE.get(fn)?.stmt ?? "");
const migration = blankSqlComments(readFileSync(resolve(DIR, THIS), "utf8"));

const DECIDERS = [
  "respond_to_job_quote",
  "book_accepted_quote",
  "switch_quote_request_to_set_price",
  "cancel_quote_request",
  "withdraw_job_quote",
];
const CLIENT_RPCS = [
  ...DECIDERS,
  "create_quote_request",
  "list_open_quote_requests",
  "submit_job_quote",
  "get_my_quote_requests",
  "get_quotes_for_request",
  "get_my_job_quotes",
];

describe("quotes on jobs: race locks, one payment path, the switch (Q1-Q8)", () => {
  it("every quote RPC exists, is gated by the switch and refuses banned callers in its own body", () => {
    expect(CLIENT_RPCS.length).toBeGreaterThan(10);
    for (const fn of CLIENT_RPCS) {
      const b = body(fn);
      expect(b, fn).toMatch(/PERFORM public\.require_feature\('quotes'\);/);
      expect(b, fn).toMatch(/PERFORM public\.quote_require_member\(\);/);
      // Q1284 definer-exec inventory: the caller is read literally in the body.
      expect(b, fn).toMatch(/v_uid := \(SELECT auth\.uid\(\)\);/);
      // The live ban-gate coverage check reads is_caller_banned() in the prosrc
      // of every VOLATILE client RPC (STABLE readers refuse via the helper).
      if (!/\bSTABLE\b/.test(b)) expect(b, fn).toMatch(/public\.is_caller_banned\(\)/);
      expect(b, fn).toMatch(/SECURITY DEFINER\s+SET search_path TO 'public', 'pg_temp'/);
    }
    expect(body("quote_require_member")).toMatch(/public\.member_under_18\(v_uid\)/);
  });

  it("every RPC that decides takes the REQUEST row FOR UPDATE before any quote row", () => {
    for (const fn of DECIDERS) {
      const b = body(fn);
      const reqLock = b.search(/FROM public\.job_quote_requests WHERE id = (v_req_id|p_request_id) FOR UPDATE/);
      expect(reqLock, fn).toBeGreaterThan(0);
      const quoteLock = b.search(/FROM public\.job_quotes[\s\S]{0,80}FOR UPDATE/);
      if (quoteLock >= 0) expect(quoteLock, fn).toBeGreaterThan(reqLock);
    }
    expect(body("submit_job_quote")).toMatch(/FROM public\.job_quote_requests WHERE id = p_request_id FOR SHARE;/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS job_quotes_one_accepted\s+ON public\.job_quotes \(request_id\) WHERE status = 'accepted';/);
  });

  it("the agreed price reaches money only as jobs.budget through a normal jobs INSERT (Q8)", () => {
    const ins = body("quote_insert_job");
    expect(ins).toMatch(/INSERT INTO public\.jobs \(customer_id,[\s\S]*budget,\s+offered_to_helper_id, direct_offer_expires_at\)/);
    // Nothing here sets payment state: the jobs INSERT column lock forces 'unpaid'.
    expect(migration).not.toMatch(/(?:payment_status|stripe_\w+)\s*:=|SET\s+(?:payment_status|stripe_\w+)\s*=/i);
    expect(body("book_accepted_quote")).toMatch(/v_req\.poster_id IS DISTINCT FROM v_uid/);
    // The poster's own money lock covers budget only once a checkout exists:
    // the booked job's price and details are pinned by their own trigger
    // (lh-money-escrow review of 96ba87037, must-fix 1).
    const lock = body("lock_quote_booked_job_terms");
    expect(lock).toMatch(/\(NEW\.budget, NEW\.title, NEW\.description, NEW\.category, NEW\.date_needed/);
    // Pre-hire only: after the hire the schedule / detail change RPCs (Q407, Q1499) own these columns.
    expect(lock).toMatch(/AND OLD\.helper_id IS NULL\s+AND EXISTS/);
    expect(lock).toMatch(/WHERE r\.job_id = OLD\.id AND r\.status IN \('agreed', 'cancelled'\)\) THEN\s+RAISE EXCEPTION 'quote_terms_locked'/);
    expect(migration).toMatch(/CREATE TRIGGER trg_lock_quote_booked_job_terms\s+BEFORE UPDATE OF budget,/);
  });

  it("quotes stay private: RLS on, no client write grant, the open list carries no price", () => {
    for (const t of ["job_quote_requests", "job_quotes", "job_quote_offers"]) {
      expect(migration).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY;`));
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${t} FROM PUBLIC, anon, authenticated;`));
      expect(migration).not.toMatch(new RegExp(`GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*ON TABLE public\\.${t} TO[^;]*authenticated`));
    }
    const list = body("list_open_quote_requests");
    const returns = list.slice(list.indexOf("RETURNS TABLE"), list.indexOf("LANGUAGE"));
    expect(returns).not.toMatch(/price|count|rank|cents/i);
  });

  it("the switch is registered and created OFF", () => {
    expect(FEATURE_SWITCH_KEYS).toContain("quotes");
    expect(migration).toMatch(/VALUES \('quotes', 'off',/);
    expect(migration).toMatch(/ON CONFLICT \(key\) DO NOTHING;/);
  });
});
