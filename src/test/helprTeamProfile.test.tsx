/**
 * F067 (owner UI audit 11-09; lead go-ahead 11-09): the official support account's /u page showed "Hire me", "New on
 * Helpr" and the handle "neighbor", and its bio says "Message me" with no way to. Its handle is helpr-support
 * (20261109191035, proof src/test/pglite/supportAccountHandle.pglite.mjs: the old /u/neighbor opens it), and its page
 * shows a "Helpr team" badge and "Message support" (the support form) in place of "New on Helpr" and "Hire me".
 * Every other member's page is unchanged.
 *
 * @mutate src/lib/helprTeam.ts |   return handle === HELPR_TEAM_HANDLE; |   return false;
 * @mutate src/pages/u/PublicProfilePage.tsx | (team ? <MessageSupportButton /> : <HireMeButton | (false ? <MessageSupportButton /> : <HireMeButton
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.fn();
let signedIn: { id: string } | null = null;
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => undefined }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: signedIn, ready: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));
vi.mock("@/lib/nativeShare", () => ({ shareNative: vi.fn(async () => "shared") }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const { default: PublicProfilePage } = await import("@/pages/u/PublicProfilePage");
const { HELPR_TEAM_HANDLE } = await import("@/lib/helprTeam");

const page = (handle: string) => ({
  handle, name: handle === HELPR_TEAM_HANDLE ? "Admin" : "Eli B.", photo_url: null, member_since: "2026-05-03T12:00:00Z",
  stats: { review_count: 0, avg_rating: null }, listings: [], jobs: [], helpr: { jobs_done: 0, categories: [], reviews: [] }, wanted: [],
});
const show = (handle: string) => {
  rpc.mockImplementation(async (name: string) => (name === "public_profile_by_handle" ? { data: page(handle), error: null } : { data: null, error: null }));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/u/${handle}`]}>
        <Routes><Route path="/u/:handle" element={<PublicProfilePage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => { rpc.mockReset(); signedIn = null; });

describe("F067: the official support account's page says what it is", () => {
  it("the handle is helpr-support, and the migration moves our account from neighbor to it", () => {
    expect(HELPR_TEAM_HANDLE).toBe("helpr-support");
    const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261109191035_support_account_handle_helpr_support.sql"), "utf8");
    expect(sql).toMatch(/SET handle = 'helpr-support'/);
    expect(sql).toMatch(/AND handle = 'neighbor'/);
  });

  for (const who of ["a guest", "a member"]) {
    it(`${who}: Helpr team badge and Message support (the support form); no Hire me, no New on Helpr`, async () => {
      signedIn = who === "a member" ? { id: "viewer-1" } : null;
      show(HELPR_TEAM_HANDLE);
      const btn = await screen.findByRole("link", { name: /Message support/ });
      expect(btn.getAttribute("href")).toBe("/support?topic=message");
      expect(screen.getByTestId("pp-team")).toHaveTextContent("Helpr team");
      expect(screen.queryByText("New on Helpr")).toBeNull();
      expect(screen.queryByText(/Hire me/)).toBeNull();
    });
  }

  it("any other member: unchanged (New on Helpr, Hire me)", async () => {
    show("eli-b");
    expect(await screen.findByText("New on Helpr")).toBeInTheDocument();
    expect(screen.getByText(/Hire me/)).toBeInTheDocument();
    expect(screen.queryByTestId("pp-team")).toBeNull();
    expect(screen.queryByRole("link", { name: /Message support/ })).toBeNull();
  });
});
