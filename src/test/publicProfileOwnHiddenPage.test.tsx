/**
 * F282a (whole-app audit 11-10, W2): "Your page: louisianahelpr.com/u/<handle>" on You opened "This profile isn't
 * available ... isn't public right now" for the member herself. public_profile_by_handle hides unverified, banned,
 * seed, anonymised, under-18 and test members (profile_page_hidden, 20261105172514), and that is right for everyone
 * else; but the owner was told nothing about why their own link is a dead end. When the signed-in member's own handle
 * is the one that came back empty, the page now says the page is theirs and hidden, why that happens and where to go,
 * instead of the stranger's "link may be old" copy. A stranger on the same URL still gets the generic card.
 *
 * @mutate src/pages/u/PublicProfilePage.tsx | const ownHidden = !!handle && !!me?.handle && me.handle === handle; | const ownHidden = false;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.fn();
let signedIn: { id: string } | null = null;
let myHandle: string | null = null;
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/components/AppPage", () => ({ default: ({ title, children }: { title?: ReactNode; children: ReactNode }) => <main><h1>{title}</h1>{children}</main> }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => undefined }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: signedIn, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: myHandle ? { handle: myHandle } : null, isLoading: false }) }));
vi.mock("@/lib/nativeShare", () => ({ shareNative: vi.fn(async () => "shared") }));

const { default: PublicProfilePage } = await import("@/pages/u/PublicProfilePage");

const show = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/u/:handle" element={<PublicProfilePage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  signedIn = null;
  myHandle = null;
});

describe("the owner's own hidden /u page (F282a)", () => {
  it("tells the member the page is theirs and hidden, with the reasons and a way back to You", async () => {
    signedIn = { id: "u-hallie" };
    myHandle = "hallie-h";
    show("/u/Hallie-H");
    expect(await screen.findByText("Your page is hidden right now")).toBeTruthy();
    expect(screen.getByText(/email is verified/i)).toBeTruthy();
    expect(screen.getByText(/test account/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to You" }).getAttribute("href")).toBe("/profile");
    expect(screen.queryByText("This profile isn't available")).toBeNull();
    expect(screen.queryByText(/no longer on Helpr/)).toBeNull();
  });

  it("a stranger on the same hidden handle still gets the generic card", async () => {
    signedIn = { id: "u-someone" };
    myHandle = "someone-else";
    show("/u/hallie-h");
    expect(await screen.findByText("This profile isn't available")).toBeTruthy();
    expect(screen.queryByText("Your page is hidden right now")).toBeNull();
  });

  it("a guest gets the generic card", async () => {
    show("/u/hallie-h");
    expect(await screen.findByText("This profile isn't available")).toBeTruthy();
    expect(screen.queryByText("Your page is hidden right now")).toBeNull();
  });
});
