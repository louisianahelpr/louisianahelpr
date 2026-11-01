/**
 * Post a job's Declutter haul-away prefill (docs/specs/declutter-haul-away.md;
 * lh-silent-failure review 2026-10-16 #6, #8, #9): `?haulAway=` fills a moving
 * job from the seller's listing(s) and hands back the item ids the submit links,
 * applies ONCE per link (a switch that reads off then on again must not
 * overwrite edits or add the photos twice), says when an item was left out,
 * and copies the listing photos onto the job. The lib calls are stubbed; the
 * server proof is src/test/pglite/declutterHaulAway.pglite.mjs.
 *
 * @mutate src/pages/post-job/useHaulAwayPrefill.ts |     if (!on \|\| !raw \|\| applied.current === raw) return; |     if (!on \|\| !raw) return;
 * @mutate src/pages/post-job/useHaulAwayPrefill.ts |       setItemIds(p.itemIds); |       setItemIds(null);
 * @mutate src/pages/post-job/useHaulAwayPrefill.ts |       if (left > 0) toast( |       if (false) toast(
 * @mutate src/pages/post-job/useHaulAwayPrefill.ts |       s.setRequirePhotoProof(true); |       s.setRequirePhotoProof(false);
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ on: true, rows: [] as unknown[], toasts: [] as string[], empty: 0 }));
// B68: a prevented preload (Vite resolves the import with undefined) for the next `h.empty` loads.
vi.mock("@/lib/loadModule", async (orig) => {
  const real = await orig<typeof import("@/lib/loadModule")>();
  return { ...real, loadModule: async <T,>(load: () => Promise<T>) => (h.empty > 0 ? (h.empty--, null) : real.loadModule(load)) };
});
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => h.on }));
vi.mock("sonner", () => ({
  toast: Object.assign((m: string) => h.toasts.push(m), { error: (m: string) => h.toasts.push(`error:${m}`) }),
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/declutter/api", () => ({
  fetchMyItemPrivate: async () => ({ pickup_address: "1234 Example St, Baton Rouge, LA 70806" }),
  photoPublicUrl: (p: string) => `https://cdn.test/${p}`,
}));
vi.mock("@/lib/declutter/haulAway", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/haulAway")>()),
  fetchHaulAwayState: async () => h.rows,
}));

import { useHaulAwayPrefill } from "./useHaulAwayPrefill";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const row = (id: string, state: string, photos: string[] = []) => ({
  item_id: id, title: "Oak rocking chair", description: "", delivery_size: "large", item_status: "live",
  state, eligible_at: null, job_id: null, pickup_group: "g", photo_paths: photos,
});

function setters() {
  return {
    setCategory: vi.fn(), setTitle: vi.fn(), setDescription: vi.fn(), setBudget: vi.fn(),
    setStreetAddress: vi.fn(), setCity: vi.fn(), setAddrState: vi.fn(), setZipCode: vi.fn(),
    setRequirePhotoProof: vi.fn(), addPrefillImages: vi.fn(),
  };
}

beforeEach(() => {
  h.on = true;
  h.toasts.length = 0;
  h.empty = 0;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["x"], { type: "image/jpeg" }) })));
});
afterEach(() => vi.unstubAllGlobals());

describe("useHaulAwayPrefill", () => {
  it("fills the job, turns photo proof on, copies the photos and hands back the ids", async () => {
    h.rows = [row(A, "eligible", ["a/1.jpg"])];
    const s = setters();
    const { result } = renderHook(() => useHaulAwayPrefill(new URLSearchParams(`haulAway=${A}`), s));
    await waitFor(() => expect(s.addPrefillImages).toHaveBeenCalled());
    expect(result.current).toEqual([A]);
    expect(s.setCategory).toHaveBeenCalledWith("moving");
    expect(s.setTitle).toHaveBeenCalledWith("Haul away: Oak rocking chair");
    expect(s.setBudget).toHaveBeenCalledWith("40");
    expect(s.setRequirePhotoProof).toHaveBeenCalledWith(true);
    expect(s.setCity).toHaveBeenCalled();
    expect((s.addPrefillImages.mock.calls[0][0] as File[]).length).toBe(1);
  });

  it("applies once per link, even when the switch reads off then on again", async () => {
    h.rows = [row(A, "eligible")];
    const s = setters();
    const params = new URLSearchParams(`haulAway=${A}`);
    const { rerender } = renderHook(() => useHaulAwayPrefill(params, s));
    await waitFor(() => expect(s.setTitle).toHaveBeenCalledTimes(1));
    h.on = false;
    rerender();
    h.on = true;
    rerender();
    await new Promise((r) => setTimeout(r, 20));
    expect(s.setTitle).toHaveBeenCalledTimes(1);
  });

  it("says when an item was left out, and fills nothing when none can go", async () => {
    h.rows = [row(A, "eligible"), row(B, "in_sale")];
    const s = setters();
    const { result } = renderHook(() => useHaulAwayPrefill(new URLSearchParams(`haulAway=${A},${B}`), s));
    await waitFor(() => expect(result.current).toEqual([A]));
    expect(h.toasts.some((t) => t.startsWith("1 item couldn't be included"))).toBe(true);

    h.rows = [row(A, "paying")];
    const s2 = setters();
    const r2 = renderHook(() => useHaulAwayPrefill(new URLSearchParams(`haulAway=${A}`), s2));
    await waitFor(() => expect(h.toasts.some((t) => t.includes("checkout is open"))).toBe(true));
    expect(r2.result.current).toBeNull();
    expect(s2.setTitle).not.toHaveBeenCalled();
  });

  it("does nothing with the switch off or no param", async () => {
    h.on = false;
    const s = setters();
    renderHook(() => useHaulAwayPrefill(new URLSearchParams(`haulAway=${A}`), s));
    h.on = true;
    const s2 = setters();
    renderHook(() => useHaulAwayPrefill(new URLSearchParams(""), s2));
    await new Promise((r) => setTimeout(r, 20));
    expect(s.setTitle).not.toHaveBeenCalled();
    expect(s2.setTitle).not.toHaveBeenCalled();
  });

  /**
   * B68 (review of 5d490e886e): the link is marked applied before the code loads, so an empty module must not
   * return silently (the prefill would be lost for good with no word). It fails into failed(): told and reported.
   * @mutate src/pages/post-job/useHaulAwayPrefill.ts |       const d = loaded ?? (await untilReload()); |       if (!loaded) return;\n      const d = loaded;
   */
  it("the haul-away code comes back empty and no reload follows: the seller is told, never a silent drop", async () => {
    h.rows = [row(A, "eligible")];
    h.empty = 1;
    const s = setters();
    renderHook(() => useHaulAwayPrefill(new URLSearchParams(`haulAway=${A}`), s));
    await waitFor(() => expect(h.toasts.some((t) => t.startsWith("error:Couldn't load your items"))).toBe(true));
    expect(s.setTitle).not.toHaveBeenCalled();
  });
});
