/**
 * Q2705 (lead 11-07, option A): a guest's cold /declutter fires its own reads from the entry, and the page takes each
 * answer once. Live before (cwv-lab, prod, guest, Slow 4G + 4x, 375, 2026-11-07): LCP 13,280 ms on a serial chain
 * (gate RPC 6.3 s -> items 8.3 s -> photo rows 9.3 s -> images 10.3 s).
 */
// @mutate src/boot/declutterPrefetch.ts |     if (!anyStoredSession()) startGuestDeclutterPrefetch(base, key, location.search); |     startGuestDeclutterPrefetch(base, key, location.search);
// @mutate src/boot/declutterPrefetch.ts |     if (!anyStoredSession()) startGuestDeclutterPrefetch(base, key, location.search); |     void 0;
// @mutate src/boot/guestDeclutterPrefetch.ts |   u.searchParams.set("status", "in.(live,reserved)"); |   u.searchParams.set("status", "eq.live");
// @mutate src/boot/guestDeclutterPrefetch.ts |     if (!o?.includes("declutter")) return; |
// @mutate src/boot/guestDeclutterPrefetch.ts |     .then((a) => a?.items ?? fetch(guestItemsUrl(base), { headers }).then(json).then(list)) |     .then(() => fetch(guestItemsUrl(base), { headers }).then(json).then(list))
// @mutate src/boot/guestDeclutterPrefetch.ts |       return a && Array.isArray(a.items) && Array.isArray(a.photos) ? | return a && Array.isArray(a.items) ?
// @mutate src/boot/guestDeclutterPrefetch.ts |       const ok = !!p && Array.isArray(p.items) && Array.isArray(p.photos) && typeof p.more === "boolean"; |       const ok = !!p && Array.isArray(p.items);
// @mutate src/boot/guestDeclutterPrefetch.ts |   const items = preview.then((pre) => pre ? null : one | const items = preview.then(() => one
// @mutate src/boot/guestDeclutterPrefetch.ts |   const one = preview.then((pre) => pre ? null : fetch( | const one = preview.then(() => fetch(
// @mutate src/boot/guestDeclutterPrefetch.ts | items: pre?.items ?? i, photos: p | items: i, photos: p
// @mutate src/lib/declutter/guestBootPrefetch.ts |   const items = (await s.items) ?? (await s.preview)?.items; |   const items = await s.items;
// @mutate src/lib/declutter/guestBootPrefetch.ts |   if (!s?.preview \|\| now - s.at > GUEST_PREFETCH_MAX_AGE_MS \|\| !definitelyGuest()) return null; |   if (!s?.preview) return null;
// @mutate src/lib/declutter/guestBootPrefetch.ts |   if (rows.length !== wanted.size) return null; |
// @mutate src/lib/declutter/guestBootPrefetch.ts |   return claim("drops", now) ? rows : null; |   return rows;
// @mutate src/lib/declutter/guestBootPrefetch.ts | ({ description: "", ...(i as FirstScreenAnswer["items"][number]) }) | ({ ...(i as FirstScreenAnswer["items"][number]) })
// @mutate src/lib/declutter/api.ts | ?? ((await takeGuestDropStates(itemIds)) as | ?? ((null) as
// @mutate supabase/migrations/20261107212823_declutter_guest_preview.sql | SELECT i.id, i.seller_id, i.status, i.title, i.category, | SELECT i.id, i.seller_id, i.status, i.title, i.description, i.category,
// @mutate supabase/migrations/20261107212823_declutter_guest_preview.sql |     SELECT * FROM ranked ORDER BY live_at DESC LIMIT 24 |     SELECT * FROM ranked ORDER BY live_at DESC LIMIT 500
// @mutate supabase/migrations/20261107212823_declutter_guest_preview.sql | STABLE\nSECURITY INVOKER | STABLE\nSECURITY DEFINER
// @mutate src/boot/guestDeclutterPrefetch.ts |     preloadFirstCardPhotos(firstCardPhotoPreloads(base, { items: pre?.items ?? i, photos: p }, "")); |
// @mutate supabase/migrations/20261107172400_declutter_guest_first_screen.sql | STABLE\nSECURITY INVOKER | STABLE\nSECURITY DEFINER
// @mutate supabase/migrations/20261107172400_declutter_guest_first_screen.sql |            i.porch_ok, i.accepts_offers |            i.porch_ok
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
import { blankComments, blankSqlComments } from "@/test/helpers/blankNonCode";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";
import { ITEM_COLUMNS } from "@/lib/declutter/myReads";
import { startDeclutterPrefetch } from "./declutterPrefetch";
import { GUEST_DECLUTTER_PREFETCH_KEY, GUEST_ITEM_COLUMNS, GUEST_ITEMS_LIMIT, guestItemsUrl, guestPhotosUrl } from "./guestDeclutterPrefetch";
import { readGuestPreview, takeGuestDropStates, takeGuestItems, takeGuestPhotos, takeGuestSectionsOpen } from "@/lib/declutter/guestBootPrefetch";

