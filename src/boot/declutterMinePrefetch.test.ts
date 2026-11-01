/**
 * B81 (11-01): the entry starts /declutter's tab-row reads (my cart, my offers, my listings) beside the app download,
 * and fetchMyCart / fetchMyOffers / fetchMyItems each take that answer once instead of asking again. The prefetch is a
 * plain fetch (the entry must not import Supabase), so its URLs are hand-built; this builds the same reads with
 * supabase-js itself and requires the same URLs, so the copies cannot drift.
 */
// @mutate src/boot/declutterPrefetch.ts |   startDeclutterMinePrefetch(base, key, session); |
// @mutate src/lib/declutter/minePrefetchTake.ts |   s.taken.add(part); |
// @mutate src/lib/declutter/minePrefetchTake.ts |   if (!userId \|\| s.userId !== userId) return null; |   if (!userId) return null;
// @mutate src/lib/declutter/myReads.ts |   const prefetched = await takeMinePrefetch("cart", signedInUserId); |   const prefetched = null;
// @mutate src/lib/declutter/myReads.ts |   const prefetched = await takeMinePrefetch("items", userId); |   const prefetched = null;
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { ASKABLE_STATUSES, DECLUTTER_MINE_PREFETCH_KEY, declutterMineUrls, MY_ITEMS_SELECT, unansweredQuestionsUrl } from "./declutterMinePrefetch";
import { DECLUTTER_PREFETCH_KEY, startDeclutterPrefetch } from "./declutterPrefetch";
import { DECLUTTER_MINE_PREFETCH_MAX_AGE_MS, takeMinePrefetch, takeMineQuestions } from "@/lib/declutter/minePrefetchTake";
import { blankComments } from "@/test/helpers/blankNonCode";
import { walkSource } from "@/test/helpers/walkSource";

const db = vi.hoisted(() => ({ calls: [] as string[], uid: "11111111-2222-4333-8444-555555555555" as string | null }));
vi.mock("@/integrations/supabase/client", () => {
  const settle = (v: unknown) => Promise.resolve({ data: v, error: null, status: 200 });
  const chain = { select: () => chain, eq: () => chain, in: () => chain, is: () => chain, order: () => settle([{ id: "server" }]) };
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
    // B87 moved the member's own listings and cart reads to myReads.ts (api.ts re-exports them).
    const itemColumns = /const ITEM_COLUMNS =\s*"([^"]+)";/.exec(code("src/lib/declutter/myReads.ts"))?.[1];
    expect(itemColumns, "ITEM_COLUMNS found in myReads.ts").toBeTruthy();
    expect(MY_ITEMS_SELECT).toBe(`${itemColumns}, handovers`);
    const want = {
      cart: url(sb.rpc("declutter_my_cart")),
      offers: url(sb.rpc("declutter_my_offers")),
      items: url(sb.from("declutter_items").select(`${itemColumns}, handovers`).eq("seller_id", UID).order("created_at", { ascending: false })),
    };
    expect(declutterMineUrls(BASE, UID)).toEqual(want);
    // ...and the reads ask exactly those (the same chains in myReads.ts and api.ts).
    const mine = code("src/lib/declutter/myReads.ts");
    const src = code("src/lib/declutter/api.ts");
    expect(mine).toContain('supabase.from("declutter_items").select(`${cols}, handovers`).eq("seller_id", userId).order("created_at", { ascending: false })');
    expect(mine).toContain('await supabase.rpc("declutter_my_cart")');
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

/**
 * B82 (2026-11-01): with listings on sale the tab row also waits on the unanswered-questions read; it now starts from
 * the entry as soon as the listings answer (lab: Selling and Buying waited ~0.6 s on it after the app drew).
 *
 * @mutate src/lib/declutter/api.ts |   const prefetched = await takeMineQuestions(itemIds, signedInUserIdForQuestions);\n  if (prefetched) return prefetched as Pick<DeclutterQuestion, "id" \| "item_id" \| "question" \| "created_at">[]; |
 * @mutate src/boot/declutterMinePrefetch.ts | export const ASKABLE_STATUSES = ["live", "paused"]; | export const ASKABLE_STATUSES = ["live"];
 */
describe("the questions on the listings on sale start from the entry too (B82)", () => {
  const listed = (url: string) =>
    url.includes("declutter_questions") ? [{ id: "q1", item_id: "b" }]
    : url.includes("declutter_items") ? [{ id: "b", status: "live" }, { id: "a", status: "paused" }, { id: "c", status: "sold" }]
    : [];

  it("its URL is the one supabase-js builds for fetchUnansweredQuestions, over the same statuses", () => {
    const sb = createClient(BASE, "k");
    const ids = ["a", "b"];
    const want = (sb.from("declutter_questions").select("id, item_id, question, created_at").in("item_id", ids).is("answer", null).is("removed_at", null)
      .order("created_at", { ascending: true }) as unknown as { url: URL }).url.toString();
    expect(unansweredQuestionsUrl(BASE, ids)).toBe(want);
    const src = code("src/lib/declutter/api.ts");
    expect(src).toContain('.select("id, item_id, question, created_at")\n      .in("item_id", itemIds)\n      .is("answer", null)\n      .is("removed_at", null)\n      .order("created_at", { ascending: true })');
    const askable = /const ASKABLE = new Set\((\[[^\]]*\])\)/.exec(code("src/components/declutter/SellerQuestionsToAnswer.tsx"))?.[1];
    expect(JSON.parse(askable ?? "null")).toEqual(ASKABLE_STATUSES);
  });

  it("asks about the listings on sale, and fetchUnansweredQuestions takes it once with no server read", async () => {
    signIn();
    const f = answering(listed);
    vi.stubGlobal("fetch", f);
    startDeclutterPrefetch("/declutter");
    expect(await api.fetchUnansweredQuestions(["a", "b"])).toEqual([{ id: "q1", item_id: "b" }]);
    expect(db.calls, "no second read").toEqual([]);
    const asked = f.mock.calls.map((c) => String(c[0])).find((u) => u.includes("declutter_questions"));
    expect(asked).toBe(unansweredQuestionsUrl(BASE, ["a", "b"]));
    await api.fetchUnansweredQuestions(["a", "b"]);
    expect(db.calls, "a refetch reaches the server").toEqual(["declutter_questions"]);
  });

  it("other listings, another member, or nothing on sale: the page asks for itself", async () => {
    signIn();
    vi.stubGlobal("fetch", answering(listed));
    startDeclutterPrefetch("/declutter");
    expect(await takeMineQuestions(["a"], UID), "a different set of listings").toBeNull();
    startDeclutterPrefetch("/declutter");
    expect(await takeMineQuestions(["a", "b"], "someone-else")).toBeNull();
    await new Promise((r) => setTimeout(r, 0)); // the earlier starts' chained reads are done
    const f = answering((u) => (u.includes("declutter_items") ? [{ id: "c", status: "sold" }] : []));
    vi.stubGlobal("fetch", f);
    startDeclutterPrefetch("/declutter");
    expect(await takeMineQuestions(["c"], UID)).toBeNull();
    expect(f.mock.calls.some((c) => String(c[0]).includes("declutter_questions")), "nothing on sale, nothing asked").toBe(false);
  });
});
