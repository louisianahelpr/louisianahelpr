/**
 * B100 (11-04, Q2708): a cold Declutter item page starts its item row and photo rows from the entry, and preloads the
 * first photo with the gallery's exact src/srcset/sizes; fetchItem and fetchPhotos take those answers once. The
 * prefetch is a plain fetch (the entry must not import Supabase), so its URLs and photo sizes are hand-built copies;
 * this builds the same reads with supabase-js and reads the originals, so the copies cannot drift.
 */
// @mutate src/boot/signedInPrefetch.ts |   startDeclutterItemPrefetch(pathname); |
// @mutate src/lib/declutter/itemPrefetchTake.ts |   s.taken.add(part); |
// @mutate src/lib/declutter/itemPrefetchTake.ts |   if (!userId \|\| userId !== s.userId) return undefined; |   if (!userId) return undefined;
// @mutate src/lib/declutter/itemPrefetchTake.ts | s.itemId !== itemId \|\| | false \|\|
// @mutate src/lib/declutter/api.ts |   const prefetched = await takeItemPrefetch(itemId, sessionUserId); |   const prefetched = undefined;
// @mutate src/lib/declutter/api.ts |   if (bootItem) return bootItem as DeclutterPhoto[]; |
// @mutate src/boot/declutterItemPrefetch.ts | export const GALLERY_SIZES = "(min-width: 640px) 680px, calc(100vw - 40px)"; | export const GALLERY_SIZES = "100vw";
// @mutate src/entry.ts | declutter(\/item\/[\w-]+)?\|home | declutter\|home
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { DECLUTTER_ITEM_PREFETCH_KEY, declutterItemUrls, firstGalleryPhoto, GALLERY_SIZES, ITEM_SELECT, startDeclutterItemPrefetch } from "./declutterItemPrefetch";
import { DECLUTTER_ITEM_PREFETCH_MAX_AGE_MS, takeItemPhotosPrefetch, takeItemPrefetch } from "@/lib/declutter/itemPrefetchTake";
import { pagePhoto } from "@/lib/declutter/pagePhoto";
import { blankComments } from "@/test/helpers/blankNonCode";
import { walkSource } from "@/test/helpers/walkSource";

