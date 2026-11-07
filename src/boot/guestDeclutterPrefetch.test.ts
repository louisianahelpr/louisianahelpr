/**
 * Q2705 (lead 11-07, option A): a guest's cold /declutter fires its own reads from the entry, and the page takes each
 * answer once. Live before (cwv-lab, prod, guest, Slow 4G + 4x, 375, 2026-11-07): LCP 13,280 ms on a serial chain
 * (gate RPC 6.3 s -> items 8.3 s -> photo rows 9.3 s -> images 10.3 s).
 */
// @mutate src/boot/declutterPrefetch.ts |     if (!anyStoredSession()) startGuestDeclutterPrefetch(base, key, location.search); |     startGuestDeclutterPrefetch(base, key, location.search);
// @mutate src/boot/declutterPrefetch.ts |     if (!anyStoredSession()) startGuestDeclutterPrefetch(base, key, location.search); |     void 0;
// @mutate src/boot/guestDeclutterPrefetch.ts |   u.searchParams.set("status", "in.(live,reserved)"); |   u.searchParams.set("status", "eq.live");
// @mutate src/boot/guestDeclutterPrefetch.ts |     if (!o?.includes("declutter")) return; |
// @mutate src/lib/declutter/guestBootPrefetch.ts |   if (!s \|\| now - s.at > GUEST_PREFETCH_MAX_AGE_MS \|\| !definitelyGuest()) return null; |   if (!s) return null;
// @mutate src/lib/declutter/guestBootPrefetch.ts |   if (s.taken.has(part)) return null; |
// @mutate src/lib/declutter/guestBootPrefetch.ts |   if (!itemIds.every((id) => covered.has(id))) return null; |
// @mutate src/lib/declutter/api.ts |   const guest = await takeGuestItems(); |   const guest = null;
// @mutate src/lib/declutter/api.ts |   const guest = await takeGuestPhotos(itemIds); |   const guest = null;
// @mutate src/components/landing/useSectionsOpen.ts |     const fromBoot = await takeGuestSectionsOpen(); |     const fromBoot = null;
// @mutate src/components/declutter/declutterUi.tsx |   if (!isReady && !definitelyGuest()) return <>{skeleton}</>; |   if (!isReady) return <>{skeleton}</>;
// @mutate src/entry.ts | } else if (/^\/declutter(\/item\/[\w-]+)?\/?$/.test(window.location.pathname)) { | } else if (/^\/declutter\/item\/[\w-]+\/?$/.test(window.location.pathname)) {
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { blankComments } from "@/test/helpers/blankNonCode";
import { ITEM_COLUMNS } from "@/lib/declutter/myReads";
import { startDeclutterPrefetch } from "./declutterPrefetch";
import { GUEST_DECLUTTER_PREFETCH_KEY, GUEST_ITEM_COLUMNS, GUEST_ITEMS_LIMIT, guestItemsUrl, guestPhotosUrl } from "./guestDeclutterPrefetch";
import { takeGuestItems, takeGuestPhotos, takeGuestSectionsOpen } from "@/lib/declutter/guestBootPrefetch";

const BASE = "https://x.supabase.co";
const ITEMS = [{ id: "a", seller_id: "s1" }, { id: "b", seller_id: "s2" }];
const PHOTOS = [{ id: "p1", item_id: "a", storage_path: "u/a.jpg", position: 0 }, { id: "p2", item_id: "b", storage_path: "u/b.jpg", position: 0 }];
const code = (p: string) => blankComments(readFileSync(p, "utf8"));

