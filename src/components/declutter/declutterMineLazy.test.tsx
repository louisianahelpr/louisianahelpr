/**
 * A warmed Buying / Selling tab opens without its loading bones (Builder 74, 11-01). In a real browser (375, mocked
 * Supabase, service workers blocked) the first tap on Buying after /declutter had settled committed DeclutterTabBones
 * for 6 ms although the warm-up had already fetched the chunk: React.lazy suspends on its first render whatever the
 * chunk's state. DeclutterMineLazy now draws the loaded module directly once it is in hand.
 *
 * @mutate src/components/declutter/DeclutterMineLazy.tsx |   const [Impl] = useState(() => loaded?.BuyingDash ?? LazyBuying); |   const [Impl] = useState(() => LazyBuying);
 * @mutate src/components/declutter/DeclutterMineLazy.tsx |   const [Impl] = useState(() => loaded?.SellingDash ?? LazySelling); |   const [Impl] = useState(() => LazySelling);
 * @mutate src/components/declutter/DeclutterMineLazy.tsx | const loadMineViews = () => loadModule(() => import("./DeclutterMineViews")).then((m) => (m ? (loaded = m) : null)); | const loadMineViews = () => loadModule(() => import("./DeclutterMineViews"));
 */
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Suspense } from "react";

vi.mock("./DeclutterMineViews", () => ({
  BuyingDash: () => <p>buying body</p>,
  SellingDash: ({ listings }: { listings: React.ReactNode }) => <div><p>selling body</p>{listings}</div>,
}));
vi.mock("@/lib/routePrefetch", () => ({ whenPageSettled: (fn: () => void) => { fn(); return () => {}; } }));

import { BuyingDash, SellingDash, useWarmMineViews } from "./DeclutterMineLazy";

function Warm() {
  useWarmMineViews(false);
  return null;
}

describe("DeclutterMineLazy", () => {
  it("once warmed, Buying and Selling draw at once: the fallback never mounts", async () => {
    render(<Warm />);
    await act(async () => { await import("./DeclutterMineViews"); await Promise.resolve(); });
    let fallbacks = 0;
    function Bones() { fallbacks++; return <p>bones</p>; }
    const { unmount } = render(<Suspense fallback={<Bones />}><BuyingDash todo={null} /></Suspense>);
    // Synchronously after the first commit: the body, never the bones.
    expect(screen.getByText("buying body")).toBeTruthy();
    unmount();
    render(<Suspense fallback={<Bones />}><SellingDash todo={null} userId="u" listings={<p>rows</p>} /></Suspense>);
    expect(screen.getByText("selling body")).toBeTruthy();
    expect(fallbacks).toBe(0);
  });
});