const db = vi.hoisted(() => ({ calls: [] as string[], uid: "11111111-2222-4333-8444-555555555555" as string | null }));
vi.mock("@/integrations/supabase/client", () => {
  const settle = (v: unknown) => Promise.resolve({ data: v, error: null, status: 200 });
  const chain = { select: () => chain, eq: () => chain, in: () => chain, order: () => settle([{ id: "server-photo" }]), maybeSingle: () => settle({ id: "server-item" }) };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: db.uid ? { user: { id: db.uid } } : null } }) },
      from: (t: string) => { db.calls.push(t); return chain; },
      storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/job-photos/${p}` } }) }) },
    },
  };
});
const api = await import("@/lib/declutter/api");

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const UID = "11111111-2222-4333-8444-555555555555";
const ITEM = "80a8beec-26ca-47b5-aaf6-dfc2212602e1";
const PATH = `/declutter/item/${ITEM}`;
const BASE = "https://proj.supabase.co";
const PHOTO = "76b07824-9b41-4741-a4c4-4f8de362f682/declutter/80a8beec-26ca-47b5-aaf6-dfc2212602e1/5583cc20.jpg";
const answering = (body: (url: string) => unknown, ok = true) =>
  vi.fn(async (url: string) => ({ ok, json: async () => body(url) }) as unknown as Response);
const rows = (url: string) =>
  url.includes("declutter_item_photos") ? [{ id: "p1", item_id: ITEM, storage_path: PHOTO, position: 0 }, { id: "p2", item_id: ITEM, storage_path: "b.jpg", position: 1 }]
  : url.includes("declutter_items") ? [{ id: ITEM, title: "Lamp" }] : {};
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  (window as unknown as Record<string, unknown>)[DECLUTTER_ITEM_PREFETCH_KEY] = undefined;
  document.head.querySelectorAll('link[rel="preload"]').forEach((l) => l.remove());
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
  db.calls.length = 0;
  db.uid = UID;
});

function signIn(expiresInS = 3600, id = UID) {
  vi.stubEnv("VITE_SUPABASE_URL", BASE);
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
  localStorage.setItem("sb-proj-auth-token", JSON.stringify({ access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + expiresInS, user: { id } }));
}

describe("a cold item page's reads and first photo start from the entry (B100)", () => {
  it("its URLs are the ones supabase-js builds for fetchItem and fetchPhotos", () => {
    const sb = createClient(BASE, "k");
    const url = (q: unknown) => (q as { url: URL }).url.toString();
    const itemColumns = /const ITEM_COLUMNS =\s*"([^"]+)";/.exec(code("src/lib/declutter/myReads.ts"))?.[1];
    expect(itemColumns, "ITEM_COLUMNS found in myReads.ts").toBeTruthy();
    expect(ITEM_SELECT).toBe(itemColumns);
    expect(declutterItemUrls(BASE, ITEM)).toEqual({
      item: url(sb.from("declutter_items").select(itemColumns!).eq("id", ITEM).maybeSingle()),
      photos: url(sb.from("declutter_item_photos").select("id, item_id, storage_path, position").in("item_id", [ITEM]).order("position", { ascending: true })),
    });
    const src = code("src/lib/declutter/api.ts");
    expect(src).toContain('readItems((cols) => supabase.from("declutter_items").select(cols).eq("id", itemId).maybeSingle())');
    expect(src).toContain('.from("declutter_item_photos")\n      .select("id, item_id, storage_path, position")\n      .in("item_id", itemIds)\n      .order("position", { ascending: true })');
  });

  it("the preload is the gallery's first frame exactly (src, srcset, sizes), so the gallery's request is answered from it", () => {
    const want = pagePhoto(`${BASE}/storage/v1/object/public/job-photos/${PHOTO}`);
    expect(firstGalleryPhoto(BASE, rows("declutter_item_photos"))).toEqual({ href: want!.src, srcset: want!.srcSet });
    expect(code("src/components/declutter/DeclutterGallery.tsx")).toContain(`sizes={display?.[i] ? "${GALLERY_SIZES}" : undefined}`);
    expect(code("src/lib/declutter/api.ts")).toContain("export const DECLUTTER_PHOTO_BUCKET = \"job-photos\"");
    expect(firstGalleryPhoto(BASE, [{ storage_path: "a b.jpg" }]), "a path a URL would encode").toBeNull();
    expect(firstGalleryPhoto(BASE, []), "no photos").toBeNull();
    expect(firstGalleryPhoto(BASE, { message: "x" }), "not a list").toBeNull();
  });

  it("only the signed-in boot door starts it, the entry reaches that door on an item page, and nothing else imports it", () => {
    expect(code("src/boot/signedInPrefetch.ts")).toContain("startDeclutterItemPrefetch(pathname);");
    const gate = /hasToken\(\) && (\/.*\/)\.test\(window\.location\.pathname\)/.exec(code("src/entry.ts"))?.[1];
    expect(gate, "the entry's signed-in route test").toBeTruthy();
    const re = new Function(`return ${gate}`)() as RegExp;
    expect(re.test(PATH)).toBe(true);
    expect(re.test("/declutter")).toBe(true);
    expect(re.test("/messages")).toBe(false);
    expect(code("src/lib/declutter/itemPrefetchTake.ts")).toContain(`const KEY = "${DECLUTTER_ITEM_PREFETCH_KEY}";`);
    const importers = walkSource([resolve(ROOT, "src")])
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => /(from ["']|import\(["'])[^"']*declutterItemPrefetch["']/.test(code(f.replace(ROOT + "/", ""))))
      .map((f) => f.replace(ROOT + "/", ""));
    expect(importers).toEqual(["src/boot/signedInPrefetch.ts"]);
  });

  it("fires for a member on an item page only: never a guest, an expiring session or another route", async () => {
    const f = answering(rows);
    vi.stubGlobal("fetch", f);
    vi.stubEnv("VITE_SUPABASE_URL", BASE);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
    startDeclutterItemPrefetch(PATH);
    expect(f, "guest").not.toHaveBeenCalled();
    signIn(30);
    startDeclutterItemPrefetch(PATH);
    expect(f, "a token with under a minute left").not.toHaveBeenCalled();
    localStorage.clear();
    signIn();
    for (const p of ["/declutter", "/declutter/item/x", "/declutter/item/" + ITEM + "/edit", "/home"]) startDeclutterItemPrefetch(p);
    expect(f, "other routes").not.toHaveBeenCalled();
    startDeclutterItemPrefetch(PATH + "/");
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    const urls = declutterItemUrls(BASE, ITEM);
    expect(calls.map(([u]) => u).sort()).toEqual([urls.item, urls.photos].sort());
    for (const [, init] of calls) expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    await flush();
    const links = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("imagesizes")).toBe(GALLERY_SIZES);
    expect(links[0].href).toBe(firstGalleryPhoto(BASE, rows("declutter_item_photos"))!.href);
  });

  it("hands each read out once, for that item and that member", async () => {
    signIn();
    vi.stubGlobal("fetch", answering(rows));
    startDeclutterItemPrefetch(PATH);
    expect(await takeItemPrefetch(ITEM, "someone-else"), "another member").toBeUndefined();
    expect(await takeItemPrefetch("00000000-0000-4000-8000-000000000000", UID), "another item").toBeUndefined();
    expect(await takeItemPrefetch(ITEM, UID)).toEqual({ id: ITEM, title: "Lamp" });
    expect(await takeItemPrefetch(ITEM, UID), "a refetch must reach the server").toBeUndefined();
    expect(await takeItemPhotosPrefetch(ITEM, async () => UID)).toHaveLength(2);
  });

  it("no row is handed over as null (the page's not-found), a failed, odd or old answer as nothing", async () => {
    signIn();
    vi.stubGlobal("fetch", answering(() => []));
    startDeclutterItemPrefetch(PATH);
    expect(await takeItemPrefetch(ITEM, UID)).toBeNull();
    const cases: [string, ReturnType<typeof vi.fn>][] = [
      ["refused", answering(rows, false)],
      ["an error body", answering(() => ({ message: "x" }))],
      ["offline", vi.fn(async () => { throw new TypeError("Failed to fetch"); })],
    ];
    expect(cases.length).toBeGreaterThan(2);
    for (const [why, f] of cases) {
      vi.stubGlobal("fetch", f);
      startDeclutterItemPrefetch(PATH);
      expect(await takeItemPrefetch(ITEM, UID), `${why} item`).toBeUndefined();
      expect(await takeItemPhotosPrefetch(ITEM, UID), `${why} photos`).toBeUndefined();
    }
    vi.stubGlobal("fetch", answering(rows));
    startDeclutterItemPrefetch(PATH);
    expect(await takeItemPrefetch(ITEM, UID, Date.now() + DECLUTTER_ITEM_PREFETCH_MAX_AGE_MS + 1), "old").toBeUndefined();
  });

  it("fetchItem and fetchPhotos take the answer and ask Supabase nothing; the next call asks; another member asks", async () => {
    signIn();
    vi.stubGlobal("fetch", answering(rows));
    startDeclutterItemPrefetch(PATH);
    expect(await api.fetchItem(ITEM)).toEqual({ id: ITEM, title: "Lamp" });
    expect(await api.fetchPhotos([ITEM])).toHaveLength(2);
    expect(db.calls, "no double read").toEqual([]);
    await api.fetchItem(ITEM);
    await api.fetchPhotos([ITEM]);
    expect(db.calls).toEqual(["declutter_items", "declutter_item_photos"]);
    db.calls.length = 0;
    startDeclutterItemPrefetch(PATH);
    db.uid = "someone-else";
    await api.fetchItem(ITEM);
    await api.fetchPhotos([ITEM]);
    expect(db.calls).toEqual(["declutter_items", "declutter_item_photos"]);
  });
});
