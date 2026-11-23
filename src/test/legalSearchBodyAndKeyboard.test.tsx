/**
 * App audit 11-23, the Legal page (Terms, Rules, Privacy):
 *  LT-3: "Search all policies" matched only headings (row title + a searchText no caller passed), so "Twilio" said No
 *        matches and "refund" missed the Terms rows that talk about refunds. A row now matches on its body text too.
 *  LT-4: the section headers' focus outline sat outside the full-width trigger, clipped by the card's overflow-hidden:
 *        no visible focus for a keyboard user (WCAG 2.4.7). It is drawn inside the trigger.
 *  LT-5: an arrow-key tab switch replaced the URL with a new location.key, RoutePageTransition remounted the page, and
 *        focus fell to <body>. The switch carries KEEP_PAGE, so the page stays and focus stays on the new tab.
 *
 * @mutate src/components/policy/CollapsedPolicy.tsx |   `${props.title ?? ""} ${props.searchText ?? ""} ${policyNodeText(props.body)}`; |   `${props.title ?? ""} ${props.searchText ?? ""}`;
 * @mutate src/components/policy/CollapsedPolicy.tsx | text-left btn-press focus-visible:[outline-offset:-2px] focus-visible:rounded-[19px]"> | text-left btn-press">
 * @mutate src/pages/info/Legal.tsx | setParams(nextParams, { replace: true, state: { ...((location.state as object \| null) ?? {}), [KEEP_PAGE]: true } }); | setParams(nextParams, { replace: true });
 */
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, ready: true, isReady: true, loading: false }) }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => undefined }));
vi.mock("@/components/landing/useSectionsOpen", () => ({ useSectionsOpen: () => ({ open: new Set<string>(), settled: true, failed: false }) }));
vi.mock("@/lib/nativeInit", async (orig) => ({ ...(await orig<typeof import("@/lib/nativeInit")>()), isNativePlatform: () => false }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));
vi.mock("@/integrations/supabase/client", () => {
  const empty = { data: null, error: null };
  const builder = (): unknown =>
    new Proxy(() => {}, {
      get: (_t, k) => (k === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve(empty).then(ok) : () => builder()),
      apply: () => builder(),
    });
  return { supabase: { from: () => builder(), rpc: async () => empty } };
});

import Legal from "@/pages/info/Legal";
import { RoutePageTransition } from "@/components/RoutePageTransition";
import { PolicySearchContext, policyNodeText } from "@/components/policy/CollapsedPolicy";
import { PrivacyContent } from "@/pages/info/legal/PrivacySection";

describe("LT-3: legal search reads the policy text, not only the headings", () => {
  it("policyNodeText walks nested elements", () => {
    expect(policyNodeText(<p>We use <strong>Twilio</strong> for <a href="#x">texts</a>.</p>)).toMatch(/We use\s+Twilio\s+for\s+texts/);
  });

  it("'Twilio' (only in a row's body) finds that row in the Privacy Policy", () => {
    render(
      <MemoryRouter>
        <PolicySearchContext.Provider value="Twilio">
          <PrivacyContent />
        </PolicySearchContext.Provider>
      </MemoryRouter>,
    );
    const rows = document.querySelectorAll("[data-policy-section]");
    expect(rows.length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("Twilio");
  });
});

describe("LT-4: section headers show their focus ring", () => {
  it("the section trigger draws the outline inside itself", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../components/policy/CollapsedPolicy.tsx"), "utf8"));
    const triggers = src.match(/<CollapsibleTrigger[^>]*>/g) ?? [];
    expect(triggers.length).toBeGreaterThan(1);
    for (const t of triggers) expect(t).toContain("focus-visible:[outline-offset:-2px]");
  });
});

describe("LT-5: arrow keys switch tabs and keep focus on the tab", () => {
  it("ArrowRight on Terms selects Rules, and Rules has focus", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/legal?tab=terms"]}>
          <Routes>
            <Route path="/legal" element={<RoutePageTransition><Legal /></RoutePageTransition>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.length).toBeGreaterThanOrEqual(3);
    const terms = tabs.find((t) => t.getAttribute("aria-selected") === "true")!;
    act(() => terms.focus());
    fireEvent.keyDown(terms, { key: "ArrowRight" });
    await waitFor(() => {
      const selected = screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true");
      expect(selected?.textContent).not.toBe(terms.textContent);
    });
    const selected = screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")!;
    expect(document.activeElement).toBe(selected);
  });
});
