/**
 * B81 (11-01): the entry starts /declutter's tab-row reads (my cart, my offers, my listings) beside the app download,
 * and fetchMyCart / fetchMyOffers / fetchMyItems each take that answer once instead of asking again. The prefetch is a
 * plain fetch (the entry must not import Supabase), so its URLs are hand-built; this builds the same reads with
 * supabase-js itself and requires the same URLs, so the copies cannot drift.
 */
// @mutate src/boot/declutterPrefetch.ts |   startDeclutterMinePrefetch(base, key, session); |
// @mutate src/lib/declutter/minePrefetchTake.ts |   s.taken.add(part); |
// @mutate src/lib/declutter/minePrefetchTake.ts |   if (!userId \|\| s.userId !== userId) return null; |   if (!userId) return null;
// @mutate src/lib/declutter/api.ts |   const prefetched = await takeMinePrefetch("cart", signedInUserId); |   const prefetched = null;
// @mutate src/lib/declutter/api.ts |   const prefetched = await takeMinePrefetch("items", userId); |   const prefetched = null;
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { DECLUTTER_MINE_PREFETCH_KEY, declutterMineUrls, MY_ITEMS_SELECT } from "./declutterMinePrefetch";
import { DECLUTTER_PREFETCH_KEY, startDeclutterPrefetch } from "./declutterPrefetch";
import { DECLUTTER_MINE_PREFETCH_MAX_AGE_MS, takeMinePrefetch } from "@/lib/declutter/minePrefetchTake";
import { blankComments } from "@/test/helpers/blankNonCode";
import { walkSource } from "@/test/helpers/walkSource";

const db = vi.hoisted(() => ({ calls: [] as string[], uid: "11111111-2222-4333-8444-555555555555" as string | null }));
vi.mock("@/integrations/supabase/client", () => {
  const settle = (v: unknown) => Promise.resolve({ data: v, error: null, status: 200 });
  const chain = { select: () => chain, eq: () => chain, order: () => settle([{ id: "server" }]) };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: db.uid ? { user: { id: db.uid } } : null } }) },
      rpc: (fn: string) => { db.calls.push(fn); return settle([{ id: "server" }]); },
      from: (t: string) => { db.calls.push(t); return chain; },
    },
  };
});
const api = await import("@/lib/declutter/api");

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const UID = "11111111-2222-4333-8444-555555555555";
const BASE = "https://proj.supabase.co";
const session = (expiresInS: number, id = UID) =>
  JSON.stringify({ access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + expiresInS, user: { id } });
/** A fetch answering every read with `body` (the first-screen read included; it is not under test here). */
const answering = (body: (url: string) => unknown, ok = true) =>
  vi.fn(async (url: string) => ({ ok, json: async () => body(url) }) as unknown as Response);
const rows = (url: string) => (url.includes("declutter_my_cart") ? [{ line: "c" }] : url.includes("declutter_my_offers") ? [{ offer: "o" }] : url.includes("declutter_items") ? [{ id: "i" }] : {});

afterEach(() => {
  const w = window as unknown as Record<string, unknown>;
  w[DECLUTTER_MINE_PREFETCH_KEY] = undefined;
  w[DECLUTTER_PREFETCH_KEY] = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
  db.calls.length = 0;
  db.uid = UID;
});

function signIn(expiresInS = 3600, id = UID) {
  vi.stubEnv("VITE_SUPABASE_URL", BASE);
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
  localStorage.setItem("sb-proj-auth-token", session(expiresInS, id));
}

