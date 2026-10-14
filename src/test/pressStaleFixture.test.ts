/**
 * Release gate press-every-control run 38459066451 (c16b0f0dc, 2026-10-14)
 * failed four ways. Three are the harness reading the app wrong, each measured
 * on prod (scripts/audit/press-every-control.mjs carries the evidence):
 *
 *   1. /home (helper) "Notifications › Did you start this job? "[E2E DO NOT
 *      ACCEPT] J 7a4n6o" …" → error toast "We can't open this job right now".
 *      The journeys' direct offer had expired and the job's start had passed,
 *      so the helper truly could not open it: isForeignFixtureGoneRefusal.
 *   2. /posts (customer) "Job address: 100 Audit Way …" not found after the
 *      same row's "Got It" acknowledged the card's backout notice (written by
 *      ack_backout_notice at 04:29:06Z): the press consumed its own row, but
 *      only LABEL-gated presses fed ROW_CONSUMED_SKIP. isWriteRequest.
 *   3. The whole-run request budget: the HTTP cache Playwright disables while
 *      routes are set made every press refetch every avatar (3302 metered,
 *      2977 at Supabase's edge). PublicObjectCache + the meter's skip hook.
 *
 * The fourth (/admin?view=tiers "400 GET 5af6ce6d…/avatar.jpg") is prod DATA:
 * Eli's row names an object a local script deleted on 2026-10-12 16:43Z; the
 * press reported it correctly and nothing here excuses it (asserted below).
 *
 * @mutate scripts/audit/press-every-control.mjs |  && isForeignSweepFixture(chain); | ;
 * @mutate scripts/audit/press-every-control.mjs |   if (rpc) return !READ_RPC_RX.test(rpc[1]); |   if (rpc) return false;
 * @mutate scripts/audit/press-every-control.mjs |             if (meta.rowText) mutatedRows.add(meta.rowText); |
 * @mutate scripts/audit/press-every-control.mjs |     if (!(ttl > 0)) return false; |
 * @mutate scripts/audit/press-every-control.mjs |       ctx.__requestMeterSkip = (req) => !!objectCache.hit(req.method(), req.url()); |
 * @mutate e2e/requestMeter.mjs |       if (context.__requestMeterSkip?.(req)) return; |
 */
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";
import { RequestMeter } from "../../e2e/requestMeter.mjs";

const ROOT = resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const harnessSrc = () => blankComments(read("scripts/audit/press-every-control.mjs"));
const SB = "https://fncmgoasalhdgfwzhsqa.supabase.co";

