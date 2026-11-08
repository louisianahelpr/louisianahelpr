/**
 * The server refuses a money or commitment action from a member who has not
 * accepted the current Terms (owner-approved 2026-11-08).
 *
 * Before: only the app asked (TermsReconsentMount). An old build, a dialog
 * chunk that failed to load, or a direct API call could post a job, hire,
 * list, buy or cash out on Terms the member never agreed to.
 *
 * The layers, each checked here from the source the deploy runs:
 *   1. the database: tr_require_current_terms on every table a commitment
 *      creates (and on an application becoming 'accepted'), running
 *      require_current_terms, read from the NEWEST migrations
 *      (behaviour, 3x replay, red without the migration:
 *      src/test/pglite/termsAcceptedBeforeCommitments.pglite.mjs);
 *   2. the server's copy of the live version, public.current_terms_version(),
 *      equals LATEST_TERMS_VERSION and LEGAL_TERMS_VERSION, so a Terms bump
 *      cannot forget it (it would refuse everyone, or no one);
 *   3. the edge functions that write as the service role (no auth.uid() for
 *      the table check) call refuseStaleTerms for their commitment actions;
 *   4. the app's Supabase client goes through termsGateFetch, which opens the
 *      dialog and retries (behaviour: src/test/termsGate.test.tsx).
 *
 * @mutate supabase/migrations/20261108154435_terms_accepted_before_commitments.sql |   SELECT 'Oct 2026'::text |   SELECT 'Sep 2026'::text
 * @mutate supabase/migrations/20261108154435_terms_accepted_before_commitments.sql |   BEFORE INSERT ON public.shop_orders |   BEFORE UPDATE ON public.shop_orders
 * @mutate supabase/migrations/20261108154435_terms_accepted_before_commitments.sql |   WHEN (NEW.status::text = 'accepted' AND OLD.status::text IS DISTINCT FROM 'accepted') |   WHEN (NEW.status::text = 'rejected')
 * @mutate supabase/migrations/20261108154435_terms_accepted_before_commitments.sql |   IF NOT public.terms_accepted_is_current(v_uid) THEN |   IF false THEN
 * @mutate supabase/functions/declutter-checkout/index.ts |       const staleTerms = await refuseStaleTerms(admin, user, corsHeaders); |       const staleTerms = null;
 * @mutate supabase/migrations/20261108154435_terms_accepted_before_commitments.sql | RETURNS text\nLANGUAGE sql\nSTABLE | RETURNS text\nLANGUAGE sql\nIMMUTABLE
 * @mutate supabase/functions/shop-checkout/index.ts |     if (body.action === "order" \|\| body.action === "accept") { |     if (body.action === "order" \|\| body.action === "accept" \|\| body.action === "pay_balance") {
 * @mutate supabase/functions/create-payment/index.ts | new Set(["escrow", "capture_hold", "tip", "recurring_visit"]) | new Set(["capture_hold", "tip", "recurring_visit"])
 * @mutate src/integrations/supabase/client.ts |     fetch: termsGateFetch(guardSignedInRequests({ |     fetch: ((f: typeof fetch) => f)(guardSignedInRequests({
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { bodyOf, triggerInventory } from "./helpers/migrationTriggers";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { LATEST_TERMS_VERSION } from "@/lib/consent";

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase", "migrations");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const files = migrationFiles(MIG);
const sqlOf = (name: string) => readFileSync(join(MIG, name), "utf8");

/** Every table whose INSERT is a new commitment by the acting member. */
const GUARDED_INSERTS = [
  "jobs", // posting a job
  "applications", // applying to a job
  "declutter_items", // a Declutter listing
  "declutter_offers", // an offer on an item
  "declutter_swap_offers", // a swap offer
  "declutter_orders", // buying
  "shop_orders", // a shop order
  "instant_payouts", // cashing out
];

/** Edge function -> the commitment actions it refuses for stale Terms (null = the whole function). */
const EDGE_GATES: Record<string, string[] | null> = {
  "create-payment": ["escrow", "capture_hold", "tip", "recurring_visit"],
  "declutter-checkout": ["pay", "raise_pay", "delivery_tip"],
  "shop-checkout": ["order", "accept"],
  "instant-payout": ["execute"],
  "cash-out-credits": null,
};