describe("/declutter's tab-row reads start from the entry (B81)", () => {
  it("its URLs are the ones supabase-js builds for fetchMyCart, fetchMyOffers and fetchMyItems", () => {
    const sb = createClient(BASE, "k");
    const url = (q: unknown) => (q as { url: URL }).url.toString();
    const itemColumns = /const ITEM_COLUMNS =\s*"([^"]+)";/.exec(code("src/lib/declutter/api.ts"))?.[1];
    expect(itemColumns, "ITEM_COLUMNS found in api.ts").toBeTruthy();
    expect(MY_ITEMS_SELECT).toBe(`${itemColumns}, handovers`);
    const want = {
      cart: url(sb.rpc("declutter_my_cart")),
      offers: url(sb.rpc("declutter_my_offers")),
      items: url(sb.from("declutter_items").select(`${itemColumns}, handovers`).eq("seller_id", UID).order("created_at", { ascending: false })),
    };
    expect(declutterMineUrls(BASE, UID)).toEqual(want);
    // ...and the reads ask exactly those (the same chains in api.ts).
    const src = code("src/lib/declutter/api.ts");
    expect(src).toContain('supabase.from("declutter_items").select(`${cols}, handovers`).eq("seller_id", userId).order("created_at", { ascending: false })');
    expect(src).toContain('await supabase.rpc("declutter_my_cart")');
    expect(src).toContain('await supabase.rpc("declutter_my_offers")');
  });

  it("only the first-screen boot module starts it, and only the entry reaches that", () => {
    expect(code("src/boot/declutterPrefetch.ts")).toContain("startDeclutterMinePrefetch(base, key, session);");
    expect(code("src/lib/declutter/minePrefetchTake.ts")).toContain(`const KEY = "${DECLUTTER_MINE_PREFETCH_KEY}";`);
    const importers = walkSource([resolve(ROOT, "src")])
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => /(from ["']|import\(["'])[^"']*declutterMinePrefetch["']/.test(code(f.replace(ROOT + "/", ""))))
      .map((f) => f.replace(ROOT + "/", ""));
    expect(importers).toEqual(["src/boot/declutterPrefetch.ts"]);
  });

  it("fires for a member on any /declutter tab, never for a guest, another route or an expiring session", () => {
    const f = answering(rows);
    vi.stubGlobal("fetch", f);
    vi.stubEnv("VITE_SUPABASE_URL", BASE);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
    startDeclutterPrefetch("/declutter");
    expect(f, "guest").not.toHaveBeenCalled();
    signIn(30);
    startDeclutterPrefetch("/declutter");
    expect(f, "a token with under a minute left is supabase-js's to refresh").not.toHaveBeenCalled();
    localStorage.clear();
    signIn();
    for (const p of ["/", "/home", "/declutter/item/x", "/declutter/sell"]) startDeclutterPrefetch(p);
    expect(f, "other routes").not.toHaveBeenCalled();
    startDeclutterPrefetch("/declutter");
    const urls = f.mock.calls as unknown as [string, RequestInit][];
    const mine = declutterMineUrls(BASE, UID);
    for (const u of [mine.cart, mine.offers, mine.items]) {
      const hit = urls.find(([x]) => x === u);
      expect(hit, u).toBeTruthy();
      expect((hit![1].headers as Record<string, string>).Authorization).toBe("Bearer tok");
    }
    expect(urls.filter(([u]) => u === mine.cart)[0][1].method).toBe("POST");
  });

  it("hands each read out once, to the member it was read for", async () => {
    signIn();
    vi.stubGlobal("fetch", answering(rows));
    startDeclutterPrefetch("/declutter");
    expect(await takeMinePrefetch("cart", "someone-else"), "another member's answer").toBeNull();
    expect(await takeMinePrefetch("cart", UID)).toEqual([{ line: "c" }]);
    expect(await takeMinePrefetch("cart", UID), "a second take (a refetch) must reach the server").toBeNull();
    expect(await takeMinePrefetch("offers", async () => UID)).toEqual([{ offer: "o" }]);
    expect(await takeMinePrefetch("items", UID)).toEqual([{ id: "i" }]);
  });

  it("a failed, odd or old answer hands out nothing, so the read asks for itself", async () => {
    signIn();
    const cases: [string, ReturnType<typeof vi.fn>][] = [
      ["refused", answering(rows, false)],
      ["an error body, not a list", answering(() => ({ message: "x" }))],
      ["offline", vi.fn(async () => { throw new TypeError("Failed to fetch"); })],
    ];
    expect(cases.length).toBeGreaterThan(2);
    for (const [why, f] of cases) {
      vi.stubGlobal("fetch", f);
      startDeclutterPrefetch("/declutter");
      for (const part of ["cart", "offers", "items"] as const) expect(await takeMinePrefetch(part, UID), `${why} ${part}`).toBeNull();
    }
    vi.stubGlobal("fetch", answering(rows));
    startDeclutterPrefetch("/declutter");
    expect(await takeMinePrefetch("cart", UID, Date.now() + DECLUTTER_MINE_PREFETCH_MAX_AGE_MS + 1), "old").toBeNull();
  });

  it("fetchMyCart, fetchMyOffers and fetchMyItems take the answer and ask Supabase nothing; the next call asks", async () => {
    signIn();
    vi.stubGlobal("fetch", answering(rows));
    startDeclutterPrefetch("/declutter");
    expect(await api.fetchMyCart()).toEqual([{ line: "c" }]);
    expect(await api.fetchMyOffers()).toEqual([{ offer: "o" }]);
    expect(await api.fetchMyItems(UID)).toEqual([{ id: "i" }]);
    expect(db.calls, "no double read").toEqual([]);
    await api.fetchMyCart();
    await api.fetchMyItems(UID);
    expect(db.calls).toEqual(["declutter_my_cart", "declutter_items"]);
  });

  it("another member signed in by then: the reads ask the server", async () => {
    signIn();
    vi.stubGlobal("fetch", answering(rows));
    startDeclutterPrefetch("/declutter");
    db.uid = "someone-else";
    await api.fetchMyCart();
    await api.fetchMyItems("someone-else");
    expect(db.calls).toEqual(["declutter_my_cart", "declutter_items"]);
  });
});
