/**
 * `/data-rights` (the URL the iOS App Store privacy listing points at) must land
 * on the "Download your data" card inside the reader's OWN surface.
 *
 * VN-47 moved the card into the Privacy Policy and pointed `/data-rights` at the
 * public `/privacy#download-your-data` for everyone. A signed-in user then sat on
 * a page with no app navigation — /privacy is in neither desktopNavRoutes'
 * AUTH_PREFIXES nor mobileNavHelpers' authPages — which is the bounce out of the
 * app the owner forbade (2026-08-30). Signed in now goes to the Legal tab's
 * Privacy panel; signed out keeps the public page. And the choice waits for the
 * auth snapshot: a still-restoring `user: null` must not pick the public page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const auth = vi.hoisted(() => ({
  state: { user: null as { id: string } | null, isReady: false },
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => auth.state }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

import DataRightsRedirect from "./DataRightsRedirect";
import { DATA_EXPORT_ANCHOR, dataRightsTarget } from "./dataExportAnchor";
import { LegalTab } from "@/components/profile/LegalTab";

function Where() {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="where">{pathname + search + hash}</output>;
}

const visitDataRights = () =>
  render(
    <MemoryRouter initialEntries={["/data-rights"]}>
      <Routes>
        <Route path="/data-rights" element={<><DataRightsRedirect /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  auth.state = { user: null, isReady: false };
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("/data-rights lands on the export card in the reader's own surface", () => {
  it("signed in → the in-app Legal tab's Privacy panel, at the card", () => {
    auth.state = { user: { id: "user-1" }, isReady: true };
    visitDataRights();
    expect(screen.getByTestId("where")).toHaveTextContent(
      `/profile?tab=legal&doc=privacy#${DATA_EXPORT_ANCHOR}`,
    );
  });

  it("signed out → the public Privacy Policy, at the card", () => {
    auth.state = { user: null, isReady: true };
    visitDataRights();
    expect(screen.getByTestId("where")).toHaveTextContent(`/privacy#${DATA_EXPORT_ANCHOR}`);
    expect(screen.getByTestId("where")).not.toHaveTextContent("/profile");
  });

  it("does not choose while the auth snapshot is still restoring", () => {
    auth.state = { user: null, isReady: false };
    visitDataRights();
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/data-rights$/);
  });

  it("the signed-in target really opens the Privacy panel and scrolls the card into view", async () => {
    auth.state = { user: { id: "user-1" }, isReady: true };
    const target = dataRightsTarget(true);
    // BrowserRouter keeps window.location in step with the route; the card's
    // anchor handling reads the real hash, so mirror that here.
    window.history.replaceState(null, "", target);
    const scrolled: Element[] = [];
    // jsdom has no scrollIntoView; the card calls it optionally, so install one.
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[target]}>
          <LegalTab onBack={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("tab", { name: "Privacy" })).toHaveAttribute("aria-selected", "true");
    const card = document.getElementById(DATA_EXPORT_ANCHOR);
    expect(card).not.toBeNull();
    try {
      await waitFor(() => expect(scrolled).toContain(card));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

// Deciding from a still-restoring `user: null` is the defect: a signed-in
// reader is sent to the public policy page, which carries no app nav, and left
// there. Drop the isReady hold and that is exactly what happens.
// @mutate src/pages/legal/DataRightsRedirect.tsx | if (!isReady) return <div className="min-h-screen bg-premium-page" />; | 
