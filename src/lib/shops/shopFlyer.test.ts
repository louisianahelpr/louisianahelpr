/**
 * The printable shop sign (src/lib/shops/shopFlyer.ts, SH2b(d)): what it
 * draws, how it is named and handed to the share sheet, and how it fails.
 *
 * Added for nightly-red #3415 (main: Vitest, "Coverage floor"): train11
 * (4e9a47590) added shopFlyer.ts with no test, and src/lib/ line coverage fell
 * from 81.2% (6345/7814, dde576de2) to 80.18% (6362/7935) under its 81.17%
 * floor. jsdom draws no canvas, so the 2D context is a recording stand-in;
 * the assertions are on what the sign SAYS, not on pixels.
 *
 * @mutate src/lib/shops/shopFlyer.ts |   if (!ctx) throw new Error("canvas_unavailable"); |   if (!ctx) return new Blob();
 * @mutate src/lib/shops/shopFlyer.ts |   for (const line of wrap(ctx, shop.name, W - 160).slice(0, 3)) { |   for (const line of wrap(ctx, shop.name, W - 160).slice(0, 1)) {
 * @mutate src/lib/shops/shopFlyer.ts |   const what = [shop.category_label, shop.area_label].filter(Boolean).join(" · "); |   const what = [shop.category_label].filter(Boolean).join(" · ");
 * @mutate src/lib/shops/shopFlyer.ts | .slice(0, 40) \|\| "shop"; | .slice(0, 40) \|\| "flyer";
 * @mutate src/lib/shops/shopFlyer.ts |     img.onerror = () => resolve(null); |     img.onerror = () => resolve(img);
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const share = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/nativeShare", () => ({
  shareFileNative: vi.fn(async (c: Record<string, unknown>) => {
    share.calls.push(c);
    return "downloaded";
  }),
}));

import { saveShopFlyer } from "./shopFlyer";
import { shopLink } from "./publicShop";

type Drawn = { text: string; font: string };
let drawn: Drawn[];
let drewImage: number;
let hasContext: boolean;
let blobOut: Blob | null;
let imageLoads: boolean;

function fakeContext() {
  const ctx = {
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    fillRect: vi.fn(),
    // ~50px a character at the name size, so a long name must wrap at W - 160 (1115px).
    measureText: (t: string) => ({ width: t.length * 50 }),
    fillText: (text: string) => drawn.push({ text, font: ctx.font }),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    drawImage: () => { drewImage++; },
  };
  return ctx;
}

const realCreate = document.createElement.bind(document);
const RealImage = globalThis.Image;

beforeEach(() => {
  drawn = [];
  drewImage = 0;
  hasContext = true;
  blobOut = new Blob(["png"], { type: "image/png" });
  imageLoads = true;
  share.calls.length = 0;
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const el = realCreate(tag);
    if (tag === "canvas") {
      Object.assign(el, {
        getContext: () => (hasContext ? fakeContext() : null),
        toBlob: (cb: (b: Blob | null) => void) => cb(blobOut),
      });
    }
    return el;
  }) as typeof document.createElement);
  class FakeImage {
    width = 800;
    height = 600;
    crossOrigin = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) {
      queueMicrotask(() => (imageLoads ? this.onload?.() : this.onerror?.()));
    }
  }
  globalThis.Image = FakeImage as unknown as typeof Image;
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.Image = RealImage;
});

const texts = () => drawn.map((d) => d.text);

describe("saveShopFlyer: the printable sign", () => {
  it("says the name, what and where, the call to action and the link split site / path", async () => {
    const out = await saveShopFlyer({ id: "shop-42", name: "Bayou Bakes", category_label: "Bakery", area_label: "Lafayette" });
    expect(out).toBe("downloaded");
    const [site, path] = (() => {
      const url = shopLink("shop-42").replace(/^https:\/\/www\./, "");
      const cut = url.indexOf("/shops/");
      return [url.slice(0, cut) + "/shops/", url.slice(cut + "/shops/".length)];
    })();
    expect(texts()).toEqual([
      "Bayou Bakes",
      "Bakery · Lafayette",
      "Order and message us on Louisiana Helpr",
      site,
      path,
      'Or search "Bayou Bakes" in the app',
    ]);
    expect(path).toBe("shop-42");
    expect(site.endsWith("/shops/")).toBe(true);
    expect(site.startsWith("https://www.")).toBe(false);
    // The name is the biggest text on the sign.
    expect(drawn[0].font).toMatch(/^800 110px /);
  });

  it("wraps a long name onto at most 3 lines and leaves out an empty what/where line", async () => {
    await saveShopFlyer({ id: "s1", name: "The Very Long Named Family Kitchen And Garden Supply Company Of South Louisiana Parish Wide" });
    const nameLines = drawn.filter((d) => d.font.startsWith("800 110px")).map((d) => d.text);
    expect(nameLines).toHaveLength(3);
    for (const l of nameLines) expect(l.length * 50).toBeLessThanOrEqual(1275 - 160);
    expect(drawn.some((d) => d.font.startsWith("600 52px"))).toBe(false);
  });

  it("draws the logo when it loads, and the sign without it when it does not", async () => {
    await saveShopFlyer({ id: "s1", name: "Logo Shop", logoUrl: "https://example.test/logo.png" });
    expect(drewImage).toBe(1);
    drewImage = 0;
    imageLoads = false;
    await saveShopFlyer({ id: "s1", name: "Logo Shop", logoUrl: "https://example.test/missing.png" });
    expect(drewImage).toBe(0);
    expect(texts()).toContain("Logo Shop");
  });

  it("names the file from the shop (slug) and hands the PNG to the share sheet", async () => {
    await saveShopFlyer({ id: "s1", name: "  Café & Co.!! Lafayette  " });
    const c = share.calls[0];
    expect(c.fileName).toBe("caf-co-lafayette-sign.png");
    expect(c.title).toBe("  Café & Co.!! Lafayette   sign");
    expect(c.dialogTitle).toBe("Save or print your shop sign");
    expect(c.source).toBe("shopFlyer");
    expect(c.blob).toBe(blobOut);
    expect(c.base64).toBe(btoa("png"));
    // A name with no letters or digits still gets a file name.
    await saveShopFlyer({ id: "s2", name: "!!!" });
    expect(share.calls[1].fileName).toBe("shop-sign.png");
  });

  it("fails loudly when the browser has no canvas, or draws nothing", async () => {
    hasContext = false;
    await expect(saveShopFlyer({ id: "s1", name: "X" })).rejects.toThrow("canvas_unavailable");
    hasContext = true;
    blobOut = null;
    await expect(saveShopFlyer({ id: "s1", name: "X" })).rejects.toThrow("flyer_not_drawn");
    expect(share.calls).toHaveLength(0);
  });
});
