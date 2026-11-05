/**
 * Share-profile audit 11-05, findings M4, L2 and L5 on /u/<handle> (~/.lh-shots/audit-1105-share-profile.md).
 *  - M4: the listing grid asks shop-photo for a 320 px SQUARE thumbnail (sq=1), and shop-photo answers it with a
 *    width x width cover crop, without format=origin and with the browser's Accept passed on (so WebP when the
 *    browser takes it), Vary: Accept. Measured on /u/lexi-l's 24 covers 2026-11-05: w=480 JPEG 122 KB each, w=320
 *    JPEG 34 KB, w=320 square WebP 17.7 KB (render endpoint, browser Accept).
 *  - L2: an old (retired) handle answers with the current one; the address bar moves to /u/<current> (replace, query
 *    kept, one read only), and the link card's og:url / canonical name the current handle.
 *  - L5: the function's comment no longer says the answer never carries the user id (photo_url is
 *    avatars/<user id>/avatar.jpg); the newest COMMENT ON FUNCTION says what is true.
 *
 * @mutate src/lib/profileLink/api.ts | &kind=declutter&w=${width}&sq=1` | &kind=declutter&w=${width}`
 * @mutate supabase/functions/shop-photo/index.ts | ? `width=${width}&height=${width}&resize=cover` | ? `width=${width}&resize=contain`
 * @mutate supabase/functions/shop-photo/index.ts | &quality=80${square ? "" : "&format=origin"}` | &quality=80&format=origin`
 * @mutate supabase/functions/shop-photo/index.ts | headers: square && accept ? { Accept: accept } : undefined | headers: undefined
 * @mutate src/pages/u/PublicProfilePage.tsx | if (!handle \|\| !current \|\| current === handle \|\| !q.data) return; | return;
 * @mutate src/pages/u/PublicProfilePage.tsx | queryClient.setQueryData(["public-profile", current], q.data); | void queryClient;
 * @mutate api/share.ts | url: typeof card.handle === "string" && HANDLE_RE.test(card.handle) ? `${SITE_ORIGIN}/u/${card.handle}` : url, | url,
 * @mutate supabase/migrations/20261105172728_public_profile_comment_user_id.sql | 'test data, expired or cancelled jobs. No user_id field, | 'the user id, test data, expired or cancelled jobs. No user_id field,
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "@/test/helpers/trackedFiles";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => undefined }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, ready: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));
vi.mock("@/lib/nativeShare", () => ({ shareNative: vi.fn(async () => "shared") }));

const { default: PublicProfilePage } = await import("@/pages/u/PublicProfilePage");

const PHOTO = "1a29e366-2c4d-48dc-a3d0-232aa3efaf95";
const PAGE = {
  handle: "eli-new",
  name: "Eli B.",
  photo_url: null,
  member_since: "2025-03-01T12:00:00Z",
  stats: { review_count: 0, avg_rating: null },
  listings: [{ id: "i1", title: "Oak dresser", price_cents: 12000, area_label: "Mid City", photo_id: PHOTO, live_at: "2026-10-30T00:00:00Z" }],
  jobs: [],
  helpr: { jobs_done: 0, categories: [], reviews: [] },
  wanted: [],
};

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

// staleTime as the app sets it (src/lib/queryClient.ts), so the seeded current-handle entry is not re-read.
const show = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/u/:handle" element={<><PublicProfilePage /><Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => rpc.mockReset());

describe("M4: square, right-sized listing thumbnails", () => {
  it("the grid asks shop-photo for a 320 square by photo id", async () => {
    rpc.mockResolvedValue({ data: PAGE, error: null });
    const { container } = show("/u/eli-new");
    expect(await screen.findByText("Oak dresser")).toBeTruthy();
    const imgs = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? "");
    const covers = imgs.filter((s) => s.includes("/functions/v1/shop-photo?"));
    expect(covers.length).toBeGreaterThan(0);
    expect(covers[0]).toMatch(new RegExp(`\\?id=${PHOTO}&kind=declutter&w=320&sq=1$`));
  });

  it("shop-photo crops sq=1 to width x width, drops format=origin and passes Accept on, never for a link card", () => {
    const src = blankComments(readFileSync(resolve("supabase/functions/shop-photo/index.ts"), "utf8"));
    expect(src).toContain('const square = !og && url.searchParams.get("sq") === "1";');
    expect(src).toContain("? `width=${width}&height=${width}&resize=cover`");
    expect(src).toContain('&quality=80${square ? "" : "&format=origin"}');
    expect(src).toContain("headers: square && accept ? { Accept: accept } : undefined");
    expect(src).toContain('...(square ? { Vary: "Accept" } : {})');
    // The link card keeps its exact JPEG size: og is checked first.
    expect(src.indexOf("? `width=${width}&height=${OG_HEIGHT}&resize=cover`")).toBeLessThan(src.indexOf("? `width=${width}&height=${width}&resize=cover`"));
  });
});

describe("L2: an old handle moves the address bar to the current one", () => {
  it("replaces /u/<old> with /u/<current>, keeps the query, reads once", async () => {
    rpc.mockResolvedValue({ data: PAGE, error: null });
    show("/u/eli-old?ref=abc");
    expect(await screen.findByText("Oak dresser")).toBeTruthy();
    await vi.waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/u/eli-new?ref=abc"));
    // The profile itself is read once (the job-photos strip makes its own public_profile_work_photos read).
    const profileReads = rpc.mock.calls.filter((c) => c[0] === "public_profile_by_handle");
    expect(profileReads).toEqual([["public_profile_by_handle", { p_handle: "eli-old" }]]);
  });

  it("the current handle stays where it is", async () => {
    rpc.mockResolvedValue({ data: PAGE, error: null });
    show("/u/eli-new");
    expect(await screen.findByText("Oak dresser")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("/u/eli-new");
  });
});

describe("L2: the link card names the current handle", () => {
  let handler: { fetch: (req: Request) => Promise<Response> };
  beforeAll(async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).endsWith("/rest/v1/rpc/public_profile_by_handle")) {
        return new Response(JSON.stringify(PAGE), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error("unexpected fetch");
    });
    ensureOgShellSnapshot(resolve("."));
    const sharePath = ["..", "..", "api", "share"].join("/");
    handler = (await import(/* @vite-ignore */ sharePath)).default;
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("an old handle's card has og:url and canonical at /u/<current>", async () => {
    const html = await (await handler.fetch(new Request("https://www.louisianahelpr.com/api/share?_og=profile&_id=eli-old"))).text();
    expect(html).toContain('<meta property="og:url" content="https://www.louisianahelpr.com/u/eli-new"');
    expect(html).toContain('<link rel="canonical" href="https://www.louisianahelpr.com/u/eli-new"');
    expect(html).not.toContain("/u/eli-old");
  });
});

describe("L5: the function's comment says what is true about the user id", () => {
  it("the newest COMMENT ON public_profile_by_handle never claims 'never ... the user id'", () => {
    const dir = resolve("supabase/migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const commenting = files.filter((f) =>
      /COMMENT\s+ON\s+FUNCTION\s+public\.public_profile_by_handle\s*\(\s*text\s*\)/i.test(blankSqlComments(readFileSync(resolve(dir, f), "utf8"))),
    );
    expect(commenting.length).toBeGreaterThan(1);
    const newest = blankSqlComments(readFileSync(resolve(dir, commenting[commenting.length - 1]), "utf8"));
    const body = newest.slice(newest.search(/COMMENT\s+ON\s+FUNCTION\s+public\.public_profile_by_handle/i));
    const text = body.slice(0, body.indexOf(";")).replace(/'\s+'/g, "");
    expect(text).not.toMatch(/the user id, test data/);
    expect(text).toContain("photo_url");
    expect(text).toContain("whose folder is the user id");
  });
});
