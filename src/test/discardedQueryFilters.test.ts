import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script shared with CI and (potentially) ESLint, no types.
import * as guard from "../../scripts/check-discarded-query-filters.mjs";

/**
 * Class guard: a PostgREST builder call whose result nobody uses.
 *
 * Reported 2026-09-15 against AdminAnalytics.tsx:235-236, where the revenue /
 * fees / payouts drill-downs call `query.in("payment_status", …)` as a bare
 * statement.
 *
 * MEASURED, not assumed: against the installed @supabase/postgrest-js 2.112.4
 * the discarded `.in()` DOES still apply — `in()` mutates `this.url` and
 * returns `this` (node_modules/@supabase/postgrest-js/dist/index.mjs:1688),
 * so the three money drill-downs were filtering correctly. The shape is still
 * a defect: it is correct only by mutation, it leaks filters onto every alias
 * of the same builder, and one upstream release of immutable builders turns
 * three MONEY breakdowns into unfiltered job lists that still look filtered.
 * The runtime cases below pin both halves of that.
 *
 * The harsher half of the same class is NOT version-dependent: a
 * PostgrestBuilder is a lazy thenable that fetches inside then(), so a bare
 * `void supabase.from(…).update(…)` statement issues no request at all. This
 * app has shipped that five times; JobTracking.tsx:699 was the sixth.
 */

// Shown able to fail on DETECTION, not on the walk: drop `in` from the builder
// method set and the original AdminAnalytics money defect stops being seen.
// @mutate scripts/check-discarded-query-filters.mjs | "eq", "neq", "in", "is", "gt", "gte", "lt", "lte", | "eq", "neq", "is", "gt", "gte", "lt", "lte",

const FIXTURES = resolve(__dirname, "fixtures/discardedQueryFilters");
const REPO = resolve(__dirname, "../..");

type Hit = { key: string; file: string; line: number; method: string; text: string };

const fixture = (name: string) => readFileSync(resolve(FIXTURES, name), "utf8");
const live = (path: string) => readFileSync(resolve(REPO, path), "utf8");

describe("discarded-builder guard — red on origin/main (d492446), green on the fix", () => {
  const ADMIN = "src/components/admin/AdminAnalytics.tsx";
  const TRACKING = "src/components/JobTracking.tsx";

  it("flags both pre-fix AdminAnalytics drill-down filters", () => {
    const hits: Hit[] = guard.hitsInSource(ADMIN, fixture("AdminAnalytics.prefix.tsx.txt"));
    expect(hits.map((h) => `${h.file}:${h.line}:${h.method}`)).toEqual([
      `${ADMIN}:235:in`,
      `${ADMIN}:236:in`,
    ]);
    expect(hits[0].text).toContain('query.in("payment_status"');
  });

  it("passes the fixed AdminAnalytics (query = query.in(…))", () => {
    const source = live(ADMIN);
    expect(guard.hitsInSource(ADMIN, source)).toEqual([]);
    // The fix is the reassignment, not a reworded comment.
    expect(source).toMatch(/query = query\.in\("payment_status", \["escrow", "payout_pending", "released"\]\)/);
  });

  it("flags the pre-fix en-route position write that never fired", () => {
    const hits: Hit[] = guard.hitsInSource(TRACKING, fixture("JobTracking.prefix.tsx.txt"));
    expect(hits.map((h) => `${h.file}:${h.line}:${h.method}`)).toEqual([`${TRACKING}:699:eq`]);
  });

  it("passes the fixed en-route position write (.then makes it fire)", () => {
    expect(guard.hitsInSource(TRACKING, live(TRACKING))).toEqual([]);
  });

  it("the whole repo is clean — src/, supabase/functions/, scripts/", () => {
    const hits: Hit[] = guard.scan();
    expect(hits.map((h) => `${h.file}:${h.line} ${h.text}`)).toEqual([]);
  });
});

describe("discarded-builder guard — the shapes it must catch", () => {
  const cases: Array<[string, string, string]> = [
    ["a filter on a builder variable", "in", `
      const query = supabase.from("jobs").select("*");
      query.in("payment_status", ["escrow"]);
      await query;`],
    ["a filter guarded by an if", "eq", `
      const q = supabase.from("jobs").select("*");
      if (x) q.eq("is_seed", false);
      await q;`],
    ["a filter in a ternary branch", "gte", `
      const q = supabase.from("jobs").select("*");
      x ? q.gte("total_amount", 1) : q.lte("total_amount", 2);
      await q;`],
    ["a filter behind &&", "ilike", `
      const q = supabase.from("jobs").select("*");
      x && q.ilike("title", "%roof%");
      await q;`],
    ["an order/limit modifier", "limit", `
      const q = supabase.from("jobs").select("*");
      q.limit(50);
      await q;`],
    ["a bare chain rooted in .from()", "eq", `
      supabase.from("jobs").update({ status: "open" }).eq("id", id);`],
    ["a void-ed write that never fires", "eq", `
      void supabase.from("jobs").delete().eq("id", id);`],
    ["a bare rpc that never fires", "rpc", `
      supabase.rpc("release_escrow", { job_id: id });`],
    ["an edge-function client from createClient()", "eq", `
      const admin = createClient(url, key);
      const q = admin.from("jobs").select("*");
      q.eq("status", "open");
      await q;`],
    ["a builder-typed helper parameter", "eq", `
      function scope(query: PostgrestFilterBuilder<Database, Row, Row[]>) {
        query.eq("user_id", uid);
        return query;
      }`],
    ["a reassignment that reassigns the WRONG variable", "eq", `
      const a = supabase.from("jobs").select("*");
      const b = supabase.from("jobs").select("*");
      a.eq("id", id);
      await b;`],
  ];

  it.each(cases)("catches %s", (_label, method, source) => {
    const hits: Hit[] = guard.hitsInSource("src/synthetic.tsx", source);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.method)).toContain(method);
  });
});

