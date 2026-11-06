/**
 * Q1695 (loading-states-refresh 42123572431, customer /user/<id>: a BLANK 487px loading frame, then the 812px
 * profile). While /user/<id> decides where a member goes (MemberForward's block check, PublicProfileForward's
 * handle_for_user read), the route drew the plain RouteSuspenseFallback. A member now sees /user's own loading frame
 * (UserProfileForwardWait: the page wrapper, the "Profile" header with its Save + overflow bones, UserProfileLoadingBody),
 * so the page does not go blank -> profile. A guest keeps the plain fallback (they go to /u or the login wall).
 *
 * Parity with UserProfile's own loading branch is read from source: the same wrapper class, the same two header bones,
 * the same titles and the same body component, so the two frames cannot drift.
 *
 * @mutate src/components/profile/PublicProfileForward.tsx |     if (blocked.isPending) return wait; |     if (blocked.isPending) return <RouteSuspenseFallback />;
 * @mutate src/components/profile/PublicProfileForward.tsx |  notDeployed={members} wait={wait} /> |  notDeployed={members} />
 * @mutate src/pages/user/UserProfileLoadingBody.tsx |       <UserProfileLoadingBody proReturn={null} /> |
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";

const rpc = vi.fn();
let signedIn: { id: string } | null = null;
let blockAnswer: Promise<{ data: unknown; error: null }> = new Promise(() => {});
const blockChain = { select: () => blockChain, eq: () => blockChain, limit: () => blockAnswer };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => blockChain } }));
vi.mock("@/components/ProtectedRoute", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/RouteSuspenseFallback", () => ({ RouteSuspenseFallback: () => <p data-testid="blank-fallback">loading</p> }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: signedIn, isReady: true }) }));

const ID = "3f2a1b0c-1111-4222-8333-444455556666";
const ME = "9a8b7c6d-1111-4222-8333-444455556666";
const read = (p: string) => blankComments(readFileSync(resolve(p), "utf8"));

async function show(path: string) {
  const { UserProfileRoute } = await import("@/components/profile/PublicProfileForward");
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/user/:userId" element={<UserProfileRoute><p>the member profile</p></UserProfileRoute>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockReturnValue(new Promise(() => {})); // handle_for_user still pending
  blockAnswer = new Promise(() => {});
  signedIn = { id: ME };
});

describe("/user/<id> while it decides where a member goes", () => {
  it("the block check pending: /user's own loading frame, never the blank fallback", async () => {
    await show(`/user/${ID}`);
    const wait = await screen.findByTestId("user-profile-forward-wait");
    expect(wait.textContent).toContain("Profile");
    expect(wait.querySelectorAll(".h-10.w-10.rounded-ds-md").length).toBe(2);
    expect(screen.queryByTestId("blank-fallback")).toBeNull();
  });

  it("the handle read pending (block check answered): the same frame", async () => {
    blockAnswer = Promise.resolve({ data: [], error: null });
    await show(`/user/${ID}`);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith("handle_for_user", { p_user_id: ID }));
    expect(screen.getByTestId("user-profile-forward-wait")).toBeTruthy();
    expect(screen.queryByTestId("blank-fallback")).toBeNull();
  });

  it("my own /user page: its own title, no action bones", async () => {
    await show(`/user/${ME}`);
    const wait = await screen.findByTestId("user-profile-forward-wait");
    expect(wait.textContent).toContain("How others see you");
    expect(wait.querySelectorAll(".h-10.w-10.rounded-ds-md").length).toBe(0);
  });

  it("a guest keeps the plain fallback", async () => {
    signedIn = null;
    await show(`/user/${ID}`);
    expect(await screen.findByTestId("blank-fallback")).toBeTruthy();
    expect(screen.queryByTestId("user-profile-forward-wait")).toBeNull();
  });
});

describe("the wait frame is UserProfile's own loading frame (source parity)", () => {
  const page = read("src/pages/user/UserProfile.tsx");
  const frame = read("src/pages/user/UserProfileLoadingBody.tsx");
  const wait = frame.slice(frame.indexOf("export function UserProfileForwardWait"));
  const BONE = '<div className="h-10 w-10 rounded-ds-md bg-muted motion-safe:animate-pulse" />';
  const count = (s: string, x: string) => s.split(x).length - 1;

  it("same wrapper, same two header bones, same titles, same body", () => {
    expect(wait.length).toBeGreaterThan(200);
    expect(page).toMatch(/<div className="min-h-screen bg-premium-page pb-safe-nav">\{inner\}<\/div>/);
    expect(wait).toContain('className="min-h-screen bg-premium-page pb-safe-nav"');
    expect(count(page, BONE)).toBe(2);
    expect(count(wait, BONE)).toBe(2);
    expect(page).toContain('const OWN_PROFILE_TITLE = "How others see you";');
    expect(page).toContain('isOwnProfile ? OWN_PROFILE_TITLE : "Profile"');
    expect(wait).toContain('own ? "How others see you" : "Profile"');
    expect(page).toMatch(/<UserProfileLoadingBody proReturn=\{proReturn\} \/>/);
    expect(wait).toContain("<UserProfileLoadingBody proReturn={null} />");
  });
});