/** Every RPC name the app calls (`.rpc("name"`), from src/ — the press can trigger any of them. */
function appRpcNames(): string[] {
  const names = new Set<string>();
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f)) {
        for (const m of blankComments(readFileSync(p, "utf8")).matchAll(/\.rpc\(\s*["']([a-z0-9_]+)["']/g)) names.add(m[1]);
      }
    }
  };
  walk(resolve(ROOT, "src"));
  return [...names].sort();
}

describe("a stale notification for another sweep's fixture, answered truthfully", () => {
  const chain = ["Notifications", 'Did you start this job? "[E2E DO NOT ACCEPT] J 7a4n6o" was s'];

  it("the recorded failure is excused, and only it", () => {
    expect(harness.isForeignFixtureGoneRefusal({ toast: harness.NOT_VISIBLE_JOB_TOAST, chain })).toBe(true);
    // Our own fixture, or a real job, is never excused.
    expect(harness.isForeignFixtureGoneRefusal({ toast: harness.NOT_VISIBLE_JOB_TOAST, chain: ["Notifications", 'New application on "[PRESS DO NOT ACCEPT] x" [E2E DO NOT ACCEPT]'] })).toBe(false);
    expect(harness.isForeignFixtureGoneRefusal({ toast: harness.NOT_VISIBLE_JOB_TOAST, chain: ["Notifications", 'Did you start this job? "Mow my lawn" was s'] })).toBe(false);
    // Any other toast on the fixture row still fails.
    expect(harness.isForeignFixtureGoneRefusal({ toast: "Couldn't load this job. Check your connection and try again.", chain })).toBe(false);
  });

  it("the excused copy is exactly what QuickApplyHandler prints when both reads found no row", () => {
    const src = blankComments(read("src/pages/home/QuickApplyHandler.tsx"));
    expect(src).toContain(`failWith("${harness.NOT_VISIBLE_JOB_TOAST}")`);
  });

  it("the harness applies it to error toasts and lists every excuse", () => {
    const src = harnessSrc();
    expect(src).toMatch(/!isForeignFixtureGoneRefusal\(\{ toast: t, chain: entry\.chain \}\)/);
    expect(src).toMatch(/if \(gone\) entry\.excused = /);
  });
});

describe("a press that wrote consumed its own record (the request is the fact)", () => {
  const card = "Cleaning Your offer expired without an answer. It's open to everyone again. Got It [E2E DO NOT ACCEPT] J 7… $25 100 Audit Way, Baton Rouge, LA 99999 Tue, Oct 13 8:05 PM";

  it("Got It's ack_backout_notice is a write, and the card's later control is ROW_CONSUMED_SKIP", () => {
    expect(harness.isWriteRequest({ method: "POST", url: `${SB}/rest/v1/rpc/ack_backout_notice`, status: 200 })).toBe(true);
    const mutatedRows = new Set([card]);
    const gone = harness.rowGoneAfterOwnWrite({ rowText: card, mutatedRows, now: [{ rowText: "SEED Regrout a shower" }] });
    expect(harness.missingControlDisposition({ scope: "page", onSameScreen: true, consumed: false, rowConsumed: gone })).toBe(harness.ROW_CONSUMED_SKIP);
  });

  it("reads, refused writes and edge functions are not writes", () => {
    expect(harness.isWriteRequest({ method: "POST", url: `${SB}/rest/v1/rpc/get_my_pending_direct_offers`, status: 200 })).toBe(false);
    expect(harness.isWriteRequest({ method: "POST", url: `${SB}/rest/v1/rpc/my_schedule_clashes`, status: 200 })).toBe(false);
    expect(harness.isWriteRequest({ method: "POST", url: `${SB}/rest/v1/rpc/client_compat_floor`, status: 200 })).toBe(false);
    expect(harness.isWriteRequest({ method: "PATCH", url: `${SB}/rest/v1/profiles?user_id=eq.x`, status: 400 })).toBe(false);
    expect(harness.isWriteRequest({ method: "POST", url: `${SB}/functions/v1/check-pro-subscription`, status: 200 })).toBe(false);
    expect(harness.isWriteRequest({ method: "POST", url: `${SB}/storage/v1/object/list/avatars`, status: 200 })).toBe(false);
    expect(harness.isWriteRequest({ method: "GET", url: `${SB}/rest/v1/jobs`, status: 200 })).toBe(false);
    expect(harness.isWriteRequest({ method: "PATCH", url: `${SB}/rest/v1/profiles?user_id=eq.x`, status: 204 })).toBe(true);
    expect(harness.isWriteRequest({ method: "POST", url: `${SB}/rest/v1/messages`, status: 201 })).toBe(true);
  });

  it("every RPC the app calls is classified, from the app's own inventory", () => {
    const names = appRpcNames();
    expect(names.length).toBeGreaterThan(80);
    const writes = names.filter((n) => harness.isWriteRequest({ method: "POST", url: `${SB}/rest/v1/rpc/${n}`, status: 200 }));
    const reads = names.filter((n) => !writes.includes(n));
    expect(writes).toContain("ack_backout_notice");
    expect(writes.length).toBeGreaterThan(30);
    expect(reads.length).toBeGreaterThan(30);
    // A read-named RPC is never a write.
    for (const n of reads) expect(harness.READ_RPC_RX.test(n), n).toBe(true);
  });

  it("the harness feeds a press's writes into the same proof as a gated press", () => {
    const src = harnessSrc();
    expect(src).toMatch(/if \(writes\.length > writes0\) \{\n\s*entry\.wrote = [^\n]*\n\s*if \(meta\.rowText\) mutatedRows\.add\(meta\.rowText\);/);
    expect(src).toMatch(/isWriteRequest\(\{ method: r\.method\(\), url: r\.url\(\), status: res\.status\(\) \}\)/);
  });
});

describe("public storage objects are cached per context, as the disabled HTTP cache would", () => {
  const avatar = `${SB}/storage/v1/object/public/avatars/951264df-1e7c-4b6f-912e-a1be37e0dbfb/avatar.jpg?t=1791917654078`;
  const ok = { status: 200, headers: { "cache-control": "public, max-age=31536000" }, body: Buffer.from("jpg") };

  it("a 200 with max-age is kept until it expires; errors and no-cache are never kept", () => {
    const c = new harness.PublicObjectCache();
    expect(c.hit("GET", avatar, 0)).toBe(null);
    expect(c.store(avatar, ok, 0)).toBe(true);
    expect(c.hit("GET", avatar, 1000)?.status).toBe(200);
    expect(c.hit("HEAD", avatar, 1000)).toBe(null);
    expect(c.hit("GET", avatar, 31536000 * 1000)).toBe(null);
    const missing = `${SB}/storage/v1/object/public/avatars/5af6ce6d-68a8-4f98-b9d4-4fab20f1a607/avatar.jpg?t=1`;
    expect(c.store(missing, { status: 400, headers: { "cache-control": "public, max-age=31536000" }, body: Buffer.from("") }, 0)).toBe(false);
    expect(c.hit("GET", missing, 1)).toBe(null);
    expect(c.store(avatar, { ...ok, headers: { "cache-control": "no-cache" } }, 0)).toBe(false);
    expect(c.store(`${SB}/rest/v1/profiles`, ok, 0)).toBe(false);
  });

  it("one row of 40 presses: the meter counts the avatar once, not 40 times", () => {
    const run = (withCache: boolean) => {
      const meter = new RequestMeter("press-every-control");
      const listeners: ((req: unknown) => void)[] = [];
      const ctx: Record<string, unknown> = { on: (ev: string, fn: (req: unknown) => void) => { if (ev === "request") listeners.push(fn); }, pages: () => [] };
      meter.attach(ctx as never);
      const cache = new harness.PublicObjectCache();
      if (withCache) ctx.__requestMeterSkip = (req: { method: () => string; url: () => string }) => !!cache.hit(req.method(), req.url());
      for (let press = 0; press < 40; press++) {
        const req = { url: () => avatar, method: () => "GET" };
        for (const fn of listeners) fn(req);
        if (withCache) cache.store(avatar, ok);
      }
      return meter.byShape["GET /storage/v1/object/public/avatars/:id/avatar.jpg"];
    };
    expect(run(false)).toBe(40);
    expect(run(true)).toBe(1);
  });

  it("the harness routes public objects through the cache and tells the meter", () => {
    const src = harnessSrc();
    expect(src).toMatch(/await ctx\.route\("\*\*\/storage\/v1\/object\/public\/\*\*"/);
    expect(src).toMatch(/ctx\.__requestMeterSkip = \(req\) => !!objectCache\.hit\(req\.method\(\), req\.url\(\)\);/);
    expect(blankComments(read("e2e/requestMeter.mjs"))).toMatch(/if \(context\.__requestMeterSkip\?\.\(req\)\) return;/);
  });

  it("nothing here excuses the missing-object 400 (Eli's dangling avatar_url is data, reported as a defect)", () => {
    // classifyFailedResponse keeps a Supabase 400 the app's; the cache never stores it.
    expect(harness.cacheableFor({ status: 400, cacheControl: "public, max-age=31536000" })).toBe(0);
  });
});

describe("the request budget is per press (Q1374)", () => {
  it("the meter's tests count is the shard's presses", () => {
    const src = harnessSrc();
    expect(src.match(/requestMeter\.tests = totalPressed;/g)?.length).toBe(2);
  });
});