/** Answers each guest read by its URL; records every request. */
function stubGuest({ open = ["declutter"] as unknown, items = ITEMS as unknown, photos = PHOTOS as unknown } = {}) {
  const f = vi.fn((url: string, init?: RequestInit) => {
    void init;
    const body = url.includes("/rpc/features_open_to_everyone") ? open : url.includes("/declutter_item_photos") ? photos : items;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  vi.stubGlobal("fetch", f);
  vi.stubEnv("VITE_SUPABASE_URL", BASE);
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "k");
  return f;
}
const slot = () => (window as unknown as Record<string, { open: Promise<unknown>; items: Promise<unknown>; photos: Promise<unknown> } | undefined>)[GUEST_DECLUTTER_PREFETCH_KEY];
const settle = async () => {
  const s = slot();
  if (s) await Promise.all([s.open, s.items, s.photos]);
  await new Promise((r) => setTimeout(r, 0));
};

afterEach(() => {
  (window as unknown as Record<string, unknown>)[GUEST_DECLUTTER_PREFETCH_KEY] = undefined;
  document.head.querySelectorAll('link[rel="preload"][as="image"]').forEach((l) => l.remove());
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe("a guest's cold /declutter starts its reads from the entry (Q2705)", () => {
  it("asks the page's own three reads with the public key: the gate's answer, the live list, then its photo rows", async () => {
    const f = stubGuest();
    startDeclutterPrefetch("/declutter");
    await settle();
    const urls = f.mock.calls.map((c) => c[0] as string);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toBe(`${BASE}/rest/v1/rpc/features_open_to_everyone`);
    expect(f.mock.calls[0][1]?.method).toBe("POST");
    expect(urls[1]).toBe(guestItemsUrl(BASE));
    expect(urls[2]).toBe(guestPhotosUrl(BASE, ["a", "b"]));
    for (const [, init] of f.mock.calls) expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });

  it("asks exactly what fetchLiveItems and fetchPhotos ask (same table, filters, order, limit and columns)", () => {
    expect(GUEST_ITEM_COLUMNS).toBe(ITEM_COLUMNS);
    const rest = createClient(BASE, "k", { auth: { persistSession: false, autoRefreshToken: false } });
    const items = rest.from("declutter_items").select(ITEM_COLUMNS).in("status", ["live", "reserved"]).order("live_at", { ascending: false }).limit(GUEST_ITEMS_LIMIT);
    expect(guestItemsUrl(BASE)).toBe((items as unknown as { url: URL }).url.toString());
    const photos = rest.from("declutter_item_photos").select("id, item_id, storage_path, position").in("item_id", ["a", "b"]).order("position", { ascending: true });
    expect(guestPhotosUrl(BASE, ["a", "b"])).toBe((photos as unknown as { url: URL }).url.toString());
    // ...and the app's reads still are those (api.ts).
    const api = code("src/lib/declutter/api.ts");
    expect(api).toMatch(/\.from\("declutter_items"\)\s*\.select\(cols\)\s*\.in\("status", \["live", "reserved"\]\)\s*\.order\("live_at", \{ ascending: false \}\)\s*\.limit\(500\)/);
    expect(api).toMatch(/\.from\("declutter_item_photos"\)\s*\.select\("id, item_id, storage_path, position"\)\s*\.in\("item_id", itemIds\)\s*\.order\("position", \{ ascending: true \}\)/);
  });

  it("does nothing for a stored session of any kind (a member reads as the member), or on another page", async () => {
    const f = stubGuest();
    localStorage.setItem("sb-x-auth-token", JSON.stringify({ access_token: "t", expires_at: 1, user: { id: "me" } }));
    startDeclutterPrefetch("/declutter");
    localStorage.clear();
    startDeclutterPrefetch("/declutter/sell");
    startDeclutterPrefetch("/home");
    await settle();
    expect(f).not.toHaveBeenCalled();
    expect(slot()).toBeUndefined();
  });

  it("each answer is taken once, fresh, and only while nobody is signed in", async () => {
    stubGuest();
    startDeclutterPrefetch("/declutter");
    expect(await takeGuestSectionsOpen()).toEqual(["declutter"]);
    expect(await takeGuestSectionsOpen()).toBeNull();
    expect(await takeGuestItems(Date.now() + 31_000)).toBeNull(); // old
    localStorage.setItem("sb-x-auth-token", "{}");
    expect(await takeGuestItems()).toBeNull(); // someone signed in since
    localStorage.clear();
    expect(await takeGuestItems()).toEqual(ITEMS);
    expect(await takeGuestItems()).toBeNull();
  });

  it("photo rows go only to a read the list covered, filtered to the items asked", async () => {
    stubGuest();
    startDeclutterPrefetch("/declutter");
    expect(await takeGuestPhotos(["a", "zzz"])).toBeNull(); // an item the list did not hold: not used up
    expect(await takeGuestPhotos(["b"])).toEqual([PHOTOS[1]]);
    expect(await takeGuestPhotos(["a"])).toBeNull(); // taken
  });

  it("a failed read hands nothing over", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("nope", { status: 500 }))));
    vi.stubEnv("VITE_SUPABASE_URL", BASE);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "k");
    startDeclutterPrefetch("/declutter");
    expect(await takeGuestSectionsOpen()).toBeNull();
    expect(await takeGuestItems()).toBeNull();
    expect(await takeGuestPhotos(["a"])).toBeNull();
  });

  it("preloads the first row's photos when Declutter is open to everyone and the link opens on Browse; never otherwise", async () => {
    stubGuest();
    startDeclutterPrefetch("/declutter");
    await settle();
    const hrefs = () => [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]')].map((l) => l.href);
    expect(hrefs()).toEqual([
      `${BASE}/storage/v1/render/image/public/job-photos/u/a.jpg?width=480&height=480&resize=cover&quality=70`,
      `${BASE}/storage/v1/render/image/public/job-photos/u/b.jpg?width=480&height=480&resize=cover&quality=70`,
    ]);
    document.head.querySelectorAll('link[rel="preload"][as="image"]').forEach((l) => l.remove());
    stubGuest({ open: [] }); // not open to everyone: the guest gets the login wall, no cards
    startDeclutterPrefetch("/declutter");
    await settle();
    expect(hrefs()).toEqual([]);
  });

  it("the entry reaches the door for a guest's /declutter, and the page takes every answer", () => {
    const entry = code("src/entry.ts");
    const gate = /\} else if \((\/\^\\\/declutter.*\/)\.test\(window\.location\.pathname\)\)/.exec(entry)?.[1];
    expect(gate).toBeTruthy();
    expect((new Function(`return ${gate}`)() as RegExp).test("/declutter")).toBe(true);
    expect(code("src/lib/declutter/api.ts")).toContain("await takeGuestItems()");
    expect(code("src/lib/declutter/api.ts")).toContain("await takeGuestPhotos(itemIds)");
    expect(code("src/components/landing/useSectionsOpen.ts")).toContain("await takeGuestSectionsOpen()");
    expect(code("src/lib/declutter/guestBootPrefetch.ts")).toContain(`const KEY = "${GUEST_DECLUTTER_PREFETCH_KEY}";`);
    // The guest gate does not wait for auth to settle when the visitor is provably a guest.
    expect(code("src/components/declutter/declutterUi.tsx")).toContain("if (!isReady && !definitelyGuest()) return <>{skeleton}</>;");
  });
});
