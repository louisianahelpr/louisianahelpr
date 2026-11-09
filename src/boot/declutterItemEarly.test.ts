/**
 * ITEM PAGE SPEED (Builder 2, 11-09). An item page's largest paint is its first photo, and on Slow 4G at 375 it did
 * not START until 3.6 s (cwv-lab, chromium, 3 runs: the entry's JS had to run and its photo-rows read answer first).
 * index.html's inline script naming data-lh-item-early asks for the first photo row from the HTML and preloads the
 * gallery's first photo for each frame shape, so the photo loads beside the app's JS. This holds:
 *  - the preloads are EXACTLY what the gallery asks for (pagePhoto.ts's phone square and width-only srcsets, the
 *    gallery's sizes), so its request is answered from them, one per media (only the matching one fetches);
 *  - it runs only on an item page, never in the app shell (Capacitor), and reads as the member only while their
 *    stored session is good (else as the anonymous role, as a guest's page does);
 *  - anything unexpected (an error, a path a URL would encode, no photo) preloads nothing;
 *  - on a phone's bare URL it shows the item page's own loading frame (#lh-item-shell) at once, and puts the photo
 *    into its photo bone in the gallery's frame (the same frame classes, the skeleton's shimmer taken off) as a small
 *    480 px square crop first, and asks for the gallery's own phone photo (low priority) only once that has arrived;
 *    never on the desktop website, with a query, or over another shell.
 *
 * @mutate index.html |         if (!hit \|\| window.Capacitor \|\| location.protocol === "capacitor:") return; |         if (!hit) return;
 * @mutate index.html | s.expires_at - Date.now() / 1000 > 60) bearer = s.access_token; | s.expires_at > 0) bearer = s.access_token;
 * @mutate index.html |             if (typeof path !== "string" \|\| !/^[A-Za-z0-9/_.-]+$/.test(path)) return; |             if (typeof path !== "string") return;
 * @mutate index.html | "?width=" + w + "&height=" + w + "&resize=cover&quality=75 " | "?width=" + w + "&quality=75 "
 * @mutate index.html |               link.setAttribute("media", p[0]); |
 * @mutate index.html | var draw = !location.search && !location.hash && window.innerWidth < 900 && | var draw = !location.search && !location.hash &&
 * @mutate index.html |                 preloadPhone("low"); |
 * @mutate index.html |             if (!draw) return preloadPhone("high"); |             if (!draw) return;
 * @mutate index.html |                 return c && c.indexOf("after:") !== 0 && c.indexOf("motion-safe:after:") !== 0; |                 return c;
 * @mutate index.html |               shell.setAttribute("data-lh-photos", ""); |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PHONE_PHOTO_MEDIA, PHONE_PHOTO_SIZES, pagePhoto } from "@/lib/declutter/pagePhoto";
import { ITEM_PHOTO_ASPECT, ITEM_PHOTO_FRAME_BASE } from "@/components/declutter/itemPhotoFrame";
import { GALLERY_SIZES, WIDE_MEDIA } from "./declutterItemPrefetch";

const INDEX = readFileSync("index.html", "utf8");
const BASE = "https://x.supabase.co";
const KEY = "anon.key";
const ITEM = "0a1b2c3d-1111-4222-8333-444455556666";
const PATH = "s1/declutter/i1/a.jpg";

/** The one bare inline script naming the item slot (HTML comments are not part of any script). */
function itemScript(html: string): string {
  let bare = html;
  for (let at = bare.indexOf("<!--"); at !== -1; at = bare.indexOf("<!--")) {
    const close = bare.indexOf("-->", at + 4);
    bare = bare.slice(0, at) + (close === -1 ? "" : bare.slice(close + 3));
  }
  const scripts: string[] = [];
  for (let at = bare.indexOf("<script>"); at !== -1; at = bare.indexOf("<script>", at + 1)) {
    const close = bare.indexOf("</script>", at);
    if (close !== -1) scripts.push(bare.slice(at + "<script>".length, close));
  }
  const hits = scripts.filter((s) => s.includes("data-lh-item-early"));
  expect(hits).toHaveLength(1);
  return hits[0];
}

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

