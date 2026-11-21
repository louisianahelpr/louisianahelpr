/**
 * Jobs audit 11-21, public profile (/u/:handle) findings.
 *
 * P3: a member with no public name comes back from public_profile_by_handle as "A neighbor", and its first word
 * made "Share A's profile" (button text and aria-label) and "A hasn't posted anything yet". An unnamed profile now
 * says "Share this profile" and "This member hasn't posted anything yet".
 *
 * @mutate src/pages/u/PublicProfilePage.tsx |   const unnamed = isUnnamedProfile(p.name); |   const unnamed = false;
 * @mutate src/pages/u/PublicProfilePage.tsx | {unnamed ? "This member" : first} hasn&apos;t posted anything yet. | {first} hasn&apos;t posted anything yet.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => undefined }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "m1" }, ready: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));
vi.mock("@/lib/nativeShare", () => ({ shareNative: vi.fn(async () => "shared") }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const { default: PublicProfilePage } = await import("@/pages/u/PublicProfilePage");

const page = (name: string) => ({
  handle: "neighbor-33", name, photo_url: null, member_since: "2025-03-01T12:00:00Z",
  stats: { review_count: 0, avg_rating: null }, listings: [], jobs: [],
  helpr: { jobs_done: 0, categories: [], reviews: [] }, wanted: [],
});

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/u/neighbor-33"]}>
        <Routes><Route path="/u/:handle" element={<PublicProfilePage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => rpc.mockReset());

describe("P3: a profile with no public name never reads 'A's'", () => {
  it("the unnamed profile (\"A neighbor\") says Share this profile and This member", async () => {
    rpc.mockImplementation(async (n: string) => (n === "public_profile_by_handle" ? { data: page("A neighbor"), error: null } : { data: null, error: null }));
    show();
    const share = await screen.findByRole("button", { name: /^Share/ });
    expect(share.getAttribute("aria-label")).toBe("Share this profile");
    expect(document.body.textContent).not.toMatch(/\bA's\b/);
    expect(document.body.textContent).not.toMatch(/\bA hasn.t posted/);
    expect(screen.getByText("This member hasn't posted anything yet.")).toBeTruthy();
  });

  it("a named profile keeps its first name", async () => {
    rpc.mockImplementation(async (n: string) => (n === "public_profile_by_handle" ? { data: page("Eli B."), error: null } : { data: null, error: null }));
    show();
    const share = await screen.findByRole("button", { name: /^Share/ });
    expect(share.getAttribute("aria-label")).toBe("Share Eli's profile");
  });
});
