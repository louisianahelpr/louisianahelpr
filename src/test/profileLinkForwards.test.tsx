/**
 * H5 (share-profile audit 11-05, owner: one public profile link). Before: three links to one person. /user/<id> was
 * members-only (a guest hit the login wall and its card said "Profiles on Helpr are visible to members"), /book/<id>
 * was a separate thin card, /u/<handle> the real public page. Now:
 *   - /book/<id> forwards everyone to /u/<handle>; no public page = "This Helpr isn't available";
 *   - /user/<id> forwards a signed-out visitor to /u/<handle>; no public page = the login wall as before; a member
 *     keeps /user/<id> (Message, Invite, Block and Report live only there);
 *   - api/share.ts gives both old links the /u card (og:url the /u link), and keeps the old cards while
 *     handle_for_user is not deployed;
 *   - the profile menu's "Book me on Helpr" row opens /u/<handle>.
 * handle_for_user's SQL (NULL under exactly public_profile_by_handle's rules) is proved by
 * src/test/pglite/publicProfileByHandle.pglite.mjs P23/P24 (LH_HANDLE_FOR_USER=20261105171316_handle_for_user.sql).
 *
 * @mutate src/components/profile/PublicProfileForward.tsx | if (q.data.state === "found") return <Navigate | if (q.data.state === "nope") return <Navigate
 * @mutate src/components/profile/PublicProfileForward.tsx |   if (!isReady \|\| user) return members; |   if (!isReady) return members;
 * @mutate src/components/profile/PublicProfileForward.tsx |  notDeployed={children} onForward={rememberBookingSource} /> |  notDeployed={children} />
 * @mutate src/App.tsx | routeEl(<BookHelprRoute><BookHelprPage /></BookHelprRoute>) | routeEl(<BookHelprPage />)
 * @mutate src/App.tsx | routeEl(<UserProfileRoute><UserProfile /></UserProfileRoute>) | routeEl(<ProtectedRoute><UserProfile /></ProtectedRoute>)
 * @mutate api/share.ts |   if (u === "absent") return unavailableBookMeta(url); |
 * @mutate api/share.ts |     if (u !== "absent" && u !== "unknown") return u; |
 * @mutate src/lib/profileLink/api.ts |     if (isMissingRpcNamed(error, "handle_for_user")) return { state: "not_deployed" }; |
 * @mutate src/components/profile/profileLanding/useProfileLandingDerived.tsx | href: profile.handle ? `/u/${encodeURIComponent(profile.handle)}` : `/book/${profile.user_id}` | href: `/book/${profile.user_id}`
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

const rpc = vi.fn();
let signedIn: { id: string } | null = null;
const remembered = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/ProtectedRoute", () => ({ default: ({ children }: { children: ReactNode }) => <div data-testid="members-only">{children}</div> }));
vi.mock("@/components/RouteSuspenseFallback", () => ({ RouteSuspenseFallback: () => <p>loading</p> }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: signedIn, isReady: true }) }));
vi.mock("@/lib/bookMe", () => ({ rememberBookingSource: (id: string) => remembered(id) }));

const ID = "3f2a1b0c-1111-4222-8333-444455556666";
const read = (p: string) => blankComments(readFileSync(resolve(p), "utf8"));

async function show(path: string) {
  const { UserProfileRoute, BookHelprRoute } = await import("@/components/profile/PublicProfileForward");
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/user/:userId" element={<UserProfileRoute><p>the member profile</p></UserProfileRoute>} />
          <Route path="/book/:userId" element={<BookHelprRoute><p>the old book page</p></BookHelprRoute>} />
          <Route path="/u/:handle" element={<p>public page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("old profile links forward to /u/<handle>", () => {
  beforeEach(() => {
    rpc.mockReset();
    remembered.mockReset();
    signedIn = null;
  });

  it("a guest on /user/<id> lands on the public page, through handle_for_user", async () => {
    rpc.mockResolvedValue({ data: "eli-b", error: null });
    await show(`/user/${ID}`);
    expect(await screen.findByText("public page")).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("handle_for_user", { p_user_id: ID });
  });

  it("a guest on /user/<id> with no public page gets the members-only wall, as before", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await show(`/user/${ID}`);
    expect(await screen.findByTestId("members-only")).toBeTruthy();
  });

  it("a member on /user/<id> keeps the member profile and makes no lookup", async () => {
    signedIn = { id: "me" };
    rpc.mockResolvedValue({ data: "eli-b", error: null });
    await show(`/user/${ID}`);
    expect(await screen.findByText("the member profile")).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("/book/<id> forwards everyone, signed in too, and remembers which Helpr's link brought them", async () => {
    signedIn = { id: "me" };
    rpc.mockResolvedValue({ data: "eli-b", error: null });
    await show(`/book/${ID}`);
    expect(await screen.findByText("public page")).toBeTruthy();
    expect(remembered).toHaveBeenCalledWith(ID);
  });

  it("/book/<id> with no public page says the Helpr isn't available", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await show(`/book/${ID}`);
    expect(await screen.findByText("This Helpr isn't available")).toBeTruthy();
    expect(remembered).not.toHaveBeenCalled();
  });

  it("until handle_for_user is deployed (PGRST202) /book keeps its old page", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.handle_for_user(p_user_id) in the schema cache" } });
    await show(`/book/${ID}`);
    expect(await screen.findByText("the old book page")).toBeTruthy();
  });

  it("App.tsx mounts both old routes through the forwards; the menu row opens /u/<handle>", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('<Route path="/user/:userId" element={<RouteErrorBoundary>{routeEl(<UserProfileRoute><UserProfile /></UserProfileRoute>)}</RouteErrorBoundary>} />');
    expect(app).toContain('<Route path="/book/:userId" element={<RouteErrorBoundary>{routeEl(<BookHelprRoute><BookHelprPage /></BookHelprRoute>)}</RouteErrorBoundary>} />');
    const menu = read("src/components/profile/profileLanding/useProfileLandingDerived.tsx");
    expect(menu).toContain('key: "book-me"');
    expect(menu).toContain("href: profile.handle ? `/u/${encodeURIComponent(profile.handle)}` : `/book/${profile.user_id}`");
  });

  it("handle_for_user is client-callable by name for anon and members (definer allowlist)", () => {
    const allow = JSON.parse(readFileSync(resolve("scripts/ci/definer-exec-allowlist.json"), "utf8")) as Record<string, Record<string, string>>;
    expect(allow.anon["handle_for_user(uuid)"]).toBe("client");
    expect(allow.authenticated["handle_for_user(uuid)"]).toBe("client");
    expect(Object.keys(allow.anon).length).toBeGreaterThan(10);
  });
});

describe("the old links' cards are the /u card (api/share.ts)", () => {
  let handler: { fetch: (req: Request) => Promise<Response> };
  let handle: unknown = "eli-b";
  let handleStatus = 200;
  const PAGE = { handle: "eli-b", name: "Eli B.", photo_url: null, member_since: "2025-03-01T12:00:00Z", stats: {}, listings: [], jobs: [], helpr: { jobs_done: 0, categories: [], reviews: [] }, wanted: [] };
  beforeAll(async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
      if (u.endsWith("/rpc/handle_for_user")) return json(handle, handleStatus);
      if (u.endsWith("/rpc/public_profile_by_handle")) return json(PAGE);
      if (u.endsWith("/rpc/get_safe_profiles")) return json([{ full_name: "Marie T.", location: "Lafayette" }]);
      if (u.endsWith("/rpc/get_public_profile_stats")) return json([]);
      throw new Error(`unexpected fetch ${u}`);
    });
    ensureOgShellSnapshot(resolve("."));
    const sharePath = ["..", "..", "api", "share"].join("/");
    handler = (await import(/* @vite-ignore */ sharePath)).default;
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const card = async (kind: string) => (await handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=${kind}&_id=${ID}`))).text();

  it("/book/<id> and /user/<id> preview as the member's /u page", async () => {
    handle = "eli-b";
    handleStatus = 200;
    for (const kind of ["book", "user"]) {
      const html = await card(kind);
      expect(html).toContain('<meta property="og:title" content="Eli B. on Louisiana Helpr"');
      expect(html).toContain('<meta property="og:url" content="https://www.louisianahelpr.com/u/eli-b"');
      expect(html).not.toContain("visible to members");
    }
  });

  it("no public page: /book is 'isn't available', /user keeps the members-only card", async () => {
    handle = null;
    handleStatus = 200;
    expect(await card("book")).toContain("This Helpr isn&#39;t available");
    expect(await card("user")).toContain("Profiles on Helpr are visible to members");
  });

  it("handle_for_user not deployed (404): both keep their old cards", async () => {
    handle = { code: "PGRST202" };
    handleStatus = 404;
    expect(await card("book")).toContain('<meta property="og:title" content="Book Marie T. on Louisiana Helpr"');
    expect(await card("user")).toContain("Profiles on Helpr are visible to members");
  });
});