type Run = { path?: string; session?: string | null; rows?: unknown; status?: number; capacitor?: boolean; width?: number; search?: string; shown?: string };

/** The item shell as index.html carries it: its photo bone wears the skeleton's classes and the gallery frame's. */
const BONE_CLASS = `after:absolute after:inset-0 after:translate-x-[-100%] motion-safe:after:animate-[shimmer_2s_infinite] ${ITEM_PHOTO_FRAME_BASE} ${ITEM_PHOTO_ASPECT.item}`;
const SHELL = `<div id="lh-item-shell"><div data-skeleton="" class="${BONE_CLASS}" data-item-photo-bone=""></div></div>`;

async function run(o: Run = {}) {
  document.head.innerHTML = `<meta name="lh-supabase-url" content="${BASE}"><meta name="lh-supabase-key" content="${KEY}">`;
  const keys = o.session ? ["sb-proj-auth-token"] : [];
  const store = { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: () => o.session ?? null };
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchStub = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(o.rows ?? [{ storage_path: PATH }]), { status: o.status ?? 200 }));
  });
  const win = o.capacitor ? { Capacitor: {} } : {};
  const loc = { pathname: o.path ?? `/declutter/item/${ITEM}`, protocol: "https:", search: o.search ?? "", hash: "" };
  document.body.innerHTML = SHELL;
  if (o.shown) document.documentElement.setAttribute("data-lh-app-shell", o.shown);
  new Function("window", "location", "localStorage", "fetch", "document", itemScript(INDEX))({ innerWidth: o.width ?? 375, ...win }, loc, store, fetchStub, document);
  const shownAtOnce = document.documentElement.getAttribute("data-lh-app-shell");
  await flush();
  const links = [...document.head.querySelectorAll<HTMLLinkElement>("link[data-lh-item-early]")];
  const bone = document.querySelector<HTMLElement>("[data-item-photo-bone]")!;
  return { calls, links, shownAtOnce, bone, img: bone.querySelector("img"), shell: document.getElementById("lh-item-shell")! };
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-lh-app-shell");
});

const session = (expiresInS: number) => JSON.stringify({ access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + expiresInS, user: { id: "me" } });

