/**
 * Q2708 (11-05): index.html's inline guest item early start. A GUEST's Declutter item page starts its item row read,
 * photo rows read and first-photo preload from the HTML, before the entry's chunks load. This RUNS the inline script
 * (taken from index.html, so an edit to it is what is tested) and holds it equal to the boot module it front-runs
 * (src/boot/declutterItemPrefetch.ts): the same two URLs and anonymous headers, the same hand-over slot (the page's
 * fetchItem/fetchPhotos take it), the same preload. It must never act for a page with ANY stored Supabase session or
 * unreadable storage (the guest rule of anyStoredSession), and the entry then skips its guest door.
 */
// @mutate index.html | if (sk && sk.indexOf("sb-") === 0 && sk.slice(-11) === "-auth-token") return; | if (false) return;
// @mutate index.html | } catch (blocked) {\n          return; | } catch (blocked) {
// @mutate index.html | link.setAttribute("imagesizes", "(min-width: 640px) 680px, calc(100vw - 40px)"); | link.setAttribute("imagesizes", "100vw");
// @mutate index.html | position.asc"); | position.desc");
// @mutate index.html | ,porch_ok,accepts_offers"); | ,porch_ok");
// @mutate index.html | userId: null, itemId: id, | userId: "guest", itemId: id,
// @mutate src/boot/declutterItemPrefetch.ts |   if (guest && prior?.itemId === itemId && prior.userId === null) return; |
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DECLUTTER_ITEM_PREFETCH_KEY, declutterItemUrls, firstGalleryPhoto, GALLERY_SIZES, startDeclutterItemPrefetch } from "@/boot/declutterItemPrefetch";
import { takeItemPhotosPrefetch, takeItemPrefetch } from "@/lib/declutter/itemPrefetchTake";
import { inlineExecutableScripts, metaCsp, sha256Source, vercelCsp } from "../../scripts/csp/inline-scripts.mjs";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const scripts = inlineExecutableScripts(html) as { body: string }[];
const early = scripts.filter((s) => s.body.includes("declutter_item_photos"));

const BASE = "https://proj.supabase.co";
const KEY = "pk";
const ITEM = "80a8beec-26ca-47b5-aaf6-dfc2212602e1";
const PATH = `/declutter/item/${ITEM}`;
const PHOTO = "76b07824-9b41-4741-a4c4-4f8de362f682/declutter/80a8beec-26ca-47b5-aaf6-dfc2212602e1/5583cc20.jpg";
const rows = (url: string) =>
  url.includes("declutter_item_photos") ? [{ id: "p1", item_id: ITEM, storage_path: PHOTO, position: 0 }]
  : url.includes("declutter_items") ? [{ id: ITEM, title: "Lamp" }] : {};
const answering = () => vi.fn(async (url: string) => ({ ok: true, json: async () => rows(url) }) as unknown as Response);
const flush = () => new Promise((r) => setTimeout(r, 0));
const run = () => new Function(early[0].body)();
const slot = () => (window as unknown as Record<string, unknown>)[DECLUTTER_ITEM_PREFETCH_KEY];
const preloads = () => [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]')];

beforeEach(() => {
  for (const [n, v] of [["lh-supabase-url", BASE + "/"], ["lh-supabase-key", KEY]]) {
    const m = document.createElement("meta");
    m.setAttribute("name", n);
    m.setAttribute("content", v);
    document.head.appendChild(m);
  }
  window.history.replaceState({}, "", PATH);
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>)[DECLUTTER_ITEM_PREFETCH_KEY];
  document.head.querySelectorAll('link[rel="preload"], meta[name^="lh-supabase"]').forEach((l) => l.remove());
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("index.html's guest item early start (Q2708)", () => {
  it("is exactly one inline script, and both shipped policies list its exact hash", () => {
    expect(early).toHaveLength(1);
    expect(scripts.length).toBeGreaterThan(5);
    const hash = sha256Source(early[0].body);
    expect(metaCsp(html), "index.html's meta CSP").toContain(hash);
    expect(vercelCsp(JSON.parse(readFileSync(resolve(ROOT, "vercel.json"), "utf8"))), "vercel.json's CSP").toContain(hash);
  });

  it("a guest gets the boot module's two reads, slot and preload, and the page takes the slot", async () => {
    const f = answering();
    vi.stubGlobal("fetch", f);
    run();
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    const urls = declutterItemUrls(BASE, ITEM);
    expect(calls.map(([u]) => u).sort()).toEqual([urls.item, urls.photos].sort());
    for (const [, init] of calls) expect(init.headers).toEqual({ apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/json" });
    await flush();
    await flush();
    const p = firstGalleryPhoto(BASE, rows("declutter_item_photos"))!;
    const links = preloads();
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe(p.href);
    expect(links[0].getAttribute("imagesrcset")).toBe(p.srcset);
    expect(links[0].getAttribute("imagesizes")).toBe(GALLERY_SIZES);
    expect(links[0].getAttribute("fetchpriority")).toBe("high");
    // The boot module (reached only if the entry still opens its door) keeps the slot: no second read.
    vi.stubEnv("VITE_SUPABASE_URL", BASE);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", KEY);
    startDeclutterItemPrefetch(PATH);
    expect(f).toHaveBeenCalledTimes(2);
    // The page's hand-over takes it, for a guest page only.
    expect(await takeItemPrefetch(ITEM, "11111111-2222-4333-8444-555555555555"), "never to a member").toBeUndefined();
    expect(await takeItemPrefetch(ITEM, null)).toEqual({ id: ITEM, title: "Lamp" });
    expect(await takeItemPhotosPrefetch(ITEM, null)).toHaveLength(1);
  });

  it("does nothing for any stored session (live, expired, malformed), unreadable storage, or another route", () => {
    const f = answering();
    vi.stubGlobal("fetch", f);
    const live = { access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u" } };
    for (const v of [JSON.stringify(live), JSON.stringify({ ...live, expires_at: 1 }), "not json"]) {
      localStorage.clear();
      localStorage.setItem("sb-proj-auth-token", v);
      run();
    }
    localStorage.clear();
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("blocked"); });
    run();
    vi.restoreAllMocks();
    for (const p of ["/declutter", "/declutter/item/x", `${PATH}/edit`, "/home"]) {
      window.history.replaceState({}, "", p);
      run();
    }
    expect(f).not.toHaveBeenCalled();
    expect(slot()).toBeUndefined();
  });

  it("an unreplaced env placeholder or a missing meta: nothing", () => {
    const f = answering();
    vi.stubGlobal("fetch", f);
    document.querySelector('meta[name="lh-supabase-url"]')!.setAttribute("content", "%VITE_SUPABASE_URL%");
    run();
    document.querySelector('meta[name="lh-supabase-url"]')!.setAttribute("content", BASE);
    document.querySelector('meta[name="lh-supabase-key"]')!.remove();
    run();
    expect(f).not.toHaveBeenCalled();
  });

  it("the entry skips its guest door once the slot is there", () => {
    expect(blankComments(readFileSync(resolve(ROOT, "src/entry.ts"), "utf8"))).toMatch(
      /\} else if \(\/\^\\\/declutter\\\/item\\\/\[\\w-\]\+\\\/\?\$\/\.test\(window\.location\.pathname\) && !\("__lhDeclutterItemPrefetch" in window\)\) \{/,
    );
    expect(DECLUTTER_ITEM_PREFETCH_KEY).toBe("__lhDeclutterItemPrefetch");
  });
});
