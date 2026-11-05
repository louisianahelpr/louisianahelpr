/**
 * The Web Vitals lab (scripts/perf/cwv-lab.mjs) loads signed-in first screens
 * on PROD with a shared test account's session injected (sessionInit), so a
 * screen that writes on load (analytics RPCs, a token refresh, a mark-read)
 * would reach the real database. Rule (2026-10-09 lesson: a local screenshot
 * script applied to a real job): every browser context holding a test session
 * against prod aborts every non-GET request to Supabase and Stripe, and
 * proves the block fired before it measures anything.
 *
 * The block was built on the browser-perf lane (wip/limit-a1e95198, saved at a
 * usage-limit stop on 2026-10-12) and stranded there; this guard keeps it.
 *
 * @mutate scripts/perf/cwv-lab.mjs |   if (m === "GET" \|\| m === "HEAD" \|\| m === "OPTIONS") return "go"; |   return "go";
 * @mutate scripts/perf/cwv-lab.mjs |             await probeWriteBlock(ctx, blocked); |             void blocked;
 * @mutate scripts/perf/cwv-lab.mjs | const WRITE_BLOCK_HOSTS = /(^\|\.)supabase\.co$\|(^\|\.)stripe\.com$/; | const WRITE_BLOCK_HOSTS = /(^\|\.)stripe\.com$/;
 *
 * The READ ALLOWANCE (`--allow-reads`, 2026-10-13, Q1170/Q1172/Q1173): with the
 * block alone a signed-in screen measured its error state (supabase.rpc reads
 * are POSTs; /profile's LCP read "We couldn't check your payout account"), and
 * an --expired session could never refresh. Only named STABLE RPCs, the
 * expired session's refresh and stripe-connect's status read pass; nothing
 * else does, and only when the flag is given.
 *
 * @mutate scripts/perf/readAllowance.mjs |   if (rpc) return reads.rpcs.has(rpc) ? `rpc:${rpc}` : null; |   if (rpc) return `rpc:${rpc}`;
 * @mutate scripts/perf/readAllowance.mjs |   if (!reads \|\| method !== "POST") return null; |   if (!reads) return null;
 * @mutate scripts/perf/readAllowance.mjs |   if (reads.refresh && u.pathname === "/auth/v1/token" | if (u.pathname === "/auth/v1/token"
 * @mutate scripts/perf/readAllowance.mjs |     return action === "status" ? "fn:stripe-connect:status" : null; |     return "fn:stripe-connect:status";
 * @mutate scripts/perf/readAllowance.mjs |   if (!/(^\|\.)supabase\.co$/.test(u.hostname)) return null; |
 * @mutate scripts/perf/readAllowance.mjs | object\/sign\/message-attachments(\/[^?#]+)?$/ | object\/sign\/[a-z-]+(\/[^?#]+)?$/
 *
 * The MOCKED READS (2026-11-01, B72): stripe-payouts' list read calls Stripe's
 * LIVE balance server side, so it is never let through; the lab answers it in
 * the browser with fixed test data and only with --allow-reads. Its
 * payout-detail read (payout_id) and every other function stay blocked.
 *
 * @mutate scripts/perf/readAllowance.mjs |   if (!parsed \|\| typeof parsed !== "object" \|\| "payout_id" in parsed) return null; |   if (!parsed) return null;
 * @mutate scripts/perf/readAllowance.mjs |   if (u.pathname !== "/functions/v1/stripe-payouts") return null; |
 * @mutate scripts/perf/cwv-lab.mjs |           return route.fulfill({ status: 200, | return route.continue({ status: 200,
 * @mutate scripts/perf/cwv-lab.mjs |         ? cdp.send("Fetch.fulfillRequest", { requestId: e.requestId, responseCode: 200, |         ? cdp.send("Fetch.continueRequest", { requestId: e.requestId, responseCode: 200,
 *
 * THE HTTP CACHE (Q2707/Q2708, 2026-11-04): in Chromium, Playwright's
 * ctx.route() turns the HTTP cache off for the whole page, so every --warm load
 * was a cold load (live item page: the photo and all 134 scripts fetched
 * again). Chromium pages get the block as a CDP Fetch interception instead,
 * opened through newBlockedPage(); WebKit keeps ctx.route.
 *
 * @mutate scripts/perf/cwv-lab.mjs |         : cdp.send("Fetch.failRequest", { requestId: e.requestId, errorReason: "BlockedByClient" }); |         : cdp.send("Fetch.continueRequest", { requestId: e.requestId });
 * @mutate scripts/perf/cwv-lab.mjs | await newBlockedPage(ctx); // the measured load | await ctx.newPage(); // the measured load
 * @mutate scripts/perf/cwv-lab.mjs |   if (!state.cdp) return page; |   return page;
 * @mutate scripts/perf/cwv-lab.mjs | export const PROBE_KINDS = ["fetch", "xhr", "beacon", "worker", "form", "frame"]; | export const PROBE_KINDS = ["fetch", "xhr", "beacon", "worker", "form"];
 * @mutate scripts/perf/cwv-lab.mjs |       navigator.sendBeacon(`${u}_beacon`, "{}"); |       void u;
 * @mutate scripts/perf/cwv-lab.mjs |               colorScheme: arg("scheme", "light"), serviceWorkers: "block", |               colorScheme: arg("scheme", "light"),
 * @mutate scripts/perf/cwv-lab.mjs |   const state = { reads, allowed, blocked, clock, cdp: browserName === "chromium", strays: [] }; |   const state = { reads, allowed, blocked, clock, cdp: false, strays: [] };
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { allowedRead, mockedRead, LAB_STRIPE_PAYOUTS } from "../../scripts/perf/readAllowance.mjs";

const ROOT = resolve(__dirname, "../..");
const src = blankComments(readFileSync(resolve(ROOT, "scripts/perf/cwv-lab.mjs"), "utf8"));
const allowSrc = blankComments(readFileSync(resolve(ROOT, "scripts/perf/readAllowance.mjs"), "utf8"));

describe("cwv-lab blocks every prod write before it measures", () => {
  it("the block covers Supabase and Stripe and lets only GET, HEAD and OPTIONS through", () => {
    const hosts = /const WRITE_BLOCK_HOSTS = (\/.*\/);/.exec(src)?.[1] ?? "";
    const re = new RegExp(hosts.slice(1, -1));
    expect(re.test("fncmgoasalhdgfwzhsqa.supabase.co")).toBe(true);
    expect(re.test("api.stripe.com")).toBe(true);
    expect(re.test("www.louisianahelpr.com")).toBe(false);
    expect(src).toMatch(/if \(m === "GET" \|\| m === "HEAD" \|\| m === "OPTIONS"\) return "go";\s*\n[\s\S]*?return "abort";/);
    // Both ways of applying it obey that decision: abort means abort.
    expect(src).toMatch(/if \(d === "go"\) return route\.continue\(\);[\s\S]*?return route\.abort\("blockedbyclient"\);/);
    expect(src).toMatch(/const send = d === "go"\s*\n\s*\? cdp\.send\("Fetch\.continueRequest"[\s\S]*?: cdp\.send\("Fetch\.failRequest", \{ requestId: e\.requestId, errorReason: "BlockedByClient" \}\);/);
  });

  it("every context installs the block and proves it live before any session or navigation", () => {
    const contexts = [...src.matchAll(/const ctx = await browser\.newContext\(/g)].map((m) => m.index ?? 0);
    expect(contexts.length).toBeGreaterThan(0);
    for (const at of contexts) {
      const after = src.slice(at);
      const install = after.indexOf("await installWriteBlock(ctx");
      const probe = after.indexOf("await probeWriteBlock(ctx, blocked)");
      const session = after.indexOf("sessionInit(");
      const nav = after.indexOf("page.goto(");
      expect(install, "installWriteBlock is called on the new context").toBeGreaterThan(-1);
      expect(probe, "the block is proven live").toBeGreaterThan(install);
      expect(session, "before the test session is injected").toBeGreaterThan(probe);
      expect(nav, "and before the first navigation").toBeGreaterThan(probe);
    }
  });

  it("Chromium keeps the HTTP cache: every page is opened through newBlockedPage, which blocks by CDP Fetch (Q2707)", () => {
    // ctx.route turns Chromium's HTTP cache off, so it is used only off Chromium.
    expect(src).toContain('cdp: browserName === "chromium"');
    const routes = [...src.matchAll(/ctx\.route\(/g)];
    expect(routes.length).toBe(1);
    expect(src.slice(0, routes[0].index)).toMatch(/if \(!state\.cdp\) \{\s*\n\s*await $/);
    expect(src).not.toMatch(/page\.route\(/);
    expect(src).toMatch(/installWriteBlock\(ctx, \(\) => Date\.now\(\) - navWallNow, reads, allowed, browserName\)/);
    // Every context page comes from newBlockedPage; its only ctx.newPage() is inside it.
    const opens = [...src.matchAll(/ctx\.newPage\(\)/g)].map((m) => m.index ?? 0);
    const helper = src.indexOf("export async function newBlockedPage(ctx)");
    expect(opens.length).toBe(1);
    expect(opens[0]).toBeGreaterThan(helper);
    expect(opens[0] - helper).toBeLessThan(400);
    const uses = [...src.matchAll(/await newBlockedPage\(ctx\)/g)];
    expect(uses.length).toBeGreaterThan(1);
    // The block is on before the page can load anything, and a popup fails the run.
    expect(src).toMatch(/if \(!state\.cdp\) return page;[\s\S]*?await cdp\.send\("Fetch\.enable", \{ patterns: \[\{ urlPattern: "\*\.supabase\.co\/\*", requestStage: "Request" \}, \{ urlPattern: "\*stripe\.com\/\*", requestStage: "Request" \}\] \}\);\s*\n\s*return page;/);
    expect(src).toMatch(/page\.on\("popup", \(p\) => \{ state\.strays\.push\(p\.url\(\)\); p\.close\(\)/);
    expect(src).toMatch(/\} catch \(e\) \{ error = String\(e\)\.slice\(0, 160\); \}\s*\n\s*assertNoStrayPages\(ctx\);/);
  });

  it("the probe throws unless its POST failed AND was recorded as blocked", () => {
    expect(src).toMatch(/if \(missing\.length \|\| reached\.length \|\| blocked\.length !== before \+ PROBE_KINDS\.length\) \{\s*throw new Error/);
  });

  it("the probe sends by every route a page has: fetch, XHR, sendBeacon, a worker, a form post and a cross-site frame (lead 11-04)", () => {
    const kinds = /export const PROBE_KINDS = (\[[^\]]*\]);/.exec(src)?.[1] ?? "[]";
    expect((JSON.parse(kinds) as string[]).sort()).toEqual(["beacon", "fetch", "form", "frame", "worker", "xhr"]);
    const body = src.slice(src.indexOf("async function probeWriteBlock("), src.indexOf("export async function applyThrottle("));
    expect(body).toContain('fetch(`${u}_fetch`, { method: "POST"');
    expect(body).toContain('x.open("POST", `${u}_xhr`)');
    expect(body).toContain("navigator.sendBeacon(`${u}_beacon`");
    expect(body).toContain("new Worker(");
    expect(body).toMatch(/form\.method = "POST"; form\.action = `\$\{u\}_form`;[\s\S]*?form\.submit\(\);/);
    expect(body).toContain('xf.src = "https://example.com/"');
    expect(body).toContain("fetch(`${u}_frame`, { method: \"POST\"");
    // Service workers stay blocked on every measured context.
    const contexts = [...src.matchAll(/const ctx = await browser\.newContext\(\{[\s\S]*?\}\);/g)];
    expect(contexts.length).toBeGreaterThan(0);
    for (const c of contexts) expect(c[0]).toContain('serviceWorkers: "block"');
  });

  it("the read allowance passes only named STABLE RPCs, the expired refresh and the payout-status read", () => {
    const S = "https://fncmgoasalhdgfwzhsqa.supabase.co";
    const reads = { rpcs: new Set(["get_my_thing"]), refresh: false };
    const status = JSON.stringify({ action: "status" });
    // Off unless the flag is given.
    expect(allowedRead(null, "POST", `${S}/rest/v1/rpc/get_my_thing`, "{}")).toBeNull();
    // A listed RPC passes; an unlisted one (the probe's) does not.
    expect(allowedRead(reads, "POST", `${S}/rest/v1/rpc/get_my_thing`, "{}")).toBe("rpc:get_my_thing");
    expect(allowedRead(reads, "POST", `${S}/rest/v1/rpc/__cwv_write_block_probe`, "{}")).toBeNull();
    expect(allowedRead(reads, "POST", `${S}/rest/v1/rpc/apply_to_job`, "{}")).toBeNull();
    // Only POST: a table write never passes, even to a listed name.
    for (const m of ["PATCH", "DELETE", "PUT"]) expect(allowedRead(reads, m, `${S}/rest/v1/rpc/get_my_thing`, "{}")).toBeNull();
    expect(allowedRead(reads, "POST", `${S}/rest/v1/jobs`, "{}")).toBeNull();
    // The refresh only for an --expired run, and no other grant.
    expect(allowedRead(reads, "POST", `${S}/auth/v1/token?grant_type=refresh_token`, "")).toBeNull();
    expect(allowedRead({ ...reads, refresh: true }, "POST", `${S}/auth/v1/token?grant_type=refresh_token`, "")).toBe("auth:refresh");
    expect(allowedRead({ ...reads, refresh: true }, "POST", `${S}/auth/v1/token?grant_type=password`, "")).toBeNull();
    // stripe-connect: the status read only.
    expect(allowedRead(reads, "POST", `${S}/functions/v1/stripe-connect`, status)).toBe("fn:stripe-connect:status");
    for (const action of ["reset", "onboard", "delete_payout_method", "dashboard"]) {
      expect(allowedRead(reads, "POST", `${S}/functions/v1/stripe-connect`, JSON.stringify({ action }))).toBeNull();
    }
    expect(allowedRead(reads, "POST", `${S}/functions/v1/stripe-connect`, "not json")).toBeNull();
    expect(allowedRead(reads, "POST", `${S}/functions/v1/create-checkout`, status)).toBeNull();
    // B100: signing message photos (one or many) is a read; another bucket, an upload or a move is not.
    expect(allowedRead(reads, "POST", `${S}/storage/v1/object/sign/message-attachments`, '{"paths":["a/b.jpg"]}')).toBe("storage:sign:message-attachments");
    expect(allowedRead(reads, "POST", `${S}/storage/v1/object/sign/message-attachments/u1/t1/a.jpg`, '{"expiresIn":3600}')).toBe("storage:sign:message-attachments");
    for (const p of ["/storage/v1/object/sign/credential-documents/a.jpg", "/storage/v1/object/message-attachments/u1/a.jpg", "/storage/v1/object/move", "/storage/v1/object/upload/sign/message-attachments/a.jpg"]) {
      expect(allowedRead(reads, "POST", `${S}${p}`, "{}"), p).toBeNull();
    }
    expect(allowedRead(reads, "PUT", `${S}/storage/v1/object/sign/message-attachments/a.jpg`, "{}")).toBeNull();
    // Only Supabase hosts.
    expect(allowedRead(reads, "POST", "https://api.stripe.com/rest/v1/rpc/get_my_thing", "{}")).toBeNull();
  });

  it("cwv-lab routes every non-GET through the allowance before it blocks", () => {
    expect(allowSrc).toContain("export function allowedRead(");
    expect(src).toMatch(/import \{ allowedRead, mockedRead \} from "\.\/readAllowance\.mjs";/);
    expect(src).toMatch(/const read = allowedRead\(reads, m, url, postData\);\s*\n\s*if \(read\) \{ allowed\.push/);
  });

  it("the stripe-payouts list read is answered in the browser with test data, never sent", () => {
    const S = "https://fncmgoasalhdgfwzhsqa.supabase.co";
    const reads = { rpcs: new Set(["get_my_thing"]), refresh: false };
    const url = `${S}/functions/v1/stripe-payouts`;
    expect(mockedRead(null, "POST", url, "{}")).toBeNull();
    expect(mockedRead(reads, "POST", url, "{}")).toEqual({ read: "mock:stripe-payouts:list", body: LAB_STRIPE_PAYOUTS });
    // The detail read and every other function or host stay blocked.
    expect(mockedRead(reads, "POST", url, JSON.stringify({ payout_id: "po_1" }))).toBeNull();
    expect(mockedRead(reads, "POST", url, "not json")).toBeNull();
    expect(mockedRead(reads, "POST", `${S}/functions/v1/stripe-connect`, "{}")).toBeNull();
    expect(mockedRead(reads, "POST", `${S}/functions/v1/create-checkout`, "{}")).toBeNull();
    expect(mockedRead(reads, "POST", "https://api.stripe.com/functions/v1/stripe-payouts", "{}")).toBeNull();
    for (const m of ["PATCH", "DELETE", "PUT"]) expect(mockedRead(reads, m, url, "{}")).toBeNull();
    // Never through the allowance itself: a pass there would call live Stripe.
    expect(allowedRead(reads, "POST", url, "{}")).toBeNull();
    // Test data only: every payout id is a lab id.
    expect(LAB_STRIPE_PAYOUTS.payouts.length).toBeGreaterThan(0);
    for (const p of LAB_STRIPE_PAYOUTS.payouts) expect(p.id).toMatch(/^po_lab_test_/);
    // cwv-lab fulfills it locally before the allowance, and never continues it.
    expect(src).toMatch(/const mock = mockedRead\(reads, m, url, postData\);\s*\n\s*if \(mock\) \{\s*\n\s*allowed\.push\(\{ read: mock\.read, at: clock\(\) \}\);\s*\n\s*return \{ mock \};/);
    expect(src).toMatch(/if \(d !== "abort"\) \{\s*\n\s*return route\.fulfill\(\{ status: 200,/);
    expect(src).toMatch(/: d !== "abort"\s*\n\s*\? cdp\.send\("Fetch\.fulfillRequest", \{ requestId: e\.requestId, responseCode: 200,/);
    expect(src.indexOf("const mock = mockedRead(")).toBeLessThan(src.indexOf("const read = allowedRead("));
  });

  it("an --allow-reads run refuses a list too short to be the STABLE/IMMUTABLE set", () => {
    expect(src).toMatch(/if \(reads && reads\.rpcs\.size < 20\) throw new Error/);
  });
});
