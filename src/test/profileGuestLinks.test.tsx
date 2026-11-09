/**
 * Share-profile audit 11-05 (~/.lh-shots/audit-1105-share-profile.md), Builder 2:
 *  L3 a guest's Hire me went to sign-up only; a guest with an account had to find Log in. Now a "Log in" link sits under
 *     it and comes back the same way (/u/<handle>?hire=1, which continues the tap).
 *  L8 Wanted's "Have one? Sign up to reply" went to /declutter, not back to the post. Now each post has its own
 *     "I have this": the Wanted quick-list that answers THAT post (quickListHref), through sign-up for a guest;
 *     never on your own page.
 *
 * @mutate src/lib/hireMe.ts |   return `/login?redirect=${encodeURIComponent(`/u/${encodeURIComponent(handle)}?${HIRE_PARAM}=1`)}`; |   return "/login";
 * @mutate src/pages/u/PublicProfilePage.tsx | <Link to={guestAware(quickListHref(w), signedIn)} data-testid="pp-wanted-reply"> | <Link to={guestAware("/declutter", signedIn)} data-testid="pp-wanted-reply">
 * @mutate src/pages/u/PublicProfilePage.tsx |                 {!isMe && (\n                  <Button asChild variant="outline" size="sm" className="shrink-0 rounded-full"> |                 {(\n                  <Button asChild variant="outline" size="sm" className="shrink-0 rounded-full">
 * @mutate src/pages/u/PublicProfilePage.tsx |       {!signedIn && (\n        <p className="mt-1 text-ds-13 text-muted-foreground" data-testid="pp-hire-join"> |       {false && (\n        <p className="mt-1 text-ds-13 text-muted-foreground" data-testid="pp-hire-join">
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
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => undefined }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: signedIn, ready: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: myHandle ? { handle: myHandle } : null }) }));
vi.mock("@/lib/nativeShare", () => ({ shareNative: vi.fn(async () => "shared") }));

const { default: PublicProfilePage } = await import("@/pages/u/PublicProfilePage");
const { readWantedAnswer } = await import("@/lib/declutter/wanted");

const POST = { id: "7a1b2c3d-1111-4222-8333-444455556666", what: "Kids bike", category: "kids", max_price_cents: 4000, created_at: "2026-11-01T12:00:00Z" };
const PAGE = {
  handle: "eli-b", name: "Eli B.", photo_url: null, member_since: "2025-03-01T12:00:00Z",
  stats: { review_count: 0, avg_rating: null }, listings: [], jobs: [],
  helpr: { jobs_done: 0, categories: [], reviews: [] }, wanted: [POST, { ...POST, id: "8a1b2c3d-1111-4222-8333-444455556666", what: "Lawn mower" }],
};

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/u/eli-b"]}>
        <Routes><Route path="/u/:handle" element={<PublicProfilePage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
const redirectOf = (href: string) => decodeURIComponent(new URL(href, "https://x.test").searchParams.get("redirect") ?? "");

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async () => ({ data: PAGE, error: null }));
  signedIn = null;
  myHandle = null;
});

describe("the share profile brings a guest back where they were going (audit L3, L8)", () => {
  it("L3: a guest's Hire me has a Log in link that comes back to continue the hire", async () => {
    show();
    const login = (await screen.findByTestId("pp-hire-login")).querySelector("a")!;
    expect(login.textContent).toBe("Log in");
    const href = login.getAttribute("href")!;
    expect(href.startsWith("/login?redirect=")).toBe(true);
    expect(redirectOf(href)).toBe("/u/eli-b?hire=1");
  });

  // F068 (owner UI audit 11-09): a new guest also gets "New here? Join free", to sign-up and back to the hire.
  // @mutate src/pages/u/PublicProfilePage.tsx |           New here? <Link to={hireGuestHref(handle)} | <Link to={hireGuestLoginHref(handle)}
  it("F068: a guest's Hire me also offers Join free, through sign-up back to the hire", async () => {
    show();
    const join = (await screen.findByTestId("pp-hire-join")).querySelector("a")!;
    expect(join.textContent).toBe("Join free");
    expect(join.getAttribute("href")!.startsWith("/signup")).toBe(true);
    expect(join.getAttribute("href")).toContain(encodeURIComponent("/u/eli-b?hire=1"));
  });

  it("L3: a member sees no Log in link", async () => {
    signedIn = { id: "u1" };
    show();
    await screen.findByTestId("pp-hire");
    expect(screen.queryByTestId("pp-hire-login")).toBeNull();
  });

  it("L8: each Wanted post's reply goes, through sign-up, to the quick-list that answers THAT post", async () => {
    show();
    const links = await screen.findAllByTestId("pp-wanted-reply");
    expect(links.length).toBeGreaterThan(1);
    const back = redirectOf(links[0].getAttribute("href")!);
    expect(back.startsWith("/declutter/sell?")).toBe(true);
    const a = readWantedAnswer(new URLSearchParams(back.split("?")[1]));
    expect(a).toEqual({ wantedId: POST.id, maxCents: 4000, what: "Kids bike" });
    expect(redirectOf(links[1].getAttribute("href")!)).toContain(PAGE.wanted[1].id);
  });

  it("L8: a member goes straight to it; never on your own page", async () => {
    signedIn = { id: "u1" };
    const { unmount } = show();
    const [first] = await screen.findAllByTestId("pp-wanted-reply");
    expect(first.getAttribute("href")!.startsWith("/declutter/sell?answer=")).toBe(true);
    unmount();
    myHandle = "eli-b";
    show();
    await screen.findByText("Kids bike");
    expect(screen.queryByTestId("pp-wanted-reply")).toBeNull();
  });
});
