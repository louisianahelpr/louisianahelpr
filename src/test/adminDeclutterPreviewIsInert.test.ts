/**
 * Q2585: the admin Declutter stage preview (/admin/preview/declutter) is admin-only and INERT: while it is open no
 * request but sign-in traffic and the admin's own profile / role read leaves the browser, and every write, RPC,
 * table change, edge function and storage call is answered without being sent. The read answers come from the
 * stage's sample. The inventory of RPCs is read from the app's own source (every supabase.rpc("...") name under src/),
 * so a new Declutter RPC is covered the day it is added.
 *
 * @mutate src/pages/admin/preview/declutterPreviewBackend.ts |       note("blocked");\n      o.onUnlisted?.(`rpc ${name}`); |       note("passed");\n      return o.realFetch(input, init);
 * @mutate src/pages/admin/preview/declutterPreviewBackend.ts |     if (table && (method === "GET" \|\| method === "HEAD")) { |     if (table) {\n      if (method !== "GET" && method !== "HEAD") return o.realFetch(input, init);
 * @mutate src/pages/admin/preview/declutterPreviewBackend.ts |     const fn = path.match(/^\/functions\/v1\/([^/]+)/)?.[1]; |     if (path.startsWith("/functions/")) return o.realFetch(input, init);\n    const fn = path.match(/^\/functions\/v1\/([^/]+)/)?.[1];
 * @mutate src/pages/admin/preview/declutterPreviewBackend.ts |       if (OWN_ROW_TABLES.has(table) && own && Array.from(u.searchParams.values()).some((v) => v === `eq.${own}`)) { |       if (OWN_ROW_TABLES.has(table)) {
 * @mutate src/pages/admin/preview/declutterPreviewBackend.ts |     case "declutter_my_cart": return s.cart; |     case "declutter_my_cart": return [];
 * @mutate src/App.tsx | <Route path="/admin/preview/declutter" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><AdminRoute><AdminDeclutterPreview /></AdminRoute></ProtectedRoute>)}</RouteErrorBoundary>} /> | <Route path="/admin/preview/declutter" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><AdminDeclutterPreview /></ProtectedRoute>)}</RouteErrorBoundary>} />
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";
import { createDeclutterPreviewFetch } from "@/pages/admin/preview/declutterPreviewBackend";
import { DECLUTTER_PREVIEW_STAGES, declutterPreviewSample } from "@/pages/admin/preview/declutterPreviewSamples";

const BASE = "https://unit.supabase.co";
const ADMIN = "00000000-0000-4000-a000-000000000001";
const READS = new Set(["declutter_my_cart", "declutter_my_offers", "declutter_my_paid_cents", "declutter_haul_away_state", "declutter_my_donations", "declutter_my_handover", "declutter_my_manager_grants", "get_safe_profiles"]);

function harness(stage: (typeof DECLUTTER_PREVIEW_STAGES)[number]["key"] = "paid", side: "buyer" | "seller" = "buyer") {
  const realFetch = vi.fn(async () => new Response("{}", { status: 200 }));
  const blocked: string[] = [];
  const sample = declutterPreviewSample(stage, side, ADMIN, Date.parse("2026-11-02T12:00:00Z"));
  const { fetch, log } = createDeclutterPreviewFetch({ supabaseUrl: BASE, sample: () => sample, ownUserId: () => ADMIN, realFetch: realFetch as unknown as typeof globalThis.fetch, onBlocked: (w) => blocked.push(w) });
  return { fetch, log, realFetch, blocked, sample };
}

/** Every supabase.rpc("name") the app's source calls. */
function rpcInventory(): string[] {
  const names = new Set<string>();
  for (const f of trackedFiles("src")) {
    if (!/\.(ts|tsx)$/.test(f) || /\.test\.|\/test\//.test(f)) continue;
    const src = blankComments(readFileSync(join(process.cwd(), f), "utf8"));
    for (const m of src.matchAll(/\.rpc\(\s*"([a-z0-9_]+)"/g)) names.add(m[1]);
  }
  return [...names].sort();
}

describe("Q2585: the admin Declutter stage preview sends nothing", () => {
  it("no RPC the app makes is sent: the listed reads come from the sample, every other one is answered unsent", async () => {
    const h = harness();
    const names = rpcInventory();
    expect(names.length).toBeGreaterThan(200);
    for (const name of names) {
      const res = await h.fetch(`${BASE}/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify({ p_order_id: "x" }) });
      expect(res.ok, name).toBe(true);
    }
    expect(h.realFetch).not.toHaveBeenCalled();
    const blockedRpcs = h.log.filter((l) => l.outcome === "blocked").length;
    // The sample's own reads (audit 1102c P1) answer from the sample too.
    const listed = new Set([...READS, ...Object.keys(h.sample.reads)]);
    expect(blockedRpcs).toBe(names.filter((n) => !listed.has(n)).length);
  });

  it("no write to any table, no edge function, no storage write is sent", async () => {
    const h = harness();
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      await h.fetch(`${BASE}/rest/v1/declutter_items?id=eq.1`, { method, body: "{}" });
      await h.fetch(`${BASE}/rest/v1/profiles?id=eq.${ADMIN}`, { method, body: "{}" });
    }
    await h.fetch(`${BASE}/functions/v1/declutter-checkout`, { method: "POST", body: "{}" });
    await h.fetch(`${BASE}/storage/v1/object/job-photos/x.jpg`, { method: "POST", body: "x" });
    await h.fetch(`${BASE}/storage/v1/object/public/job-photos/x.jpg`);
    expect(h.realFetch).not.toHaveBeenCalled();
    expect(h.log.length).toBe(11);
    expect(h.log.every((l) => l.outcome !== "passed")).toBe(true);
  });

  it("only sign-in traffic and the admin's own profile / role reads go out; another member's profile does not", async () => {
    const h = harness();
    await h.fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: "POST", body: "{}" });
    await h.fetch(`${BASE}/rest/v1/profiles?select=*&id=eq.${ADMIN}`);
    await h.fetch(`${BASE}/rest/v1/user_roles?select=role&user_id=eq.${ADMIN}`);
    expect(h.realFetch).toHaveBeenCalledTimes(3);
    await h.fetch(`${BASE}/rest/v1/profiles?select=*&id=eq.00000000-0000-4000-d000-000000000002`);
    await h.fetch(`${BASE}/rest/v1/declutter_orders?select=*`);
    expect(h.realFetch).toHaveBeenCalledTimes(3);
    // Not Supabase at all (the app's own files): untouched.
    await h.fetch("https://app.example/assets/x.js");
    expect(h.realFetch).toHaveBeenCalledTimes(4);
  });

  it("the Buying / Selling reads are answered from the stage's sample", async () => {
    const h = harness("booked", "seller");
    const cart = await (await h.fetch(`${BASE}/rest/v1/rpc/declutter_my_cart`, { method: "POST", body: "{}" })).json();
    expect(cart).toEqual(h.sample.cart);
    const bookings = await (await h.fetch(`${BASE}/rest/v1/declutter_bookings?select=*`)).json();
    expect(bookings).toEqual(h.sample.bookings);
    const orderId = h.sample.cart[0].order_id!;
    const ho = await (await h.fetch(`${BASE}/rest/v1/rpc/declutter_my_handover`, { method: "POST", body: JSON.stringify({ p_order_id: orderId }) })).json();
    expect(ho).toMatchObject({ order_id: orderId, side: "seller" });
    expect(h.realFetch).not.toHaveBeenCalled();
  });

  it("every stage builds on either side, the admin standing in on the side shown", () => {
    let built = 0;
    for (const { key } of DECLUTTER_PREVIEW_STAGES) {
      for (const side of ["buyer", "seller"] as const) {
        const s = declutterPreviewSample(key, side, ADMIN);
        for (const l of s.cart) {
          expect(l.my_side).toBe(side);
          expect(l.seller_id === ADMIN).toBe(side === "seller");
        }
        built++;
      }
    }
    // The stages the audit asked for (paid, booked, each handover type, handed over, refund, problem, haul-away, donation, cart).
    const keys = DECLUTTER_PREVIEW_STAGES.map((s) => s.key);
    for (const k of ["checkout", "paid", "booked", "porch", "meetup", "seller_delivery", "helpr_delivery", "handed_over", "refund", "problem", "haul_away", "donation"]) expect(keys).toContain(k);
    const handovers = new Set(DECLUTTER_PREVIEW_STAGES.flatMap((s) => declutterPreviewSample(s.key, "buyer", ADMIN).cart.map((l) => l.handover)).filter(Boolean));
    expect([...handovers].sort()).toEqual(["delivery", "meetup", "pickup_home", "porch", "seller_delivery"]);
    expect(built).toBeGreaterThan(20);
  });

  it("the route is admin-only (ProtectedRoute + AdminRoute) and lazy, outside boot", () => {
    const app = blankComments(readFileSync(join(process.cwd(), "src/App.tsx"), "utf8"));
    const route = app.split("\n").find((l) => l.includes('path="/admin/preview/declutter"'));
    expect(route, "the preview route exists").toBeTruthy();
    expect(route).toMatch(/<ProtectedRoute><AdminRoute><AdminDeclutterPreview \/><\/AdminRoute><\/ProtectedRoute>/);
    expect(app).toMatch(/const AdminDeclutterPreview = lazy\(\(\) => import\("\.\/pages\/admin\/preview\/DeclutterPreviewPage"\)\)/);
  });
});
