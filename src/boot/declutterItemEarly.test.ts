/**
 * ITEM PAGE SPEED (Builder 2, 11-09). An item page's largest paint is its first photo, and on Slow 4G at 375 it did
 * not START until 3.6 s (cwv-lab, chromium, 3 runs: the entry's JS had to run and its photo-rows read answer first).
 * index.html's inline script naming data-lh-item-early asks for the first photo row from the HTML and preloads the
 * gallery's first photo for each frame shape, so the photo loads beside the app's JS. This holds:
 *  - the preloads are EXACTLY what the gallery asks for (pagePhoto.ts's phone square and width-only srcsets, the
 *    gallery's sizes), so its request is answered from them, one per media (only the matching one fetches);
 *  - it runs only on an item page, never in the app shell (Capacitor), and reads as the member only while their
 *    stored session is good (else as the anonymous role, as a guest's page does);
 *  - anything unexpected (an error, a path a URL would encode, no photo) preloads nothing.
 *
 * @mutate index.html |         if (!hit \|\| window.Capacitor \|\| location.protocol === "capacitor:") return; |         if (!hit) return;
 * @mutate index.html | s.expires_at - Date.now() / 1000 > 60) bearer = s.access_token; | s.expires_at > 0) bearer = s.access_token;
 * @mutate index.html |             if (typeof path !== "string" \|\| !/^[A-Za-z0-9/_.-]+$/.test(path)) return; |             if (typeof path !== "string") return;
 * @mutate index.html | "?width=" + w + "&height=" + w + "&resize=cover&quality=75 " | "?width=" + w + "&quality=75 "
 * @mutate index.html |               link.setAttribute("media", p[0]); |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PHONE_PHOTO_MEDIA, PHONE_PHOTO_SIZES, pagePhoto } from "@/lib/declutter/pagePhoto";
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

type Run = { path?: string; session?: string | null; rows?: unknown; status?: number; capacitor?: boolean };

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
  const loc = { pathname: o.path ?? `/declutter/item/${ITEM}`, protocol: "https:" };
  new Function("window", "location", "localStorage", "fetch", "document", itemScript(INDEX))(win, loc, store, fetchStub, document);
  await flush();
  const links = [...document.head.querySelectorAll<HTMLLinkElement>("link[data-lh-item-early]")];
  return { calls, links };
}

afterEach(() => {
  document.head.innerHTML = "";
});

const session = (expiresInS: number) => JSON.stringify({ access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + expiresInS, user: { id: "me" } });

describe("index.html starts an item page's first photo (item page speed, 11-09)", () => {
  it("preloads exactly the gallery's photo for each frame shape, one per media", async () => {
    const { calls, links } = await run();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/rest/v1/declutter_item_photos?select=storage_path&item_id=eq.${ITEM}&order=position.asc&limit=1`);
    const want = pagePhoto(`${BASE}/storage/v1/object/public/job-photos/${PATH}`)!;
    expect(links.map((l) => [l.getAttribute("media"), l.getAttribute("imagesrcset"), l.getAttribute("imagesizes"), l.getAttribute("as"), l.rel])).toEqual([
      [PHONE_PHOTO_MEDIA, want.phoneSrcSet, PHONE_PHOTO_SIZES, "image", "preload"],
      [WIDE_MEDIA, want.srcSet, GALLERY_SIZES, "image", "preload"],
    ]);
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

  it("anything unexpected preloads nothing", async () => {
    expect((await run({ status: 401 })).links).toHaveLength(0);
    expect((await run({ rows: [] })).links, "no photo").toHaveLength(0);
    expect((await run({ rows: [{ storage_path: "a b.jpg" }] })).links, "a path a URL would encode").toHaveLength(0);
    expect((await run({ rows: { message: "x" } })).links, "not a list").toHaveLength(0);
  });
});