const BASE = "https://x.supabase.co";
const ITEMS = [{ id: "a", seller_id: "s1" }, { id: "b", seller_id: "s2" }];
const PHOTOS = [{ id: "p1", item_id: "a", storage_path: "u/a.jpg", position: 0 }, { id: "p2", item_id: "b", storage_path: "u/b.jpg", position: 0 }];
const code = (p: string) => blankComments(readFileSync(p, "utf8"));

/**
 * Answers each guest read by its URL; records every request. `one` = the option B read's answer, `preview` =
 * declutter_guest_preview's (each absent: a 404, not deployed).
 */
function stubGuest({ open = ["declutter"] as unknown, items = ITEMS as unknown, photos = PHOTOS as unknown, one = undefined as unknown, preview = undefined as unknown } = {}) {
  const f = vi.fn((url: string, init?: RequestInit) => {
    void init;
    if (url.includes("/rpc/declutter_guest_preview")) {
      return Promise.resolve(preview === undefined ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(preview), { status: 200 }));
    }
    if (url.includes("/rpc/declutter_guest_first_screen")) {
      return Promise.resolve(one === undefined ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(one), { status: 200 }));
    }
    const body = url.includes("/rpc/features_open_to_everyone") ? open : url.includes("/declutter_item_photos") ? photos : items;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  vi.stubGlobal("fetch", f);
  vi.stubEnv("VITE_SUPABASE_URL", BASE);
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "k");
  return f;
}
const slot = () => (window as unknown as Record<string, { open: Promise<unknown>; preview: Promise<unknown>; items: Promise<unknown>; photos: Promise<unknown> } | undefined>)[GUEST_DECLUTTER_PREFETCH_KEY];
const settle = async () => {
  const s = slot();
  if (s) await Promise.all([s.open, s.preview, s.items, s.photos]);
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
  // Q2705 (lead 2026-11-07): the whole list was 67 KB gz (261 items with descriptions) and every card photo waited on it.
  it("the preview first: its top 24 (card columns), its photo rows and its drop columns; nothing handed over as the list", async () => {
    const PREVIEW_ITEMS = [{ id: "a", seller_id: "s1", sale_mode: "drops", last_price_drop_on: null, drop_pct: 10, drops_stopped: false }, { id: "b", seller_id: "s2", sale_mode: null, last_price_drop_on: null, drop_pct: 0, drops_stopped: false }];
    const f = stubGuest({ preview: { items: PREVIEW_ITEMS, photos: PHOTOS, more: true } });
    startDeclutterPrefetch("/declutter");
    await settle();
    const urls = f.mock.calls.map((c) => c[0] as string);
    // Neither the whole-list read nor the REST reads: Browse reads the full list itself, after the first photos.
    expect(urls).toEqual([`${BASE}/rest/v1/rpc/features_open_to_everyone`, `${BASE}/rest/v1/rpc/declutter_guest_preview`]);
    for (const [, init] of f.mock.calls) expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer k");
    const preview = await readGuestPreview();
    expect(preview?.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(preview?.items.every((i) => (i as unknown as { description: string }).description === "")).toBe(true);
    expect(preview?.near).toBeNull();
    expect(await readGuestPreview(), "read, never taken").not.toBeNull();
    expect(await takeGuestItems(), "the preview is never the list").toBeNull();
    expect(await takeGuestPhotos(["a", "b"])).toEqual(PHOTOS);
    expect(await takeGuestPhotos(["a"]), "taken once").toBeNull();
    expect(await takeGuestDropStates(["a", "z"]), "an item the preview lacks: the page reads").toBeNull();
    expect(await takeGuestDropStates(["a", "b"])).toEqual(PREVIEW_ITEMS);
    expect(await takeGuestDropStates(["a", "b"]), "taken once").toBeNull();
    // Its first photos preload from the preview.
    expect([...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]')].map((l) => l.href.replace(/^.*\/job-photos\/|\?.*$/g, ""))).toEqual(["u/a.jpg", "u/b.jpg"]);
  });

  it("a preview not in the expected shape is no preview: the whole-list read, as before", async () => {
    for (const preview of [{ items: ITEMS, photos: PHOTOS }, { items: ITEMS, more: true }, [1]]) {
      (window as unknown as Record<string, unknown>)[GUEST_DECLUTTER_PREFETCH_KEY] = undefined;
      stubGuest({ preview, one: { items: ITEMS, photos: PHOTOS } });
      startDeclutterPrefetch("/declutter");
      await settle();
      expect(await readGuestPreview(), JSON.stringify(preview)).toBeNull();
      expect(await takeGuestItems()).toEqual(ITEMS);
    }
  });

  it("a preview is handed to nobody signed in, nor when old", async () => {
    stubGuest({ preview: { items: ITEMS, photos: PHOTOS, more: false } });
    startDeclutterPrefetch("/declutter");
    await settle();
    expect(await readGuestPreview(Date.now() + 31_000)).toBeNull();
    localStorage.setItem("sb-x-auth-token", "{}");
    expect(await readGuestPreview()).toBeNull();
  });

  it("option B: the gate's answer and ONE read for the list and its photo rows, with the public key", async () => {
    const f = stubGuest({ one: { items: ITEMS, photos: PHOTOS } });
    startDeclutterPrefetch("/declutter");
    await settle();
    const urls = f.mock.calls.map((c) => c[0] as string);
    expect(urls).toEqual([`${BASE}/rest/v1/rpc/features_open_to_everyone`, `${BASE}/rest/v1/rpc/declutter_guest_preview`, `${BASE}/rest/v1/rpc/declutter_guest_first_screen`]);
    for (const [, init] of f.mock.calls) {
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer k");
    }
    expect(await takeGuestItems()).toEqual(ITEMS);
    expect(await takeGuestPhotos(["a", "b"])).toEqual(PHOTOS);
  });

  it("not deployed (404) or malformed: the page's own REST reads, the photo rows after the list (option A)", async () => {
    for (const one of [undefined, { items: ITEMS }]) {
      (window as unknown as Record<string, unknown>)[GUEST_DECLUTTER_PREFETCH_KEY] = undefined;
      const f = stubGuest({ one });
      startDeclutterPrefetch("/declutter");
      await settle();
      const urls = f.mock.calls.map((c) => c[0] as string);
      expect(urls).toEqual([
        `${BASE}/rest/v1/rpc/features_open_to_everyone`,
        `${BASE}/rest/v1/rpc/declutter_guest_preview`,
        `${BASE}/rest/v1/rpc/declutter_guest_first_screen`,
        guestItemsUrl(BASE),
        guestPhotosUrl(BASE, ["a", "b"]),
      ]);
      for (const [, init] of f.mock.calls) expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer k");
      expect(await takeGuestItems()).toEqual(ITEMS);
    }
  });

  it("the one read answers fetchLiveItems' columns and fetchPhotos' columns, from its newest definition", () => {
    const sql = blankSqlComments(effectiveDefs("supabase/migrations").get("declutter_guest_first_screen")?.stmt ?? "");
    expect(sql).toContain("SECURITY INVOKER");
    const selected = (sql.match(/SELECT (i\.id,[\s\S]*?)\s+FROM public\.declutter_items i/)?.[1] ?? "").split(",").map((c) => c.trim().replace(/^i\./, ""));
    expect(selected.length).toBeGreaterThan(10);
    expect(selected).toEqual(ITEM_COLUMNS.split(", "));
    expect(sql).toMatch(/WHERE i\.status IN \('live', 'reserved'\)\s+ORDER BY i\.live_at DESC\s+LIMIT 500/);
    expect(sql).toMatch(/jsonb_build_object\('id', p\.id, 'item_id', p\.item_id, 'storage_path', p\.storage_path, 'position', p\.position\)/);
  });

  // Q2705 (11-07). PGlite proof of its rows, `more`, policies and grants: src/test/pglite/declutterGuestPreview.pglite.mjs.
  it("the preview answers fetchLiveItems' columns less the description, plus fetchDropStates' columns, from its newest definition", () => {
    const sql = blankSqlComments(effectiveDefs("supabase/migrations").get("declutter_guest_preview")?.stmt ?? "");
    expect(sql).toContain("SECURITY INVOKER");
    const selected = (sql.match(/SELECT (i\.id,[\s\S]*?)\s+FROM public\.declutter_items i/)?.[1] ?? "").split(",").map((c) => c.trim().replace(/^i\./, ""));
    expect(selected.length).toBeGreaterThan(10);
    const DROPS = ["sale_mode", "last_price_drop_on", "drop_pct", "drops_stopped"];
    expect(selected).toEqual([...ITEM_COLUMNS.split(", ").filter((c) => c !== "description"), ...DROPS]);
    expect(sql).toMatch(/WHERE i\.status IN \('live', 'reserved'\)\s+ORDER BY i\.live_at DESC\s+LIMIT 25/);
    expect(sql).toMatch(/SELECT \* FROM ranked ORDER BY live_at DESC LIMIT 24/);
    expect(sql).toMatch(/jsonb_build_object\('id', p\.id, 'item_id', p\.item_id, 'storage_path', p\.storage_path, 'position', p\.position\)/);
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
    expect(code("src/lib/declutter/api.ts")).toContain("await takeGuestDropStates(itemIds)");
    expect(code("src/components/landing/useSectionsOpen.ts")).toContain("await takeGuestSectionsOpen()");
    expect(code("src/lib/declutter/guestBootPrefetch.ts")).toContain(`const KEY = "${GUEST_DECLUTTER_PREFETCH_KEY}";`);
    // The guest gate does not wait for auth to settle when the visitor is provably a guest.
    expect(code("src/components/declutter/declutterUi.tsx")).toContain("if (!isReady && !definitelyGuest()) return <>{skeleton}</>;");
  });
});
