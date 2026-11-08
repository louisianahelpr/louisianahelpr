/**
 * Q2705 (lead 11-08): a guest's /declutter starts its first reads and its first card photos from the HTML, before any
 * JavaScript file arrives. Measured before (cwv-lab, prod www, guest, chromium, Slow 4G + 4x, 375x812, 3 runs,
 * 2026-11-08, ~/.lh-shots/b2-guest-speed/before-live.log): LCP 6368-6640 ms (median 6428), the first card photo; the
 * two reads started at ~2.6 s, after the entry had downloaded and run.
 *
 * index.html's inline script (the one naming __lhGuestDeclutterEarly) fires features_open_to_everyone and
 * declutter_guest_preview as plain GETs, leaves the answers for the entry (guestDeclutterPrefetch.ts takes them
 * instead of asking again), and on a phone draws the first four photos into #lh-declutter-shell, the first row first,
 * from the preview, shown only once Declutter is open to everyone. api/share.ts preloads the first row's photos from the
 * response's Link header (src/lib/declutterFirstPhotos.mjs; never a storage path in the markup), with the card's own
 * URLs, so the script's and the card's <img> reuse the download.
 */
// @mutate index.html |             if (name.slice(0, 3) === "sb-" && /-auth-token$/.test(name)) return;\n            if (name.indexOf("helpr_section_prefs:") === 0) prefs = true; |             if (name.indexOf("helpr_section_prefs:") === 0) prefs = true;
// @mutate index.html |           return fetch(base + "/rest/v1/rpc/" + fn + "?apikey=" + encodeURIComponent(key)) |           return fetch(base + "/rest/v1/rpc/" + fn, { method: "POST", headers: { apikey: key } })
// @mutate index.html |           if (!isOpen(a[0]) \|\| !p \|\| | if (!p \|\|
// @mutate index.html |            (s < 2 ? row : later).push({ img: img, path: paths[s] }); |            row.push({ img: img, path: paths[s] });
// @mutate index.html |             return root + path + "?width=" + px + "&height=" + px + "&resize=cover&quality=70"; |             return root + path + "?width=" + px + "&height=" + px + "&resize=cover&quality=75";
// @mutate index.html |         if (location.search \|\| location.hash \|\| window.innerWidth >= 900 \|\| prefs) return; |         if (location.hash \|\| prefs) return;
// @mutate index.html |             if (mark && mark !== "declutter") return; |
// @mutate src/boot/guestDeclutterPrefetch.ts |   const early = takeEarlyGuestReads(); |   const early = null as ReturnType<typeof takeEarlyGuestReads>;
// @mutate src/boot/guestDeclutterPrefetch.ts |   if (!e \|\| typeof e.at !== "number" \|\| now - e.at > EARLY_MAX_AGE_MS) return null; |   if (!e \|\| typeof e.at !== "number") return null;
// @mutate src/boot/guestDeclutterPrefetch.ts |     if (document.documentElement.getAttribute("data-lh-app-shell") === "declutter") return; |
// @mutate src/lib/declutterFirstPhotos.mjs |   return typeof path === "string" && path.indexOf("/") > 0 && !path.includes("..") && PATH_RE.test(path); |   return typeof path === "string";
// @mutate src/lib/declutterFirstPhotos.mjs |     .slice(0, FIRST_ROW) |     .slice(0, 4)
// @mutate src/lib/declutterFirstPhotos.mjs |   const url = (px) => `${root}${path}?width=${px}&height=${px}&resize=cover&quality=70`; |   const url = (px) => `${root}${path}?width=${px}&height=${px}&resize=cover`;
// @mutate api/share.ts |         return respond(page, DECLUTTER_PAGE_CDN_CACHE, 200, meta.noindexHeader === true, preload ? { Link: preload } : {}); |         return respond(page, DECLUTTER_PAGE_CDN_CACHE, 200, meta.noindexHeader === true);
// @mutate api/share.ts | const DECLUTTER_PAGE_CDN_CACHE = "public, s-maxage=60, stale-while-revalidate=3600"; | const DECLUTTER_PAGE_CDN_CACHE = "public, s-maxage=300, stale-while-revalidate=86400";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { ensureOgShellSnapshot } from "@/test/helpers/ogShellSnapshot";
import { resolve } from "node:path";
import { firstCardPhotoPreloads } from "./declutterPrefetch";
import { GUEST_DECLUTTER_EARLY_KEY, GUEST_DECLUTTER_PREFETCH_KEY, startGuestDeclutterPrefetch, takeEarlyGuestReads } from "./guestDeclutterPrefetch";
import { CARD_SIZES as BOOT_CARD_SIZES } from "./declutterPrefetch";
import { CARD_SIZES, cardPhotoUrls, declutterPhotoPreloadHeader, firstPhotoPaths, usablePhotoPath } from "@/lib/declutterFirstPhotos.mjs";
import { DECLUTTER_PHOTO_MARKUP } from "../../scripts/inline-shell-css.mjs";

