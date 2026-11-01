/**
 * THE FIRST ROW'S PHOTOS LOAD FIRST (B77, 2026-11-01). cwv-lab (customer, 375 Slow 4G + 4x CPU) measured /declutter's
 * largest paint, the first card's photo, at 11.9 s: it started together with 15 more card photos and took 3.1 s for
 * 26 KB. A later card asks for its photo only once every first-row photo has loaded or failed, or MAX_WAIT_MS passed;
 * with no first-row photo in flight it asks at once.
 *
 * @mutate src/components/declutter/DeclutterItemCard.tsx | {photoPath && photoStage !== "failed" && (firstRow \|\| laterOpen) && ( | {photoPath && photoStage !== "failed" && (
 * @mutate src/components/declutter/firstRowPhotoGate.ts |     if (pending <= 0) openGate();\n  }; |   };
 * @mutate src/components/declutter/firstRowPhotoGate.ts |   if (!timer) timer = setTimeout(openGate, MAX_WAIT_MS); |
 * @mutate src/components/declutter/firstRowPhotoGate.ts |       if (pending <= 0) openGate();\n    }, 0); |     }, 0);
 * @mutate src/components/declutter/DeclutterItemCard.tsx |             onLoad={photoSettled}\n |
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ItemCard } from "./DeclutterItemCard";
import { MAX_WAIT_MS, resetFirstRowPhotoGate } from "./firstRowPhotoGate";
import type { DeclutterItem } from "@/lib/declutter/api";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: (b: string) => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://ref.supabase.co/storage/v1/object/public/${b}/${p}` } }) }) } },
}));

const item = (id: string) => ({ id, title: `Item ${id}`, category: "furniture", current_price_cents: 1000, status: "live" }) as unknown as DeclutterItem;

function grid(firstRowCount: number, total = 4) {
  return render(
    <MemoryRouter>
      {Array.from({ length: total }, (_, i) => (
        <ItemCard key={i} item={item(`i${i}`)} photoPath={`u/${i}.jpg`} miles={1} approximate={false} firstRow={i < firstRowCount} />
      ))}
    </MemoryRouter>,
  );
}
const photos = (c: HTMLElement) => Array.from(c.querySelectorAll("[data-item-card] img"));

describe("a later card's photo waits for the first row's", () => {
  beforeEach(() => resetFirstRowPhotoGate());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("asks for later photos only after every first-row photo has loaded or failed", async () => {
    const { container } = grid(2);
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(photos(container)).toHaveLength(2);
    fireEvent.load(photos(container)[0]);
    expect(photos(container)).toHaveLength(2);
    fireEvent.error(photos(container)[1]);
    expect(photos(container)).toHaveLength(4);
  });

  it("a stalled first row holds the rest for MAX_WAIT_MS at most", async () => {
    vi.useFakeTimers();
    const { container } = grid(2);
    await act(async () => { vi.advanceTimersByTime(MAX_WAIT_MS - 10); });
    expect(photos(container)).toHaveLength(2);
    await act(async () => { vi.advanceTimersByTime(20); });
    expect(photos(container)).toHaveLength(4);
  });

  it("with no first-row card (the item page's rows) every photo asks at once", async () => {
    const { container } = grid(0, 3);
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(photos(container)).toHaveLength(3);
  });
});
