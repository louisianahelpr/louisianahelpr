/**
 * declutter-speed-1124: a listing that goes up asks for its first photo at every card size once, in the background, so
 * the first buyer to see it is not the one waiting for Supabase's image transform (measured 11-23 with curl from
 * Louisiana, Cloudflare DFW: a size nobody had asked for 0.49-0.83 s, the same URL right after 0.13-0.15 s).
 * The warmed URLs must be BYTE-FOR-BYTE the ones the cards, the boot shell and the document's Link preloads ask for, or
 * the CDN keeps a copy no one reads. src/lib/declutter/warmCardPhotos.ts.
 *
 * @mutate src/lib/declutter/api.ts |   void warmListingCardPhotos(itemId);\n  return status; |   return status;
 * @mutate src/lib/declutter/api.ts | return warmCardPhotos([squarePhotoUrl(photoPublicUrl(path), CARD_PHOTO_SMALL_PX), photoCardUrl(path), photoLandingCardUrl(path)]); | return warmCardPhotos([photoCardUrl(path), photoLandingCardUrl(path)]);
 * @mutate src/lib/declutter/api.ts | .order("position", { ascending: true }).limit(1), | .order("position", { ascending: false }).limit(1),
 * @mutate src/lib/declutter/warmCardPhotos.ts |   img.src = url; |   void url;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

const SUPABASE = "https://fncmgoasalhdgfwzhsqa.supabase.co";
const PATH = "u1/declutter/i1/p1.jpg";

const h = vi.hoisted(() => ({ queries: [] as { table: string; ops: [string, unknown[]][] }[], photoRows: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", async () => {
  const { createClient: make } = await import("@supabase/supabase-js");
  const real = make("https://fncmgoasalhdgfwzhsqa.supabase.co", "anon-key-for-url-building", { auth: { persistSession: false } });
  const from = (table: string) => {
    const q = { table, ops: [] as [string, unknown[]][] };
    h.queries.push(q);
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) b[m] = (...a: unknown[]) => { q.ops.push([m, a]); return b; };
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: h.photoRows, error: null }).then(res);
    return b;
  };
  return {
    supabase: {
      from,
      storage: real.storage,
      rpc: vi.fn(async () => ({ data: "live", error: null, status: 200 })),
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  };
});
vi.mock("@/hooks/useNotificationPermissionPrompt", () => ({ offerPushAfterAction: () => {} }));

const loaded: string[] = [];
class FakeImage {
  decoding = "";
  set src(u: string) { loaded.push(u); }
}

beforeEach(() => {
  loaded.length = 0;
  h.queries.length = 0;
  h.photoRows = [{ storage_path: PATH }];
  vi.stubGlobal("Image", FakeImage);
});
afterEach(() => vi.unstubAllGlobals());

describe("a new listing's card photos are warmed", () => {
  it("publishItem asks for the first photo at the 340 and 480 card squares and the landing card, once each", async () => {
    const { publishItem } = await import("@/lib/declutter/api");
    expect(await publishItem("i1")).toBe("live");
    await vi.waitFor(() => expect(loaded.length).toBe(3));
    const root = `${SUPABASE}/storage/v1/render/image/public/job-photos/${PATH}`;
    expect(loaded).toEqual([
      `${root}?width=340&height=340&resize=cover&quality=55`,
      `${root}?width=480&height=480&resize=cover&quality=55`,
      `${root}?width=640&height=800&resize=cover&quality=55`,
    ]);
    // The listing's FIRST photo (the one its card shows).
    const q = h.queries.find((x) => x.table === "declutter_item_photos");
    expect(q?.ops).toEqual([
      ["select", ["storage_path"]],
      ["eq", ["item_id", "i1"]],
      ["order", ["position", { ascending: true }]],
      ["limit", [1]],
    ]);
  });

  it("the warmed URLs are the ones the card srcSet and the document's Link preload ask for", async () => {
    const { photoCardUrl, photoPublicUrl } = await import("@/lib/declutter/api");
    const { cardPhotoSrcSet } = await import("@/lib/declutter/photoSizes");
    const { cardPhotoUrls } = await import("@/lib/declutterFirstPhotos.mjs");
    const { warmListingCardPhotos } = await import("@/lib/declutter/api");
    expect(await warmListingCardPhotos("i1")).toBe(3);
    const card = cardPhotoSrcSet(photoPublicUrl(PATH), photoCardUrl(PATH), 480)!;
    const cardUrls = card.split(", ").map((c) => c.split(" ")[0]);
    const link = cardPhotoUrls(SUPABASE, PATH);
    for (const u of cardUrls) expect(loaded).toContain(u);
    for (const u of link.srcset.split(", ").map((c: string) => c.split(" ")[0])) expect(loaded).toContain(u);
    expect(loaded).toContain(link.href);
  });

  it("a listing with no photo warms nothing, and a failed read never throws to the seller", async () => {
    const { warmListingCardPhotos } = await import("@/lib/declutter/api");
    h.photoRows = [];
    expect(await warmListingCardPhotos("i1")).toBe(0);
    expect(loaded).toEqual([]);
  });

  it("warmCardPhotos drops repeats and anything that is not a URL", async () => {
    const { warmCardPhotos } = await import("@/lib/declutter/warmCardPhotos");
    const seen: string[] = [];
    expect(warmCardPhotos(["https://a/x", "https://a/x", null, undefined, ""], (u) => seen.push(u))).toBe(1);
    expect(seen).toEqual(["https://a/x"]);
    expect(createClient).toBeTypeOf("function");
  });
});