const INDEX = readFileSync("index.html", "utf8");
const BASE = "https://x.supabase.co";
const KEY = "anon.key";

/** The inline script that names the early slot (comments in the HTML are not part of any script). */
function earlyScript(html: string): string {
  // Comments dropped until none are left (a single pass can leave a "<!--" behind), script tags matched case-blind.
  let bare = html;
  for (let prev = ""; prev !== bare; ) {
    prev = bare;
    bare = bare.replace(/<!--[\s\S]*?-->/g, "");
  }
  const scripts = [...bare.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((m) => m[1]);
  const hits = scripts.filter((s) => s.includes(GUEST_DECLUTTER_EARLY_KEY));
  expect(hits).toHaveLength(1);
  return hits[0];
}

/** index.html's own #lh-declutter-shell block. */
function shellMarkup(html: string): string {
  const start = html.indexOf('<div id="lh-declutter-shell"');
  const end = html.indexOf('<span data-lh-shell="end" hidden></span></div>', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end + '<span data-lh-shell="end" hidden></span></div>'.length);
}

const ITEMS = [{ id: "i1" }, { id: "i2" }, { id: "i3" }, { id: "i4" }, { id: "i5" }];
const PHOTOS = [
  { item_id: "i1", storage_path: "u1/declutter/i1/a.jpg", position: 0 },
  { item_id: "i1", storage_path: "u1/declutter/i1/b.jpg", position: 1 },
  { item_id: "i2", storage_path: "u1/declutter/i2/a.jpg", position: 0 },
  { item_id: "i4", storage_path: "u2/declutter/i4/a.jpg", position: 0 },
];
const PREVIEW = { items: ITEMS, photos: PHOTOS, more: false };

type Run = {
  keys?: string[];
  lang?: string | null;
  search?: string;
  width?: number;
  path?: string;
  open?: unknown;
  preview?: unknown;
  capacitor?: boolean;
};

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

function setup(o: Run = {}) {
  document.head.innerHTML = `<meta name="lh-supabase-url" content="${BASE}"><meta name="lh-supabase-key" content="${KEY}">`;
  document.body.innerHTML = shellMarkup(INDEX);
  document.documentElement.removeAttribute("data-lh-app-shell");
  const keys = o.keys ?? [];
  const items: Record<string, string | null> = { helpr_lang: o.lang ?? null };
  const store = { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (k: string) => items[k] ?? null };
  const win: Record<string, unknown> = { innerWidth: o.width ?? 375, ...(o.capacitor ? { Capacitor: {} } : {}) };
  const calls: { url: string; init?: RequestInit }[] = [];
  let answerOpen: (v: unknown) => void = () => {};
  const openGate = new Promise((r) => (answerOpen = r));
  const fetchStub = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("/rpc/features_open_to_everyone")) return openGate.then(() => new Response(JSON.stringify(o.open ?? ["declutter"]), { status: 200 }));
    return Promise.resolve(new Response(JSON.stringify(o.preview ?? PREVIEW), { status: 200 }));
  });
  const timers: number[] = [];
  new Function("document", "location", "localStorage", "window", "navigator", "fetch", "setTimeout", earlyScript(INDEX))(
    document,
    { pathname: o.path ?? "/declutter", search: o.search ?? "", hash: "", protocol: "https:" },
    store,
    win,
    { language: "en-US" },
    fetchStub,
    (fn: () => void, ms: number) => { timers.push(ms); if (ms <= 25) setTimeout(fn, 0); },
  );
  const imgs = () => [...document.querySelectorAll<HTMLImageElement>("#lh-declutter-shell img")];
  return { win, calls, openNow: () => answerOpen(null), imgs, timers, shown: () => document.documentElement.getAttribute("data-lh-app-shell") };
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-lh-app-shell");
  delete (window as unknown as Record<string, unknown>)[GUEST_DECLUTTER_EARLY_KEY];
  delete (window as unknown as Record<string, unknown>)[GUEST_DECLUTTER_PREFETCH_KEY];
  vi.unstubAllGlobals();
});

