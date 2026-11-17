/**
 * Vacuity 44108754883 (isolation): LegalTabBar was rendered only on its own
 * (publicPagesInSpanish.test.tsx); nothing rendered the Legal page that
 * mounts it, so a broken mount stayed green. This renders /legal (web, signed
 * out) and finds the Terms / Rules / Privacy tabs in it, with the tab the URL
 * names selected.
 *
 * @mutate src/pages/info/Legal.tsx |   const tabBar = <LegalTabBar tab={tab} hideIconsOnPhone={searchOpen} />; |   const tabBar = null;
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, ready: true, isReady: true, loading: false }) }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => undefined }));
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

describe("the Legal page mounts its tab bar", () => {
  it("/legal?tab=privacy draws the three tabs, Privacy selected", () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/legal?tab=privacy"]}><Legal /></MemoryRouter>
      </QueryClientProvider>,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBeGreaterThanOrEqual(3);
    const selected = tabs.filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toMatch(/Privacy/);
  });
});
