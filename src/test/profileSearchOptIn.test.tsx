/**
 * L7 (share-profile audit 11-05; owner: search engines are opt-in per member, default off). Before: every /u page
 * was noindex with no way to opt in. Now Settings › Your profile link has "Show my profile in search engines"
 * (profiles.show_in_search, default false). Only an exact `true` indexes the page: the page's robots meta, the link
 * card's robots meta and the card's X-Robots-Tag header all say noindex otherwise, and a card that could not be read
 * fails closed (noindex). vercel.json no longer sends a static noindex header for /u/ (it would override the switch).
 *
 * @mutate api/share.ts |     robots: card.show_in_search === true ? PROFILE_ROBOTS_SHOWN : PROFILE_ROBOTS, |     robots: PROFILE_ROBOTS_SHOWN,
 * @mutate api/share.ts |     noindexHeader: card.show_in_search !== true, |     noindexHeader: false,
 * @mutate api/share.ts |       if (!meta) return respond(shell, undefined, 200, resolveRoute(url)?.kind === "profile"); |       if (!meta) return respond(shell);
 * @mutate api/share.ts |       return respond(page, meta.cdnCache, 200, meta.noindexHeader === true); |       return respond(page, meta.cdnCache);
 * @mutate src/pages/u/PublicProfilePage.tsx |     robots: p?.show_in_search === true ? ROBOTS_SHOWN : ROBOTS, |     robots: p?.show_in_search !== false ? ROBOTS_SHOWN : ROBOTS,
 * @mutate src/components/profile/ShowInSearchSwitch.tsx | .update({ show_in_search: next }).eq("user_id", userId).select("id") | .update({ show_in_search: next }).eq("user_id", userId)
 * @mutate src/components/profile/ShowInSearchSwitch.tsx |       setOn(next); |
 * @mutate src/components/profile/ProfileLinkRow.tsx | {userId && <ShowInSearchSwitch userId={userId} initial={showInSearch === true} />} |
 * @mutate src/components/profile/SettingsTab.tsx |  userId={profile.user_id} showInSearch={profile.show_in_search === true} /> |  />
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

const rpc = vi.fn();
const update = vi.fn();
const toastError = vi.fn();
const meta = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ update: (v: unknown) => ({ eq: (_c: string, id: string) => update(v, id) }) }),
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a), success: vi.fn() }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: (m: unknown) => meta(m) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null, isLoading: false }) }));

const PAGE = { handle: "eli-b", name: "Eli B.", photo_url: null, member_since: "2025-03-01T12:00:00Z", stats: {}, listings: [], jobs: [], helpr: { jobs_done: 0, categories: [], reviews: [] }, wanted: [] };

describe("the Settings switch", () => {
  beforeEach(() => {
    update.mockReset();
    toastError.mockReset();
  });
  const select = (rows: unknown[] | null, error: unknown = null) => ({ select: (c: string) => Promise.resolve({ data: c === "id" ? rows : null, error }) });

  it("is off by default and turning it on writes show_in_search = true for the member, with a row check", async () => {
    update.mockReturnValue(select([{ id: "p1" }]));
    const { ShowInSearchSwitch } = await import("@/components/profile/ShowInSearchSwitch");
    render(<ShowInSearchSwitch userId="u1" initial={false} />);
    const sw = screen.getByRole("switch", { name: /Show my profile in search engines/ });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
    expect(update).toHaveBeenCalledWith({ show_in_search: true }, "u1");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("a write that changed no row is a failure: the switch stays off and says so", async () => {
    update.mockReturnValue(select([]));
    const { ShowInSearchSwitch } = await import("@/components/profile/ShowInSearchSwitch");
    render(<ShowInSearchSwitch userId="u1" initial={false} />);
    const sw = screen.getByRole("switch", { name: /Show my profile in search engines/ });
    fireEvent.click(sw);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Couldn't save that. Try again."));
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });

  it("Settings › Your profile link shows it with the member's saved value", () => {
    const row = blankComments(readFileSync(resolve("src/components/profile/ProfileLinkRow.tsx"), "utf8"));
    expect(row).toContain("{userId && <ShowInSearchSwitch userId={userId} initial={showInSearch === true} />}");
    const settings = blankComments(readFileSync(resolve("src/components/profile/SettingsTab.tsx"), "utf8"));
    expect(settings).toContain("userId={profile.user_id} showInSearch={profile.show_in_search === true} />");
  });
});

describe("the /u page's robots meta", () => {
  beforeEach(() => meta.mockReset());
  const show = async () => {
    const { default: PublicProfilePage } = await import("@/pages/u/PublicProfilePage");
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/u/eli-b"]}>
          <Routes><Route path="/u/:handle" element={<PublicProfilePage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText("Eli B.", { selector: "h2" });
    const calls = meta.mock.calls;
    return (calls[calls.length - 1]?.[0] as { robots?: string } | undefined)?.robots;
  };

  for (const [value, want] of [[undefined, "noindex, follow"], [false, "noindex, follow"], [true, "index, follow"]] as const) {
    it(`show_in_search ${String(value)}: ${want}`, async () => {
      rpc.mockResolvedValue({ data: { ...PAGE, show_in_search: value }, error: null });
      expect(await show()).toBe(want);
    });
  }
});

describe("the /u link card (api/share.ts)", () => {
  let handler: { fetch: (req: Request) => Promise<Response> };
  let answer: unknown = PAGE;
  let fail = false;
  beforeAll(async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    vi.stubGlobal("fetch", async (url: string) => {
      if (fail) throw new Error("timeout");
      if (String(url).endsWith("/rest/v1/rpc/public_profile_by_handle")) return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
      throw new Error(`unexpected fetch ${url}`);
    });
    ensureOgShellSnapshot(resolve("."));
    const sharePath = ["..", "..", "api", "share"].join("/");
    handler = (await import(/* @vite-ignore */ sharePath)).default;
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const get = (h = "eli-b") => handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=profile&_id=${h}`));

  it("default (off or missing): noindex in the meta and the header", async () => {
    fail = false;
    for (const v of [undefined, false, null]) {
      answer = { ...PAGE, show_in_search: v };
      const res = await get();
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(await res.text()).toContain('<meta name="robots" content="noindex, follow"');
    }
  });

  it("opted in: index, follow and no noindex header", async () => {
    fail = false;
    answer = { ...PAGE, show_in_search: true };
    const res = await get();
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
    expect(await res.text()).toContain('<meta name="robots" content="index, follow"');
  });

  it("an unavailable profile, or a card that could not be read, fails closed to noindex", async () => {
    fail = false;
    answer = null;
    expect((await get()).headers.get("X-Robots-Tag")).toBe("noindex");
    fail = true;
    expect((await get()).headers.get("X-Robots-Tag")).toBe("noindex");
    fail = false;
  });

  it("vercel.json sends no static noindex header for /u/ (it would override the member's choice)", () => {
    const v = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as { headers: { source: string }[] };
    expect(v.headers.length).toBeGreaterThan(5);
    expect(v.headers.some((h) => h.source === "/u/(.*)")).toBe(false);
  });
});
