/**
 * F066 (owner UI audit 11-09): /u/<handle> had no site header for a guest arriving from a shared link (no logo, Jobs,
 * Declutter, Log in / Join free). A guest gets the public shell every other public page uses (PublicHeaderPage: the
 * site header and footer); a member keeps the app page; nothing switches before auth is ready.
 *
 * @mutate src/pages/u/PublicProfilePage.tsx |   const guestShell = isReady && !user; |   const guestShell = false;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.fn();
const auth = vi.hoisted(() => ({ user: null as { id: string } | null, isReady: true }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main data-shell="app">{children}</main> }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children, title }: { children: ReactNode; title: string }) => <main data-shell="public" data-title={title}>{children}</main>,
}));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => undefined }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => auth }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));
vi.mock("@/lib/nativeShare", () => ({ shareNative: vi.fn(async () => "shared") }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const { default: PublicProfilePage } = await import("@/pages/u/PublicProfilePage");

const PAGE = { handle: "eli-b", name: "Eli B.", photo_url: null, member_since: "2025-03-01T12:00:00Z", stats: { review_count: 0 },
  listings: [], jobs: [], helpr: { jobs_done: 0, categories: [], reviews: [] }, wanted: [] };
const show = () => {
  rpc.mockImplementation(async (name: string) => (name === "public_profile_by_handle" ? { data: PAGE, error: null } : { data: null, error: null }));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/u/eli-b"]}><Routes><Route path="/u/:handle" element={<PublicProfilePage />} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => { rpc.mockReset(); auth.user = null; auth.isReady = true; });

describe("F066: a guest's profile page has the site header", () => {
  it("guest (auth ready, signed out): the public shell with the site header", async () => {
    const { container } = show();
    await screen.findByText("Eli B.", { selector: "h2, h1, p, span, div" }).catch(() => null);
    expect(container.querySelector("[data-shell]")?.getAttribute("data-shell")).toBe("public");
  });

  it("member: the app page, as before", () => {
    auth.user = { id: "u1" };
    const { container } = show();
    expect(container.querySelector("[data-shell]")?.getAttribute("data-shell")).toBe("app");
  });

  it("auth not ready yet: never the guest header (no flash for a member's cold open)", () => {
    auth.isReady = false;
    const { container } = show();
    expect(container.querySelector("[data-shell]")?.getAttribute("data-shell")).toBe("app");
  });
});
