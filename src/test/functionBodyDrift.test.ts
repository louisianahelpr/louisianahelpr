/**
 * scripts/audit/function-body-drift.mjs — the nightly check that prod RUNS the
 * body the newest migration defines (db-drift-detect.yml). The live half needs
 * prod; this pins the parser and the classification against the repo's own
 * migrations, and proves the check goes red on the 2026-09-15 defect: prod's
 * report_helper_no_show was an OLDER migration's body (20260914215112, applied
 * after 20260915044137), while every repo guard read the newest file.
 */
// Proven able to fail 2026-09-20: blinding the parser to `--` comments makes
// it read a commented-out CREATE FUNCTION as a definition, and the guard reds.
// @mutate scripts/audit/function-body-drift.mjs | return text.slice(lineStart, index).includes("--"); | return false;
// Proven able to fail 2026-09-26 (issue #1802): without the rewrite replay the
// detector expects the pre-rewrite bodies, and the parity and copy tests red.
// @mutate scripts/audit/function-body-drift.mjs | const body = pgRegexpReplace(v.body, e.pattern, e.replacement, e.flags); | const body = v.body;
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import {
  diffFunctions,
  expectedFunctions,
  extractFunctionEvents,
  linkNormalize,
  loadBaseline,
  normalizeBody,
  normalizeSignature,
  // @ts-expect-error — plain .mjs script, no type declarations
} from "../../scripts/audit/function-body-drift.mjs";

type Exp = {
  name: string;
  sig: string;
  state: string;
  body: string;
  md5: string;
  lmd5: string;
  version: string;
  history: Set<string>;
  rewrites: string[];
};

/** A prod that runs exactly what the migrations say. */
function perfectProd(expected: Map<string, Exp>) {
  return [...expected.values()]
    .filter((e) => e.state === "defined")
    .map((e) => ({ proname: e.name, sig: e.sig.split(",").filter(Boolean).join(", "), md5: e.md5, nmd5: e.md5, lmd5: e.lmd5 }));
}

describe("function-body drift — parser", () => {
  it("normalises signatures the way pg's oidvectortypes prints them", () => {
    expect(normalizeSignature("p_job_id uuid, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL")).toBe("uuid,numeric,numeric");
    expect(normalizeSignature("p_until timestamptz, OUT ok boolean, VARIADIC p_ids int[]")).toBe("timestamp with time zone,integer[]");
    expect(normalizeSignature("p_tiers text[] DEFAULT ARRAY['plus'::text, 'elite'::text], p_limit int -- page, size\n")).toBe("text[],integer");
    expect(normalizeSignature("")).toBe("");
  });

  it("reads creates (qualified or not), skips commented and other-schema ones, and drops by signature", () => {
    const sql = [
      "-- CREATE OR REPLACE FUNCTION public.commented(x int) RETURNS int AS $$ SELECT 1 $$;",
      "CREATE OR REPLACE FUNCTION public.a(p uuid) RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;",
      "CREATE FUNCTION b() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;",
      "DROP FUNCTION IF EXISTS public.a(uuid);",
      "DROP FUNCTION c;",
    ].join("\n");
    const ev = extractFunctionEvents(sql);
    expect(ev.map((e: { kind: string; name: string; sig: string | null }) => `${e.kind}:${e.name}(${e.sig})`)).toEqual([
      "create:a(uuid)",
      "create:b()",
      "drop:a(uuid)",
      "drop:c(null)",
    ]);
    expect(ev[0].body).toBe(" SELECT 1 ");
  });

  it("comment and whitespace differences are not drift; link literals rewritten in place are not drift", () => {
    expect(normalizeBody("BEGIN\n  -- why\n  RETURN 1;\nEND")).toBe(normalizeBody("BEGIN RETURN 1; END"));
    expect(linkNormalize("VALUES (x, '/posts')")).toBe(linkNormalize("VALUES (x, '/posts?job=' || v_job.id::text)"));
    expect(linkNormalize("IF v_arrived THEN RAISE")).not.toBe(linkNormalize("IF v_done THEN RAISE"));
  });
});