describe("index.html's guest /declutter script (Q2705, 11-08)", () => {
  it("fires the two reads as plain GETs (no preflight) for a provable guest, and leaves them for the entry", async () => {
    const r = setup();
    expect(r.calls.map((c) => c.url)).toEqual([
      `${BASE}/rest/v1/rpc/features_open_to_everyone?apikey=${encodeURIComponent(KEY)}`,
      `${BASE}/rest/v1/rpc/declutter_guest_preview?apikey=${encodeURIComponent(KEY)}`,
    ]);
    // No init at all: no method, no custom header, so the browser sends no CORS preflight.
    expect(r.calls.every((c) => c.init === undefined)).toBe(true);
    const slot = r.win[GUEST_DECLUTTER_EARLY_KEY] as { at: number; open: Promise<unknown>; preview: Promise<unknown> };
    expect(typeof slot.at).toBe("number");
    r.openNow();
    expect(await slot.open).toEqual(["declutter"]);
    expect(await slot.preview).toEqual(PREVIEW);
  });

  it("reads nothing for a stored session, another route, the native app, or an unconfigured build", () => {
    expect(setup({ keys: ["sb-proj-auth-token"] }).calls).toHaveLength(0);
    expect(setup({ path: "/declutter/item/x" }).calls).toHaveLength(0);
    expect(setup({ path: "/browse" }).calls).toHaveLength(0);
    expect(setup({ capacitor: true }).calls).toHaveLength(0);
    document.head.innerHTML = '<meta name="lh-supabase-url" content="%VITE_SUPABASE_URL%"><meta name="lh-supabase-key" content="%VITE_SUPABASE_PUBLISHABLE_KEY%">';
    const calls: string[] = [];
    new Function("document", "location", "localStorage", "window", "navigator", "fetch", "setTimeout", earlyScript(INDEX))(
      document, { pathname: "/declutter", search: "", hash: "", protocol: "https:" }, { length: 0, key: () => null, getItem: () => null },
      { innerWidth: 375 }, { language: "en-US" }, (u: string) => { calls.push(u); return Promise.resolve(new Response("null")); }, () => 0,
    );
    expect(calls).toHaveLength(0);
  });

  it("draws the first four photos from the preview, the first row first, with the card's own URLs, once Declutter is open", async () => {
    const r = setup();
    await flush();
    expect(r.imgs(), "nothing before Declutter is known to be open").toHaveLength(0);
    expect(r.shown()).toBeNull();
    r.openNow();
    await flush();
    expect(r.shown()).toBe("declutter");
    expect(r.timers).toContain(10000);
    const imgs = r.imgs();
    // Item 3 has no photo: its slot keeps the skeleton tile.
    expect(imgs).toHaveLength(3);
    const tiles = [...document.querySelectorAll("#lh-declutter-shell ul > li")].map((li) => li.firstElementChild!);
    expect(tiles[2].hasAttribute("data-skeleton")).toBe(true);
    expect(tiles[0].hasAttribute("data-skeleton")).toBe(false);
    expect(imgs.slice(0, 2).map((i) => i.getAttribute("fetchpriority"))).toEqual(["high", "high"]);
    // The second row waits for the first.
    expect(imgs[2].getAttribute("src")).toBeNull();
    // The card's own URLs (and the server's preload's), so every <img> reuses one download.
    const want = firstCardPhotoPreloads(BASE, PREVIEW, "", { width: 375, height: 812 });
    expect(imgs.slice(0, 2).map((i) => [i.getAttribute("src"), i.getAttribute("srcset")])).toEqual(want.slice(0, 2).map((p) => [p.href, p.srcset]));
    expect(imgs[0].getAttribute("sizes")).toBe(BOOT_CARD_SIZES);
    imgs[0].dispatchEvent(new Event("load"));
    expect(imgs[2].getAttribute("src")).toBeNull();
    imgs[1].dispatchEvent(new Event("error"));
    expect([imgs[2].getAttribute("src"), imgs[2].getAttribute("srcset")]).toEqual([want[2].href, want[2].srcset]);
    expect(imgs[2].getAttribute("fetchpriority")).toBeNull();
  });

  it("never shows the shell while Declutter is not open to everyone", async () => {
    const r = setup({ open: ["jobs"] });
    r.openNow();
    await flush();
    expect(r.shown()).toBeNull();
    expect(r.imgs()).toHaveLength(0);
    const s = setup({ open: [] });
    s.openNow();
    await flush();
    expect(s.shown()).toBeNull();
    expect(s.imgs()).toHaveLength(0);
  });

  it("draws nothing (but still reads) off a phone, with a query, in Spanish or with a saved section order", async () => {
    for (const o of [{ width: 1024 }, { search: "?tab=mine" }, { lang: "es" }, { keys: ["helpr_section_prefs:u"] }] as Run[]) {
      const r = setup(o);
      expect(r.calls, JSON.stringify(o)).toHaveLength(2);
      r.openNow();
      await flush();
      expect(r.imgs(), JSON.stringify(o)).toHaveLength(0);
      expect(r.shown(), JSON.stringify(o)).toBeNull();
    }
  });

  it("leaves a shell the app already removed, and a shell another page marked, alone", async () => {
    const r = setup();
    document.getElementById("lh-declutter-shell")!.remove();
    r.openNow();
    await flush();
    expect(r.shown()).toBeNull();
    const other = setup();
    document.documentElement.setAttribute("data-lh-app-shell", "home");
    other.openNow();
    await flush();
    expect(other.shown()).toBe("home");
    expect(other.imgs()).toHaveLength(0);
  });
});

