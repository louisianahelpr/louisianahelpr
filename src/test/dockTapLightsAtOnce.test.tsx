/**
 * AUD31-62: a dock tab answers the tap AT ONCE.
 *
 * React Router puts every navigation in a React transition, so while the
 * tapped tab's page chunk is still loading, `useLocation()` and the page stay
 * on the old screen. Measured by the auditor (375, Fast 4G + 4x CPU): the URL
 * changed 53-105 ms after the tap, but Home stayed on screen with Home lit for
 * 0.8 s (Messages), 1.2 s (You) and 2.6 s (Explore). Nothing answered the tap.
 *
 * The real dock is RENDERED here under the real router (transitions on, as in
 * App.tsx's BrowserRouter), with a destination page that never finishes
 * loading: the tapped tab must be lit while the old page is still shown, and
 * the router's own answer must win once a navigation commits.
 *
 * @mutate src/components/MobileNav.tsx |     const isActive = litNow ? litNow === path : active \|\| inStack; |     const isActive = active \|\| inStack;
 * @mutate src/components/MobileNav.tsx |         goTab(path, effectivePath); |         navigate(effectivePath);
 * @mutate src/components/MobileNav.tsx |   const litNow = tapped && tapped.fromKey === location.key ? tapped.path : null; |   const litNow = tapped ? tapped.path : null;
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { lazy, Suspense } from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/hooks/useFeature", () => ({
  useFeature: () => false,
  useFeatureStatus: () => ({ on: false, settled: true }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u-dock", email_confirmed_at: "2026-01-01T00:00:00Z" }, profile: { avatar_url: null, full_name: "Test Person" }, isLoading: false, isAdmin: false }),
}));
vi.mock("@/components/mobileNav/useNavUnreadCount", () => ({ useNavUnreadCount: () => ({ unreadCount: 0, markAllRead: () => {} }) }));
vi.mock("@/lib/needsYouStore", () => ({ useNeedsYouCounts: () => ({ total: 0, jobs: 0, shops: 0 }) }));
vi.mock("@/hooks/useRecentPostedJobs", () => ({ prefetchRecentPostedJobs: () => {} }));
vi.mock("@/lib/routePrefetch", () => ({ prefetchRoute: () => {}, prefetchRoutesWhenIdle: () => () => {} }));
vi.mock("@/components/mobileNav/useDockSheets", async () => { const m = await import("@/components/mobileNav/dockSheets"); return { useDockSheetsLoader: () => m }; }); // sheets at once: their lazy load is dockSheetsLoadOnTap.test.tsx
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {}, hapticMedium: () => {} }));
vi.mock("@/components/mobileNav/useDockMotion", async (orig) => ({ ...(await orig<object>()), useDockMotionLoader: () => null }));
vi.mock("@/components/mobileNav/useRecentConversationsPreview", () => ({ useRecentConversationsPreview: () => ({ data: [] }) }));
vi.mock("@/hooks/useStoredSessionHint", () => ({ useStoredSessionHint: () => true }));
vi.mock("@/lib/shops/api", () => ({ fetchMyShopId: async () => null }));

import MobileNav from "@/components/MobileNav";

/** A page chunk still on the wire: it never resolves. */
const SlowMessages = lazy(() => new Promise<{ default: () => JSX.Element }>(() => {}));

let goProfile: (() => void) | null = null;
function HomePage() {
  const nav = useNavigate();
  goProfile = () => nav("/profile");
  return <p>Home page</p>;
}

function renderApp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/home"]}>
        <MobileNav />
        <Suspense fallback={<p>Loading</p>}>
          <Routes>
            <Route path="/home" element={<HomePage />} />
            <Route path="/messages" element={<SlowMessages />} />
            <Route path="/profile" element={<p>Profile page</p>} />
          </Routes>
        </Suspense>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const lit = () =>
  [...document.querySelectorAll('nav[aria-label="Bottom navigation"] button[aria-current="page"]')].map((b) => b.getAttribute("aria-label"));

afterEach(cleanup);

describe("a dock tap answers at once (AUD31-62)", () => {
  it("lights the tapped tab while its page is still loading", () => {
    renderApp();
    expect(lit()).toEqual(["Home"]);
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    // The transition holds the old page (the exact state the auditor saw)...
    expect(screen.getByText("Home page")).toBeTruthy();
    // ...but the dock already answers the tap.
    expect(lit()).toEqual(["Messages"]);
  });

  it("lets the router's answer win once a navigation commits", async () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    expect(lit()).toEqual(["Messages"]);
    // Another navigation that does commit (a link on the page): the dock follows the router again.
    await act(async () => goProfile?.());
    expect(screen.getByText("Profile page")).toBeTruthy();
    expect(lit()).toEqual(["You"]);
  });
});
