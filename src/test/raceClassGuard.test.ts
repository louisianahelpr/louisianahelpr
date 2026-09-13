import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script shared with CI (race-runner.yml), no types.
import * as guard from "../../scripts/check-race-class.mjs";

/**
 * Class guard for the job-row race proven on prod 2026-09-12 and fixed in
 * 20260913014328_lock_job_row_on_apply_and_confirm.sql (d0471d07f).
 *
 * Every case that says "flagged" was watched failing against the real pre-fix
 * code: the pre-fix SQL is the repo's own migration set with the fix migration
 * left out (the latest definition of enforce_application_job_state then comes
 * from 20260907063128), and the pre-fix client is `git show
 * d0471d07f^:src/pages/activity/activityActions/useOfferHandlers.ts`, frozen
 * in fixtures/raceClass/ so this runs in a shallow CI checkout.
 */

const FIX = "20260913014328";
const FIXTURES = resolve(__dirname, "fixtures/raceClass");
const OFFER_HANDLERS = "src/pages/activity/activityActions/useOfferHandlers.ts";

type Hit = { key: string; file: string; line?: number };

describe("race-class guard — red on the pre-fix code, green on the fix", () => {
  it("flags enforce_application_job_state when the FOR SHARE migration is absent", () => {
    const keys = guard.sqlHits(guard.readMigrations({ exclude: [FIX] })).map((h: Hit) => h.key);
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
  const baseline = guard.loadBaseline() as { allow: Record<string, string> };
  const { unexpected, stale } = guard.compare(hits, baseline);

  it("has no new hits (lock the jobs read, or add .eq(\"status\", …))", () => {
    expect(unexpected.map((h: Hit) => `${h.key} ${h.file}${h.line ? `:${h.line}` : ""}`)).toEqual([]);
  });

  it("baseline only shrinks: every allowlisted entry still matches a real hit", () => {
    expect(stale).toEqual([]);
  });

  it("every baseline entry carries a one-line reason", () => {
    for (const [key, reason] of Object.entries(baseline.allow)) {
      expect(reason.trim().length, key).toBeGreaterThan(20);
      expect(reason.includes("\n"), key).toBe(false);
    }
  });

  it("the check can fail on the live repo: dropping any baseline entry turns it red", () => {
    const [first] = Object.keys(baseline.allow);
    const rest = Object.fromEntries(Object.entries(baseline.allow).filter(([k]) => k !== first));
    expect(guard.compare(hits, { allow: rest }).unexpected.map((h: Hit) => h.key)).toEqual([first]);
    expect(guard.compare(hits, { allow: { ...baseline.allow, "sql:public.gone": "x" } }).stale).toEqual([
      "sql:public.gone",
    ]);
  });
});