describe("the entry takes the HTML's answers (guestDeclutterPrefetch.ts)", () => {
  it("does not ask again while the early answers are fresh, and asks for itself when they are old or absent", async () => {
    const fetchStub = vi.fn(() => Promise.resolve(new Response(JSON.stringify(PREVIEW), { status: 200 })));
    vi.stubGlobal("fetch", fetchStub);
    const w = window as unknown as Record<string, unknown>;
    w[GUEST_DECLUTTER_EARLY_KEY] = { at: Date.now(), open: Promise.resolve(["declutter"]), preview: Promise.resolve(PREVIEW) };
    startGuestDeclutterPrefetch(BASE, KEY, "?tab=mine");
    await flush();
    expect(fetchStub).not.toHaveBeenCalled();
    const slot = w[GUEST_DECLUTTER_PREFETCH_KEY] as { open: Promise<unknown>; preview: Promise<unknown> };
    expect(await slot.open).toEqual(["declutter"]);
    expect(await slot.preview).toEqual(PREVIEW);
    expect(w[GUEST_DECLUTTER_EARLY_KEY], "taken once").toBeUndefined();

    w[GUEST_DECLUTTER_EARLY_KEY] = { at: Date.now() - 60_000, open: Promise.resolve(["declutter"]), preview: Promise.resolve(PREVIEW) };
    startGuestDeclutterPrefetch(BASE, KEY, "?tab=mine");
    expect(fetchStub.mock.calls.length, "an old answer is not used").toBeGreaterThan(0);
    expect(takeEarlyGuestReads()).toBeNull();
  });

  it("does not preload the card photos a second time when the HTML drew them", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("null", { status: 404 }))));
    const w = window as unknown as Record<string, unknown>;
    const links = () => document.head.querySelectorAll('link[rel="preload"][as="image"]').length;
    w[GUEST_DECLUTTER_EARLY_KEY] = { at: Date.now(), open: Promise.resolve(["declutter"]), preview: Promise.resolve(PREVIEW) };
    document.documentElement.setAttribute("data-lh-app-shell", "declutter");
    startGuestDeclutterPrefetch(BASE, KEY, "");
    await flush();
    expect(links()).toBe(0);
    document.documentElement.removeAttribute("data-lh-app-shell");
    w[GUEST_DECLUTTER_EARLY_KEY] = { at: Date.now(), open: Promise.resolve(["declutter"]), preview: Promise.resolve(PREVIEW) };
    startGuestDeclutterPrefetch(BASE, KEY, "");
    await flush();
    expect(links()).toBeGreaterThan(0);
  });
});