describe("function-body drift — against the repo's migrations", () => {
  const expected = expectedFunctions() as Map<string, Exp>;

  it("inventories the migrations (a broken parser must not pass vacuously)", () => {
    const defined = [...expected.values()].filter((e) => e.state === "defined");
    expect(defined.length).toBeGreaterThan(250);
    expect(expected.get("report_helper_no_show(uuid)")?.state).toBe("defined");
    expect(expected.get("mark_helper_arrival(uuid,numeric,numeric)")?.state).toBe("defined");
    expect(expected.get("reject_pending_job(uuid,text)")?.state).toBe("dropped");
  });

  it("a prod that runs the newest body everywhere is clean", () => {
    expect(diffFunctions(expected, perfectProd(expected), {})).toEqual([]);
  });

  it("RED on the exact 2026-09-15 defect: report_helper_no_show running an OLDER migration's body", () => {
    const exp = expected.get("report_helper_no_show(uuid)")!;
    const older = [...exp.history].find((h) => h !== exp.md5)!;
    expect(older).toBeTruthy();
    const prod = perfectProd(expected).map((r) =>
      r.proname === "report_helper_no_show" ? { ...r, md5: "live", nmd5: older, lmd5: "older" } : r,
    );
    const drift = diffFunctions(expected, prod, {});
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ key: "report_helper_no_show(uuid)", kind: "stale" });
  });

  it("also red on a hand-patched body, a missing function, and a dropped one still live", () => {
    const prod = perfectProd(expected)
      .filter((r) => r.proname !== "mark_helper_arrival")
      .map((r) => (r.proname === "enforce_jobs_arrival_integrity" ? { ...r, md5: "x", nmd5: "hand-edited", lmd5: "hand-edited" } : r));
    prod.push({ proname: "reject_pending_job", sig: "uuid, text", md5: "y", nmd5: "y", lmd5: "y" });
    const kinds = Object.fromEntries(diffFunctions(expected, prod, {}).map((d: { key: string; kind: string }) => [d.key, d.kind]));
    expect(kinds).toEqual({
      "enforce_jobs_arrival_integrity()": "unmatched",
      "mark_helper_arrival(uuid,numeric,numeric)": "missing",
      "reject_pending_job(uuid,text)": "present",
    });
  });

  it("a baseline entry accepts only prod's exact body, with a reason", () => {
    const baseline = loadBaseline() as Record<string, { md5: string; reason: string }>;
    for (const [key, entry] of Object.entries(baseline)) {
      expect(entry.reason.length, key).toBeGreaterThan(40);
      expect(entry.md5, key).toMatch(/^[0-9a-f]{32}$/);
    }
    const exp = expected.get("report_helper_no_show(uuid)")!;
    const older = [...exp.history].find((h) => h !== exp.md5)!;
    const prod = perfectProd(expected).map((r) =>
      r.proname === "report_helper_no_show" ? { ...r, md5: "pinned", nmd5: older, lmd5: "older" } : r,
    );
    const accept = { "report_helper_no_show(uuid)": { md5: "pinned", reason: "test" } };
    expect(diffFunctions(expected, prod, accept)).toEqual([]);
    expect(diffFunctions(expected, prod, { "report_helper_no_show(uuid)": { md5: "something-else", reason: "test" } })).toHaveLength(1);
  });
});

/**
 * Issue #1802 (2026-09-25): 20260925143327 rewrote the notification copy of 11
 * functions through pg_get_functiondef + regexp_replace + EXECUTE. Prod applied
 * it exactly as written; the nightly check, which replayed CREATE statements
 * only, called all 11 "unmatched". The detector and the repo-side guards now
 * share one rewrite parser (scripts/lib/functionRewrites.mjs), and these tests
 * hold them to the same answer.
 */
describe("function-body drift — in-place rewrites are replayed", () => {
  const expected = expectedFunctions() as Map<string, Exp>;
  const effective = effectiveDefs(join(process.cwd(), "supabase/migrations"));
  /** The body of a CREATE statement: between `AS $tag$` and the closing tag. */
  const bodyOf = (stmt: string) => {
    const open = /\bAS\s+(\$\w*\$)/i.exec(stmt)!;
    const start = open.index + open[0].length;
    return stmt.slice(start, stmt.indexOf(open[1], start));
  };
  const rewritten = [...effective.entries()].filter(([, d]) => d.rewrites.length > 0);

  it("inventories the rewritten functions (a parser that finds none must not pass)", () => {
    // EXACT (2026-09-26): 9 of 20260925143327's 11. 20260925154606 re-created
    // notify_on_job_update and poster_cancel_job with the new copy already in
    // them; the older link rewrites (20260831232514, 20260901021929) were all
    // superseded by later CREATEs.
    expect(rewritten.length).toBe(9);
    const copy = rewritten.filter(([, d]) => d.rewrites.some((r) => r.startsWith("20260925143327"))).map(([n]) => n);
    expect(copy.sort()).toEqual([
      "check_referral_bonus",
      "expire_pending_direct_offers",
      "helper_abort_job",
      "helper_cancel_booking",
      "notify_helper_application_viewed",
      "notify_helper_on_direct_offer",
      "respond_to_direct_offer",
      "sweep_no_show_alerts",
      "track_revision_scope_creep",
    ]);
  });

  it("the detector expects the same post-rewrite body the repo-side guards read, for every rewritten function", () => {
    const mismatched: string[] = [];
    for (const [name, def] of rewritten) {
      const overloads = [...expected.values()].filter((e) => e.name === name && e.state === "defined");
      if (!overloads.length) continue; // dropped since
      const want = normalizeBody(bodyOf(def.stmt));
      if (!overloads.some((e) => normalizeBody(e.body) === want)) mismatched.push(name);
    }
    expect(mismatched).toEqual([]);
  });

  it("helper_cancel_booking is expected to carry 20260925143327's copy, not the text its newest CREATE wrote", () => {
    const e = expected.get("helper_cancel_booking(uuid)")!;
    expect(e.state).toBe("defined");
    expect(e.version).toBe("20260925143327");
    expect(e.body).toContain("Message the person who posted it or open a dispute.");
    expect(e.body).not.toContain("Message the poster or open a dispute.");
  });

  it("RED when prod never ran the rewrite: the pre-rewrite body reads as stale, not clean", () => {
    const e = expected.get("helper_cancel_booking(uuid)")!;
    const before = [...e.history].find((h) => h !== e.md5)!;
    expect(before).toBeTruthy();
    const prod = perfectProd(expected).map((r) =>
      r.proname === "helper_cancel_booking" ? { ...r, md5: "live", nmd5: before, lmd5: "before" } : r,
    );
    const drift = diffFunctions(expected, prod, {});
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ key: "helper_cancel_booking(uuid)", kind: "stale" });
  });
});