describe("discarded-builder guard — the shapes it must NOT catch", () => {
  const cases: Array<[string, string]> = [
    ["a reassigned filter", `
      let q = supabase.from("jobs").select("*");
      q = q.in("payment_status", ["escrow"]);
      await q;`],
    ["a chained filter", `
      const { data } = await supabase.from("jobs").select("*").eq("is_seed", false).limit(10);`],
    ["an awaited bare call (the request runs with the filter)", `
      const q = supabase.from("jobs").select("*");
      await q.eq("is_seed", false);`],
    ["a .then()-terminated fire-and-forget", `
      void supabase.from("jobs").update({ x: 1 }).eq("id", id).then(({ error }) => { if (error) report(error); });`],
    ["a returned builder", `
      const scope = () => supabase.from("jobs").select("*").eq("id", id);`],
    ["a builder passed to a helper", `
      const q = supabase.from("jobs").select("*");
      applyFilters(q.eq("id", id));`],
    ["Array.prototype.filter", `
      jobs.filter((j) => j.payment_status === "escrow");`],
    ["Array.prototype.in-lookalikes on plain data", `
      rows.map((r) => r.id);
      list.contains(x);
      text.match(/re/);`],
    ["a DOM select()", `
      textarea.select();`],
    ["storage, which returns real promises", `
      void supabase.storage.from("avatars").remove([path]);`],
    ["a realtime channel", `
      supabase.channel("x").on("postgres_changes", {}, cb).subscribe();`],
  ];

  it.each(cases)("ignores %s", (_label, source) => {
    expect(guard.hitsInSource("src/synthetic.tsx", source)).toEqual([]);
  });
});

describe("discarded-builder guard — what the runtime actually does (postgrest-js 2.112.4)", () => {
  const url = "https://example.supabase.co";

  /** A client whose fetch records request URLs instead of leaving the box. */
  async function clientRecording() {
    const { createClient } = await import("@supabase/supabase-js");
    const urls: string[] = [];
    const fetchStub = async (input: RequestInfo | URL) => {
      urls.push(decodeURIComponent(String(input)));
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    };
    return { urls, supabase: createClient(url, "anon-key", { global: { fetch: fetchStub as typeof fetch } }) };
  }

  it("the reassigned form sends the payment_status filter", async () => {
    const { urls, supabase } = await clientRecording();
    let query = supabase.from("jobs").select("*").eq("is_seed", false);
    query = query.in("payment_status", ["escrow", "payout_pending", "released"]);
    await query;
    expect(urls[urls.length - 1]).toContain("payment_status=in.(escrow,payout_pending,released)");
    expect(urls[urls.length - 1]).toContain("is_seed=eq.false");
  });

  it("today's builder is mutable, which is the only reason the bare call worked", async () => {
    const { urls, supabase } = await clientRecording();
    const query = supabase.from("jobs").select("*");
    // discarded-builder-ok: demonstrating the very shape the guard forbids.
    query.in("payment_status", ["escrow"]);
    await query;
    expect(urls[urls.length - 1]).toContain("payment_status=in.(escrow)");
  });

  it("…and mutation leaks the filter onto every alias of the same builder", async () => {
    const { urls, supabase } = await clientRecording();
    const base = supabase.from("jobs").select("*");
    // discarded-builder-ok: demonstrating the alias leak the guard forbids.
    base.eq("status", "open");
    await base.limit(1);
    // The discarded call landed on `base`, so an unrelated read of the same
    // builder silently inherits it. This is the hazard the guard removes.
    expect(urls[urls.length - 1]).toContain("status=eq.open");
  });

  it("a builder nobody terminates issues no request at all", async () => {
    const { urls, supabase } = await clientRecording();
    // discarded-builder-ok: demonstrating that an unterminated builder never fires.
    void supabase.from("job_tracking").update({ latitude: 1 }).eq("id", "x");
    await new Promise((r) => setTimeout(r, 50));
    expect(urls).toEqual([]);
  });

  it("…and the same write with .then() does", async () => {
    const { urls, supabase } = await clientRecording();
    await new Promise<void>((done) => {
      void supabase.from("job_tracking").update({ latitude: 1 }).eq("id", "x").then(() => done());
    });
    expect(urls[urls.length - 1]).toContain("/rest/v1/job_tracking?id=eq.x");
  });
});