describe("the server's first-row preload (src/lib/declutterFirstPhotos.mjs, api/share.ts)", () => {
  it("preloads only the first row's plain storage paths, with the card's own URLs, on phones only", () => {
    expect(usablePhotoPath("u/declutter/i/a.jpg")).toBe(true);
    for (const bad of ["", "a.jpg", "/abs/a.jpg", "u/../x.jpg", 'u/a" onload="x', "u/a.jpg?x=1", "u/a b.jpg", "u/a>.jpg", null, 7]) expect(usablePhotoPath(bad), String(bad)).toBe(false);
    expect(firstPhotoPaths(null)).toBeNull();
    expect(firstPhotoPaths({ items: [], photos: [] })).toBeNull();
    expect(firstPhotoPaths({ items: [{ id: "a" }], photos: [{ item_id: "a", storage_path: 'x/"><script>' }] })).toEqual(["-"]);
    const paths = firstPhotoPaths(PREVIEW)!;
    expect(paths).toEqual(["u1/declutter/i1/a.jpg", "u1/declutter/i2/a.jpg", "-", "u2/declutter/i4/a.jpg"]);
    const want = firstCardPhotoPreloads(BASE, PREVIEW, "", { width: 375, height: 812 });
    expect(paths.slice(0, 2).map((p) => cardPhotoUrls(BASE, p))).toEqual(want.slice(0, 2).map((p) => ({ href: p.href, srcset: p.srcset })));
    expect(CARD_SIZES).toBe(BOOT_CARD_SIZES);
    const header = declutterPhotoPreloadHeader(BASE, paths)!;
    const links = header.split(/, (?=<)/);
    expect(links).toHaveLength(2);
    links.forEach((l, i) => {
      expect(l).toBe(`<${want[i].href}>; rel=preload; as=image; imagesrcset="${want[i].srcset}"; imagesizes="${CARD_SIZES}"; media="(max-width: 899px)"`);
    });
    expect(declutterPhotoPreloadHeader(BASE, ["-", "u/a.jpg"])!.split(/, (?=<)/)).toHaveLength(1);
    expect(declutterPhotoPreloadHeader(BASE, ["-", "-", "u/a.jpg"])).toBeNull();
    expect(declutterPhotoPreloadHeader(BASE, null)).toBeNull();
  });

  it("api/share.ts sends the header on /declutter only, from the anon preview, with a short budget and a short CDN cache, never in the markup", () => {
    const src = blankComments(readFileSync("api/share.ts", "utf8"));
    expect(src).toMatch(/if \(isDeclutterPage\(url\)\) \{\s*const preload = declutterPhotoPreloadHeader\(SUPABASE_URL, await fetchDeclutterFirstPhotos\(\)\);\s*return respond\(page, DECLUTTER_PAGE_CDN_CACHE, 200, meta\.noindexHeader === true, preload \? \{ Link: preload \} : \{\}\);/);
    expect(src).toMatch(/route\.kind === "page" && route\.id === "declutter"/);
    expect(src).toMatch(/const DECLUTTER_PHOTOS_TIMEOUT_MS = 700;/);
    expect(src).toMatch(/const DECLUTTER_PAGE_CDN_CACHE = "public, s-maxage=60, stale-while-revalidate=3600";/);
    expect(src).toMatch(/fetch\(declutterGuestPreviewUrl\(SUPABASE_URL\), \{ headers, signal: AbortSignal\.timeout\(DECLUTTER_PHOTOS_TIMEOUT_MS\) \}\)/);
    expect(src.slice(src.indexOf("async function fetchDeclutterFirstPhotos"), src.indexOf("function isDeclutterPage"))).not.toMatch(/SERVICE_ROLE/);
    expect(src).toMatch(/\.\.\.extra,/);
  });

  it("the inlined first-frame CSS covers the photos the script draws", () => {
    const tmp = document.createElement("div");
    tmp.innerHTML = DECLUTTER_PHOTO_MARKUP;
    const img = tmp.querySelector("img")!;
    const tile = tmp.firstElementChild!;
    const src = earlyScript(INDEX);
    expect(src).toContain(`img.className = "${img.className}";`);
    expect(src).toContain(`tile.className = "${tile.className}";`);
  });
});

describe("api/share.ts on a real /declutter request", () => {
  let handler: { fetch: (req: Request) => Promise<Response> };
  let preview: unknown = PREVIEW;
  let mode: "ok" | "fail" | "throw" = "ok";
  const asked: string[] = [];
  beforeAll(async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    ensureOgShellSnapshot(resolve("."));
    const sharePath = ["..", "..", "api", "share"].join("/");
    handler = (await import(/* @vite-ignore */ sharePath)).default;
  });
  afterAll(() => vi.unstubAllEnvs());
  const get = async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(String(url));
      if (mode === "throw") throw new Error("timeout");
      if (mode === "fail") return new Response("{}", { status: 503 });
      return new Response(JSON.stringify(preview), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    return handler.fetch(new Request("https://www.louisianahelpr.com/api/share?_og=page&_id=declutter"));
  };

  it("answers with the first row's preload header, no path in the markup, and a short CDN cache", async () => {
    mode = "ok";
    preview = PREVIEW;
    asked.length = 0;
    const res = await get();
    expect(asked).toEqual(["https://example.supabase.co/rest/v1/rpc/declutter_guest_preview"]);
    expect(res.headers.get("Link")).toBe(declutterPhotoPreloadHeader("https://example.supabase.co", firstPhotoPaths(PREVIEW)));
    expect(res.headers.get("Link")).toContain("u1/declutter/i1/a.jpg");
    expect(res.headers.get("Vercel-CDN-Cache-Control")).toBe("public, s-maxage=60, stale-while-revalidate=3600");
    const html = await res.text();
    expect(html).not.toContain("u1/declutter");
    expect(html).not.toMatch(/job-photos\/[\w-]/);
  });

  it("a failed, slow or empty read serves the page without the header", async () => {
    for (const m of ["fail", "throw"] as const) {
      mode = m;
      const res = await get();
      expect(res.status, m).toBe(200);
      expect(res.headers.get("Link"), m).toBeNull();
    }
    mode = "ok";
    preview = { items: [], photos: [], more: false };
    expect((await get()).headers.get("Link")).toBeNull();
  });

  it("no other page reads the preview or gets the header", async () => {
    mode = "ok";
    preview = PREVIEW;
    asked.length = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(String(url));
      return new Response(JSON.stringify(PREVIEW), { status: 200 });
    });
    for (const id of ["help", "support", "legal"]) {
      const res = await handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=page&_id=${id}`));
      expect(res.headers.get("Link"), id).toBeNull();
    }
    expect(asked.filter((u) => u.includes("declutter_guest_preview"))).toEqual([]);
  });
});
