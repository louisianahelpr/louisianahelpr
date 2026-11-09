// @mutate src/components/declutter/DeclutterItemRows.tsx |     queryFn: () => fetchSellerItems(item.seller_id, item.id),\n    enabled: near, |     queryFn: () => fetchSellerItems(item.seller_id, item.id),
// @mutate src/components/declutter/DeclutterItemRows.tsx |     queryFn: () => fetchSimilarItems(item.category, item.id, item.seller_id),\n    enabled: near, |     queryFn: () => fetchSimilarItems(item.category, item.id, item.seller_id),
/**
 * F062 (UI audit 11-09): "More from this seller" sat as grey bones for 4+ s after the item loaded: its reads started
 * with the item and shared the line with the item's photo and code. They now start only when the rows come near the
 * screen; until then the same bones hold the space.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const reads = vi.hoisted(() => ({ more: 0, similar: 0 }));
vi.mock("@/lib/declutter/api", async () => ({
  ...(await vi.importActual<object>("@/lib/declutter/api")),
  fetchSellerItems: async () => { reads.more++; return [{ id: "a1", seller_id: "s1", status: "live", title: "Lamp", category: "home_decor", condition_stars: 4, price_cents: 500, current_price_cents: 500, area_label: "X", area_lat: 30, area_lng: -91 }]; },
  fetchSimilarItems: async () => { reads.similar++; return []; },
  fetchPhotos: async () => [],
}));
import { DeclutterItemRows, ROWS_NEAR_MARGIN } from "@/components/declutter/DeclutterItemRows";

const ITEM = { id: "i1", seller_id: "s1", category: "home_decor" } as never;
let fire: ((on: boolean) => void) | null = null;
const margins: string[] = [];

function stubObserver() {
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private cb: (e: { isIntersecting: boolean }[]) => void, opts: { rootMargin?: string }) { margins.push(opts?.rootMargin ?? ""); fire = (on) => this.cb([{ isIntersecting: on }]); }
    observe() {}
    disconnect() {}
  });
}

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><DeclutterItemRows item={ITEM} viewerId="u1" from={null} /></MemoryRouter></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); reads.more = 0; reads.similar = 0; fire = null; margins.length = 0; });

describe("F062: the rows under an item read only when they come near the screen", () => {
  it("far below the screen: the bones hold the space and nothing is read", async () => {
    stubObserver();
    open();
    expect(screen.getByRole("status", { name: "Loading more items" })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(reads).toEqual({ more: 0, similar: 0 });
    expect(margins).toContain(ROWS_NEAR_MARGIN);
  });

  it("near the screen: both rows are read and drawn", async () => {
    stubObserver();
    open();
    fire!(true);
    expect(await screen.findByRole("region", { name: "More from this seller" })).toBeTruthy();
    expect(reads).toEqual({ more: 1, similar: 1 });
  });
});
