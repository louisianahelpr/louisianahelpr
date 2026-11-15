/**
 * F260a (/profile CLS: prod-audit 43650083979, 11-14, "every first screen": mobile 0.1518, desktop 0.1224, budget 0.1).
 * Reproduced on a local build against prod (cwv-lab, poster, 375 Slow 4G + 4x CPU and 1440): mobile 0.1518, desktop
 * 0.1125. The shifts, in order of size: the Your page card mounting after the page (0.0836 / 0.0448), the card turning
 * into the "Your page is hidden" line (0.0414 / 0.0293), the preview "Coming soon" marks growing Shops and Homes
 * tiles (0.0153 / 0.0139), and "Buying · 1 in progress" wrapping to a second line when its count came in (0.0114,
 * phones only). After: mobile 0 at 360, 375 and 390; desktop 0.0248 (the payout row, below the budget). Raw:
 * ~/.lh-shots/b2-perf-1114/local-before-profile-h.json, local-after-profile-h.json, after2-*.png.
 *
 * The class: an answer the You landing draws from must arrive before the landing paints (the arrival gate, at most
 * ARRIVAL_CAP_MS) or have its room kept. This holds each of the four.
 *
 * @mutate src/pages/profile/Profile.tsx | rentalsSwitch.settled && lateReadsSettled); | rentalsSwitch.settled);
 * @mutate src/components/profile/ProfileLanding.tsx |  knownHandle={profile?.handle} /> | />
 * @mutate src/components/profile/profileLanding/YourActivity.tsx | t.count ? " min-h-[3em] sm:min-h-0" : "" | ""
 * @mutate src/pages/profile/useLandingLateReads.ts |   const pageSettled = !handle \|\| !page.isPending; |   const pageSettled = true;
 * @mutate src/pages/profile/useLandingLateReads.ts |   const openSettled = !previewPossible \|\| open.settled; |   const openSettled = true;
 */
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "@/test/helpers/blankNonCode";

const api = vi.hoisted(() => ({ resolvePage: null as null | ((v: unknown) => void), calls: [] as string[] }));
const open = vi.hoisted(() => ({ settled: false, starts: [] as boolean[] }));

vi.mock("@/lib/profileLink/api", () => ({
  fetchPublicProfile: (handle: string) => {
    api.calls.push(handle);
    return new Promise((res) => { api.resolvePage = res; });
  },
}));
vi.mock("@/components/landing/useSectionsOpen", () => ({
  useSectionsOpen: (start: boolean) => {
    open.starts.push(start);
    return { open: open.settled ? new Set<string>() : null, settled: open.settled, failed: false };
  },
}));

import { useLandingLateReadsSettled } from "@/pages/profile/useLandingLateReads";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  api.resolvePage = null;
  api.calls = [];
  open.settled = false;
  open.starts = [];
});

describe("the You landing waits for its late answers (F260a)", () => {
  it("is not settled while the 'does my page open?' read is out, and settles when it answers (even 'no page')", async () => {
    const { result } = renderHook(() => useLandingLateReadsSettled("e2e-p", false), { wrapper: wrapper() });
    expect(result.current).toBe(false);
    expect(api.calls).toEqual(["e2e-p"]);
    api.resolvePage?.(null);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("waits for the open-to-everyone answer only when a preview mark is possible", () => {
    const off = renderHook(() => useLandingLateReadsSettled(null, false), { wrapper: wrapper() });
    expect(off.result.current).toBe(true);
    const on = renderHook(() => useLandingLateReadsSettled(null, true), { wrapper: wrapper() });
    expect(on.result.current).toBe(false);
    expect(open.starts).toContain(true);
    expect(open.starts).toContain(false);
  });

  it("Profile's arrival gate holds the landing for these answers, with the handle from the profile row", () => {
    const profile = blankComments(readFileSync("src/pages/profile/Profile.tsx", "utf8"));
    expect(profile).toMatch(/const lateReadsSettled = useLandingLateReadsSettled\(\(profile \?\? cachedProfile\)\?\.handle, shopsSwitch\.on \|\| rentalsSwitch\.on\);/);
    expect(profile).toMatch(/useArrivalGate\(!loading, [^)]*&& lateReadsSettled\)/);
  });

  it("the card on the landing gets the handle it already has (no handle read before it can draw)", () => {
    const landing = blankComments(readFileSync("src/components/profile/ProfileLanding.tsx", "utf8"));
    expect(landing).toMatch(/<YourPageLink [^>]*knownHandle=\{profile\?\.handle\}/);
  });

  it("a tile that can carry a count keeps two lines on a phone; a row's Coming soon marks sit at the foot", () => {
    const tiles = blankComments(readFileSync("src/components/profile/profileLanding/YourActivity.tsx", "utf8"));
    expect(tiles).toContain('t.count ? " min-h-[3em] sm:min-h-0" : ""');
    expect(tiles).toContain('<PreviewPill className="self-start mt-auto" />');
    // Inventory floor: the tiles that carry a count (Posted, Working, Buying, Selling, Orders when this landed).
    const counted = tiles.match(/count: "\w+" \}/g) ?? [];
    expect(counted.length).toBeGreaterThan(4);
  });
});