describe("index.html starts an item page's first photo (item page speed, 11-09)", () => {
  it("preloads exactly the gallery's photo for each frame shape, one per media", async () => {
    // Where the frame is not drawn (the desktop website), both at once.
    const { calls, links } = await run({ width: 900 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/rest/v1/declutter_item_photos?select=storage_path&item_id=eq.${ITEM}&order=position.asc&limit=1`);
    const want = pagePhoto(`${BASE}/storage/v1/object/public/job-photos/${PATH}`)!;
    expect(links.map((l) => [l.getAttribute("media"), l.getAttribute("imagesrcset"), l.getAttribute("imagesizes"), l.getAttribute("as"), l.rel])).toEqual([
      [WIDE_MEDIA, want.srcSet, GALLERY_SIZES, "image", "preload"],
      [PHONE_PHOTO_MEDIA, want.phoneSrcSet, PHONE_PHOTO_SIZES, "image", "preload"],
    ]);
    expect(links.map((l) => l.getAttribute("fetchpriority"))).toEqual(["high", "high"]);
    expect(links[0].getAttribute("href")).toBe(want.src);
  });

  it("reads as the member while their stored session is good, else as the anonymous role", async () => {
    const auth = async (s: string | null) => ((await run({ session: s })).calls[0].init?.headers as Record<string, string>).Authorization;
    expect(await auth(session(3600))).toBe("Bearer tok");
    expect(await auth(session(30)), "a token with under a minute left").toBe(`Bearer ${KEY}`);
    expect(await auth(null), "a guest").toBe(`Bearer ${KEY}`);
  });

  it("runs only on an item page, and never in the app shell", async () => {
    for (const p of ["/declutter", `/declutter/item/${ITEM}/edit`, "/declutter/item/not-a-uuid", "/home"]) {
      expect((await run({ path: p })).calls, p).toHaveLength(0);
    }
    expect((await run({ path: `/declutter/item/${ITEM}/` })).calls).toHaveLength(1);
    expect((await run({ capacitor: true })).calls, "Capacitor").toHaveLength(0);
  });

  it("on a phone's bare URL it shows the item frame at once and draws the photo in the gallery's frame", async () => {
    const { shownAtOnce, bone, img, shell, links } = await run();
    expect(shownAtOnce, "shown before any answer").toBe("item");
    const want = pagePhoto(`${BASE}/storage/v1/object/public/job-photos/${PATH}`)!;
    expect(img, "the photo is drawn").not.toBeNull();
    // A small square crop first (the frame is square on a phone), nothing that competes with it.
    expect(img!.getAttribute("src")).toBe(`${BASE}/storage/v1/render/image/public/job-photos/${PATH}?width=480&height=480&resize=cover&quality=75`);
    expect(img!.hasAttribute("srcset")).toBe(false);
    expect(links.map((l) => l.getAttribute("media")), "only the wide preload before the small photo is in").toEqual([WIDE_MEDIA]);
    img!.dispatchEvent(new Event("load"));
    const phone = [...document.head.querySelectorAll<HTMLLinkElement>("link[data-lh-item-early]")].filter((l) => l.getAttribute("media") === PHONE_PHOTO_MEDIA);
    expect(phone.map((l) => [l.getAttribute("imagesrcset"), l.getAttribute("imagesizes"), l.getAttribute("fetchpriority")]), "then the gallery's own, once").toEqual([[want.phoneSrcSet, PHONE_PHOTO_SIZES, "low"]]);
    img!.dispatchEvent(new Event("error"));
    expect(document.head.querySelectorAll(`link[media="${PHONE_PHOTO_MEDIA}"]`)).toHaveLength(1);
    expect(img!.className).toBe("h-full w-full object-cover bg-photo-empty");
    // The gallery's own frame (DeclutterGallery's FRAME), with the shimmer overlay gone.
    expect(bone.className).toBe(`${ITEM_PHOTO_FRAME_BASE} ${ITEM_PHOTO_ASPECT.item}`);
    expect(bone.hasAttribute("data-skeleton")).toBe(false);
    expect(shell.hasAttribute("data-lh-photos")).toBe(true);
  });

  it("never shows the frame on the desktop website, with a query, or over another shell; still preloads", async () => {
    for (const [o, why] of [[{ width: 900 }, "desktop website"], [{ search: "?offer=1" }, "a query"], [{ shown: "declutter" }, "another shell"]] as const) {
      const r = await run(o);
      expect(r.img, why).toBeNull();
      expect(r.links, why).toHaveLength(2);
      expect(r.shownAtOnce, why).toBe("shown" in o ? o.shown : null);
      document.documentElement.removeAttribute("data-lh-app-shell");
    }
  });

  it("no photo, or an error: the frame stays a skeleton for the page to replace", async () => {
    for (const r of [await run({ rows: [] }), await run({ status: 500 })]) {
      expect(r.shownAtOnce).toBe("item");
      expect(r.img).toBeNull();
      expect(r.bone.hasAttribute("data-skeleton")).toBe(true);
      document.documentElement.removeAttribute("data-lh-app-shell");
    }
  });

  it("anything unexpected preloads nothing", async () => {
    expect((await run({ status: 401 })).links).toHaveLength(0);
    expect((await run({ rows: [] })).links, "no photo").toHaveLength(0);
    expect((await run({ rows: [{ storage_path: "a b.jpg" }] })).links, "a path a URL would encode").toHaveLength(0);
    expect((await run({ rows: { message: "x" } })).links, "not a list").toHaveLength(0);
  });
});
