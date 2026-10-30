import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { blankComments } from "@/test/helpers/blankNonCode";

import { DECLUTTER_PREFETCH_KEY, declutterItemsRestUrl, declutterPhotosRestUrl, startDeclutterPrefetch } from "./declutterPrefetch";
import { takeDeclutterItemsPrefetch, takeDeclutterPhotosPrefetch } from "@/lib/declutter/bootPrefetch";

// @mutate src/boot/declutterPrefetch.ts | u.searchParams.set("order", "live_at.desc"); | u.searchParams.set("order", "created_at.desc");
// @mutate src/boot/declutterPrefetch.ts | return session.expires_at - nowS > MIN_TOKEN_LIFE_S ? session.access_token : null; | return session.access_token;
// @mutate src/boot/declutterPrefetch.ts | if (path !== "/declutter" \|\| typeof fetch !== "function") return; | if (typeof fetch !== "function") return;
// @mutate src/lib/declutter/api.ts | const prefetched = await takeDeclutterItemsPrefetch(); | const prefetched = null;
// @mutate src/lib/declutter/bootPrefetch.ts |   p.items = undefined; |
// @mutate src/lib/declutter/bootPrefetch.ts |   if (!itemIds.every((id) => covered.has(id))) return null; |
// @mutate src/entry.ts | .then((m) => m.startDeclutterPrefetch(window.location.pathname)) | .then(() => undefined)

const BASE = "https://x.supabase.co";
const client = () => {
  const urls: string[] = [];
  const db = createClient(BASE, "k", {
    auth: { persistSession: false },
    global: { fetch: ((u: string) => { urls.push(String(u)); return Promise.resolve(new Response("[]", { status: 200 })); }) as typeof fetch },
  });
  return { db, urls };
};
const session = (expiresInS: number) => JSON.stringify({ access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + expiresInS });
const norm = (u: string) => {
  const url = new URL(u);
  return `${url.pathname}?${[...url.searchParams.entries()].map(([k, v]) => `${k}=${v}`).sort().join("&")}`;
};

afterEach(() => {
  (window as unknown as Record<string, unknown>)[DECLUTTER_PREFETCH_KEY] = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
});

const stubFetch = (itemRows: unknown[] = [{ id: "a" }, { id: "b" }], photoRows: unknown[] = [{ item_id: "a" }, { item_id: "b" }]) => {
  const f = vi.fn((u: string) => Promise.resolve(new Response(JSON.stringify(String(u).includes("declutter_item_photos") ? photoRows : itemRows), { status: 200 })));
  vi.stubGlobal("fetch", f);
  vi.stubEnv("VITE_SUPABASE_URL", BASE);
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "k");
  return f;
};

describe("the entry's /declutter prefetch", () => {
  it("asks for exactly what the page's items read asks for", async () => {
    const { db, urls } = client();
    await db.from("declutter_items")
      .select("id, seller_id, status, title, description, category, condition_stars, delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng, created_at, live_at, porch_ok, accepts_offers")
      .in("status", ["live", "reserved"]).order("live_at", { ascending: false }).limit(500);
    expect(norm(declutterItemsRestUrl(BASE))).toBe(norm(urls[0]));
  });

  it("asks for exactly what the page's photos read asks for", async () => {
    const { db, urls } = client();
    await db.from("declutter_item_photos").select("id, item_id, storage_path, position").in("item_id", ["a", "b"]).order("position", { ascending: true });
    expect(norm(declutterPhotosRestUrl(BASE, ["a", "b"]))).toBe(norm(urls[0]));
  });

  it("starts on a cold /declutter with a live session, sending that session, and hands over once", async () => {
    const f = stubFetch();
    localStorage.setItem("sb-x-auth-token", session(3600));
    startDeclutterPrefetch("/declutter");
    expect(f.mock.calls.length).toBeGreaterThan(0);
    const init = (f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1];
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(await takeDeclutterItemsPrefetch()).toEqual([{ id: "a" }, { id: "b" }]);
    expect(takeDeclutterItemsPrefetch()).toBeNull();
    expect(await takeDeclutterPhotosPrefetch(["a"])).toEqual([{ item_id: "a" }]);
    expect(await takeDeclutterPhotosPrefetch(["a"])).toBeNull();
  });

  it("does nothing signed out, on another page, or with a session near expiry or malformed", () => {
    const f = stubFetch();
    startDeclutterPrefetch("/declutter");
    localStorage.setItem("sb-x-auth-token", session(3600));
    startDeclutterPrefetch("/home");
    localStorage.setItem("sb-x-auth-token", session(10));
    startDeclutterPrefetch("/declutter");
    localStorage.setItem("sb-x-auth-token", "not json");
    startDeclutterPrefetch("/declutter");
    expect(f).not.toHaveBeenCalled();
  });

  it("a failed read hands nothing over, so the page asks for itself", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 401 }))));
    vi.stubEnv("VITE_SUPABASE_URL", BASE);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "k");
    localStorage.setItem("sb-x-auth-token", session(3600));
    startDeclutterPrefetch("/declutter");
    expect(await takeDeclutterItemsPrefetch()).toBeNull();
    expect(await takeDeclutterPhotosPrefetch(["a"])).toBeNull();
  });

  it("photos it did not cover are left to the page", async () => {
    stubFetch();
    localStorage.setItem("sb-x-auth-token", session(3600));
    startDeclutterPrefetch("/declutter");
    expect(await takeDeclutterPhotosPrefetch(["a", "not-in-the-prefetch"])).toBeNull();
  });

  it("the entry starts it and the page's two reads take it", () => {
    const code = (p: string) => blankComments(readFileSync(p, "utf8"));
    expect(code("src/entry.ts")).toContain(".then((m) => m.startDeclutterPrefetch(window.location.pathname))");
    const api = code("src/lib/declutter/api.ts");
    expect(api).toContain("const prefetched = await takeDeclutterItemsPrefetch();");
    expect(api).toContain("const prefetched = await takeDeclutterPhotosPrefetch(itemIds);");
  });

  it("an old prefetch is not handed out", () => {
    stubFetch();
    localStorage.setItem("sb-x-auth-token", session(3600));
    startDeclutterPrefetch("/declutter");
    expect(takeDeclutterItemsPrefetch(Date.now() + 60_000)).toBeNull();
  });
});
