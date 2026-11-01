/**
 * DECLUTTER CARDS LOAD THUMBNAILS (owner 10-31: "When you're scrolling on declutter it takes the pictures awhile to
 * load"). Measured 2026-10-31 (B50, ~/.lh-shots/b50/speed-*.json): the grid fetched each listing's full original
 * (431 KB per card; the first 12 cards' photos took 40.2 s on Slow 4G at 375). Now a card asks for a 480 px square
 * from Supabase's image transform (29 KB per card, 4.0 s for the same 12).
 *
 * (a) the card's <img> asks for the transform URL at CARD_PHOTO_PX, with its shape (width/height) and async decoding;
 * (b) a failed thumbnail falls back to the full photo, and a second failure leaves the category icon;
 * (c) a later card's photo is lazy and is switched to eager once within LOAD_AHEAD_PX of the list's scroller;
 *     a first-row photo stays eager with high priority;
 * (d) the item page keeps the full photo (photoPublicUrl, not photoCardUrl).
 *
 * @mutate src/components/declutter/DeclutterItemCard.tsx |             src={photoStage === "card" ? photoCardUrl(photoPath) : photoPublicUrl(photoPath)} |             src={photoPublicUrl(photoPath)}
 * @mutate src/lib/declutter/api.ts |     .getPublicUrl(path, { transform: { width: CARD_PHOTO_PX, height: CARD_PHOTO_PX, resize: "cover", quality: 70 } }).data.publicUrl; |     .getPublicUrl(path).data.publicUrl;
 * @mutate src/components/declutter/DeclutterItemCard.tsx | setPhotoStage((s) => (s === "card" ? "full" : "failed")); }} | setPhotoStage("failed"); }}
 * @mutate src/components/declutter/DeclutterItemCard.tsx | decoding="async"\n            {...(firstRow | {...(firstRow
 * @mutate src/components/declutter/useLoadPhotoAhead.ts |         img.setAttribute("loading", "eager"); |
 * @mutate src/components/declutter/useLoadPhotoAhead.ts |       { root: scrollParent(img), rootMargin: `0px 0px ${LOAD_AHEAD_PX}px 0px` }, |       { root: null },
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string, opts?: { transform?: { width?: number; height?: number; resize?: string; quality?: number } }) => {
          const t = opts?.transform;
          const base = "https://ref.supabase.co/storage/v1";
          return {
            data: {
              publicUrl: t
                ? `${base}/render/image/public/${bucket}/${path}?width=${t.width}&height=${t.height}&resize=${t.resize}&quality=${t.quality}`
                : `${base}/object/public/${bucket}/${path}`,
            },
          };
        },
      }),
    },
  },
}));

import { ItemCard } from "@/components/declutter/DeclutterItemCard";
import { CARD_PHOTO_PX } from "@/lib/declutter/api";
import { LOAD_AHEAD_PX } from "@/components/declutter/useLoadPhotoAhead";
import { resetFirstRowPhotoGate } from "@/components/declutter/firstRowPhotoGate";
import type { DeclutterItem } from "@/lib/declutter/api";

const ROOT = resolve(__dirname, "../..");
const item: DeclutterItem = {
  id: "i1", seller_id: "s1", status: "live", title: "Lamp", description: "", category: "home", condition_stars: 4, delivery_size: "small",
  price_cents: 2500, current_price_cents: 2500, area_label: "Mid City", area_lat: 30.45, area_lng: -91.15, created_at: "2026-10-30T00:00:00Z",
  live_at: "2026-10-30T00:00:00Z", porch_ok: true,
};

const observers: { cb: IntersectionObserverCallback; opts?: IntersectionObserverInit; target?: Element }[] = [];
class FakeIO {
  constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) { observers.push({ cb, opts }); }
  observe(t: Element) { observers[observers.length - 1].target = t; }
  disconnect() {}
  unobserve() {}
  takeRecords() { return []; }
}

beforeEach(() => {
  observers.length = 0;
  resetFirstRowPhotoGate();
  vi.stubGlobal("IntersectionObserver", FakeIO);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// A later card's photo renders once firstRowPhotoGate opens (at once here: no first-row photo is in flight, B77).
const card = async (firstRow = false) => {
  const r = render(<MemoryRouter><ItemCard item={item} photoPath="u/declutter/i1/p.jpg" miles={1} approximate={false} firstRow={firstRow} /></MemoryRouter>);
  await vi.waitFor(() => expect(r.container.querySelector("img")).not.toBeNull());
  return r;
};

describe("Declutter cards load thumbnails, not originals", () => {
  it("(a) asks for the card-sized transform with its shape and async decoding", async () => {
    const { container } = await card();
    const img = container.querySelector("img")!;
    expect(CARD_PHOTO_PX).toBeGreaterThanOrEqual(400);
    expect(CARD_PHOTO_PX).toBeLessThanOrEqual(512);
    expect(img.getAttribute("src")).toContain("/render/image/public/job-photos/u/declutter/i1/p.jpg");
    expect(img.getAttribute("src")).toContain(`width=${CARD_PHOTO_PX}`);
    expect(img.getAttribute("width")).toBe(String(CARD_PHOTO_PX));
    expect(img.getAttribute("height")).toBe(String(CARD_PHOTO_PX));
    expect(img.getAttribute("decoding")).toBe("async");
  });

  it("(b) a failed thumbnail falls back to the full photo, then to the icon", async () => {
    const { container } = await card();
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")!.getAttribute("src")).toBe("https://ref.supabase.co/storage/v1/object/public/job-photos/u/declutter/i1/p.jpg");
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
  });

  it("(c) a later card's photo is lazy until it is within LOAD_AHEAD_PX of the scroller; the first row is eager", async () => {
    const { container } = await card();
    const img = container.querySelector("img")!;
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(observers).toHaveLength(1);
    expect(observers[0].opts?.rootMargin).toBe(`0px 0px ${LOAD_AHEAD_PX}px 0px`);
    expect(LOAD_AHEAD_PX).toBeGreaterThanOrEqual(600);
    observers[0].cb([{ isIntersecting: true, target: img } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(img.getAttribute("loading")).toBe("eager");
    cleanup();
    observers.length = 0;
    const first = (await card(true)).container.querySelector("img")!;
    expect(first.getAttribute("loading")).toBe("eager");
    expect(first.getAttribute("fetchpriority")).toBe("high");
    expect(observers).toHaveLength(0);
  });

  it("(d) the item page keeps the full photo", () => {
    const view = blankComments(readFileSync(resolve(ROOT, "src/components/declutter/DeclutterItemView.tsx"), "utf8"));
    expect(view).toMatch(/photoPublicUrl\(p\.storage_path\)/);
    expect(view).not.toMatch(/photoCardUrl/);
  });
});