describe("the database refuses a commitment from a member behind on the Terms", () => {
  const inv = triggerInventory(files.map((name) => ({ name, sql: blankSqlComments(sqlOf(name)) })));

  it("each commitment table has a BEFORE INSERT tr_require_current_terms running require_current_terms", () => {
    expect(files.length).toBeGreaterThan(1300); // inventory floor (1,4xx migrations on 2026-11-08)
    for (const t of GUARDED_INSERTS) {
      const trg = inv.get(`${t}.tr_require_current_terms`);
      expect(trg, `${t}: trigger missing`).toBeTruthy();
      expect(trg!.fn, t).toBe("require_current_terms");
      expect(trg!.timing.toUpperCase(), t).toBe("BEFORE");
      expect(trg!.events.toLowerCase(), t).toMatch(/^insert$/);
    }
  });

  it("a hire (an application becoming 'accepted') is checked too", () => {
    const trg = inv.get("applications.tr_require_current_terms_on_hire");
    expect(trg, "hire trigger missing").toBeTruthy();
    expect(trg!.fn).toBe("require_current_terms");
    expect(trg!.events.toLowerCase()).toMatch(/update\s+of\s+status/);
    const defining = files.filter((f) => /tr_require_current_terms_on_hire/.test(sqlOf(f)));
    const sql = blankSqlComments(sqlOf(defining[defining.length - 1]));
    expect(sql).toMatch(/WHEN\s*\(NEW\.status::text\s*=\s*'accepted'\s+AND\s+OLD\.status::text\s+IS\s+DISTINCT\s+FROM\s+'accepted'\)/);
  });

  it("the newest require_current_terms refuses terms_not_accepted (42501) for the acting member, and skips no caller only", () => {
    const def = effectiveDefs(MIG).get("require_current_terms");
    expect(def, "function missing").toBeTruthy();
    const body = bodyOf(def!.stmt);
    expect(body).toMatch(/v_uid\s+uuid\s*:=\s*auth\.uid\(\)/);
    // Only a trusted server write skips the check; a bare NULL uid (anon) does not (null-uid-trust, 20260915101102).
    expect(blankSqlComments(body)).toMatch(/IF\s+v_uid\s+IS\s+NULL\s+AND\s+public\.is_server_context\(\)\s+THEN\s+RETURN\s+NEW;/);
    expect(blankSqlComments(body)).not.toMatch(/IF\s+v_uid\s+IS\s+NULL\s+THEN/);
    expect(body).toMatch(/IF\s+NOT\s+public\.terms_accepted_is_current\(v_uid\)\s+THEN\s+RAISE\s+EXCEPTION\s+'terms_not_accepted'\s+USING\s+ERRCODE\s*=\s*'42501'/);
    expect(def!.stmt).toMatch(/SECURITY\s+DEFINER/i);
    expect(def!.stmt).toMatch(/SET\s+search_path\s+TO\s+public,\s*pg_temp/i);
  });

  it("the server's live Terms version equals the app's and the edge's (a bump updates all three)", () => {
    const def = effectiveDefs(MIG).get("current_terms_version");
    expect(def, "current_terms_version missing").toBeTruthy();
    const v = /SELECT\s+'([^']+)'::text/.exec(bodyOf(def!.stmt))?.[1];
    // STABLE, never IMMUTABLE: a cached plan could keep the old version after a bump.
    expect(def!.stmt).toMatch(/LANGUAGE\s+sql\s+STABLE\b/i);
    expect(def!.stmt).not.toMatch(/\bIMMUTABLE\b/i);
    const edge = /export const LEGAL_TERMS_VERSION = "([^"]+)";/.exec(read("supabase/functions/_shared/legalVersions.ts"))?.[1];
    expect(v).toBe(LATEST_TERMS_VERSION);
    expect(v).toBe(edge);
  });

  it("the check functions are not callable by members (REVOKE FROM PUBLIC, anon, authenticated)", () => {
    for (const fn of ["current_terms_version()", "terms_version_rank(text)", "terms_accepted_is_current(uuid)", "require_current_terms()"]) {
      const name = fn.replace(/\(.*$/, "");
      const defining = files.filter((f) => new RegExp(`FUNCTION\\s+public\\.${name}\\b`).test(sqlOf(f)));
      const sql = blankSqlComments(sqlOf(defining[defining.length - 1]));
      const esc = fn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // every regex special (CodeQL #564)
      expect(sql, fn).toMatch(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${esc}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`, "i"));
    }
  });
});

describe("edge functions that write as the service role check the verified caller", () => {
  it("each commitment action calls refuseStaleTerms before it does anything", () => {
    expect(Object.keys(EDGE_GATES).length).toBeGreaterThan(4);
    for (const [fn, actions] of Object.entries(EDGE_GATES)) {
      const src = blankComments(read(`supabase/functions/${fn}/index.ts`));
      expect(src, fn).toMatch(/import \{ refuseStaleTerms \} from "\.\.\/_shared\/requireCurrentTerms\.ts";/);
      expect(src, fn).toMatch(/const staleTerms = await refuseStaleTerms\((admin|supabaseAdmin|supabase), (user|userData\.user), corsHeaders\);\s*if \(staleTerms\) return staleTerms;/);
      if (!actions) continue;
      if (fn === "create-payment") {
        const set = /const TERMS_GATED_ACTIONS: ReadonlySet<unknown> = new Set\(\[([^\]]*)\]\)/.exec(src)?.[1] ?? "";
        expect(set.split(",").map((s) => s.trim().replace(/"/g, ""))).toEqual(actions);
        expect(src).toMatch(/if \(TERMS_GATED_ACTIONS\.has\(action\)\) \{\s*const staleTerms/);
        // Before the first action branch runs.
        expect(src.indexOf("TERMS_GATED_ACTIONS.has(action)")).toBeLessThan(src.indexOf('if (action === "escrow")'));
      } else if (fn === "instant-payout") {
        expect(src).toMatch(/if \(action === "execute"\) \{\s*const staleTerms/);
      } else {
        const cond = /\n\s*if \(([^)]*)\) \{\s*const staleTerms/.exec(src)?.[1] ?? "";
        const named = [...cond.matchAll(/body\.action === "([a-z_]+)"/g)].map((m) => m[1]);
        expect(named, fn).toEqual(actions);
        expect(src.indexOf("const staleTerms"), fn).toBeLessThan(src.indexOf(`if (body.action === "${actions[0]}") return`));
      }
    }
  });

  it("a failed check answers 503 terms_check_failed, never terms_not_accepted (which would ask a member who already agreed)", () => {
    const src = blankComments(read("supabase/functions/_shared/requireCurrentTerms.ts"));
    expect(src).toMatch(/if \(data === true\) return null;/);
    expect((src.match(/code: "terms_check_failed" \}, 503/g) ?? []).length).toBe(2);
  });
});

describe("the app retries a refused commitment after the member agrees", () => {
  it("the Supabase client's fetch goes through termsGateFetch", () => {
    const src = blankComments(read("src/integrations/supabase/client.ts"));
    expect(src).toMatch(/fetch: termsGateFetch\(guardSignedInRequests\(\{/);
  });
});
