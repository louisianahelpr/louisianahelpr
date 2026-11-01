/**
 * /u/:handle, the shareable profile (LEAD-PROFILE-LINK, owner 2026-10-31: "Guests see the full profile;
 * buying/applying/messaging asks them to sign up and brings them back").
 *  - a guest sees the name, member since, listings, open jobs, Helpr work and Wanted posts from the ONE read;
 *  - a guest's Apply goes to signup and back to the job; a member's goes straight to the job;
 *  - a handle that can never be one makes no request and says the profile isn't available;
 *  - the owner of the page gets "Share my profile".
 * The link card: api/share.ts serves /u/<handle> with the member's name, their photo at 1200x630 and exactly
 * ONE og:image; an unknown handle is a noindex "isn't available" card.
 *
 * @mutate src/pages/u/PublicProfilePage.tsx | return signedIn ? path : signupUrlFor(path); | return path;
 * @mutate src/pages/u/PublicProfilePage.tsx | enabled: !!handle, | enabled: true,
 * @mutate src/pages/u/PublicProfilePage.tsx | isMe={!!me?.handle && me.handle === q.data.handle} | isMe={false}
 * @mutate api/share.ts | (tag) => (seen++ === 0 ? tag : "")); | (tag) => tag);
 * @mutate api/share.ts | ?width=1200&height=630&resize=cover&quality=80&format=origin | ?width=630&height=630&resize=cover&quality=80&format=origin
 * @mutate vercel.json | "destination": "/api/share?_og=profile&_id=:handle" | "destination": "/index.html"
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

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

const PAGE = {
  handle: "eli-b",
  name: "Eli B.",
  photo_url: null,
  member_since: "2025-03-01T12:00:00Z",
  stats: { review_count: 2, avg_rating: 4.5, is_id_verified: true },
  listings: [{ id: "i1", title: "Oak dresser", price_cents: 12000, area_label: "Mid City", photo_id: null, live_at: "2026-10-30T00:00:00Z" }],
  jobs: [{ id: "j1", title: "Mow my yard", category: "lawn_care", town: "Baton Rouge, LA", budget: 80, date_needed: "2032-11-03" }],
  helpr: { jobs_done: 2, categories: ["moving"], reviews: [{ rating: 5, feedback: "Great work", created_at: "2026-10-01T00:00:00Z", reviewer_name: "Rita T.", job_category: "moving", response_text: null, response_at: null }] },
  wanted: [{ id: "w1", what: "crib", category: "baby", max_price_cents: 8000, created_at: "2026-10-30T00:00:00Z" }],
};

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
  signedIn = null;
  myHandle = null;
});

describe("the /u/:handle page", () => {
  it("a guest sees everything the read returned, and Apply goes through signup back to the job", async () => {
    rpc.mockResolvedValue({ data: PAGE, error: null });
    show("/u/Eli-B");
    expect(await screen.findByRole("heading", { name: "Eli B." })).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("public_profile_by_handle", { p_handle: "eli-b" });
    expect(screen.getByText("Member since March 2025")).toBeTruthy();
    expect(screen.getByText("Oak dresser")).toBeTruthy();
    expect(screen.getByText("Mow my yard")).toBeTruthy();
    expect(screen.getByText("Great work")).toBeTruthy();
    expect(screen.getByText("crib")).toBeTruthy();
    const apply = screen.getByRole("link", { name: "Apply" });
    expect(apply.getAttribute("href")).toBe(`/signup?redirect=${encodeURIComponent("/jobs?job=j1")}`);
    expect(screen.getByRole("link", { name: /sign up to reply/i }).getAttribute("href")).toMatch(/^\/signup\?redirect=/);
  });

  it("a member's button goes straight to the job", async () => {
    signedIn = { id: "m1" };
    rpc.mockResolvedValue({ data: PAGE, error: null });
    show("/u/eli-b");
    const view = await screen.findByRole("link", { name: "View" });
    expect(view.getAttribute("href")).toBe("/jobs?job=j1");
  });

  it("the page's owner gets Share my profile", async () => {
    signedIn = { id: "m1" };
    myHandle = "eli-b";
    rpc.mockResolvedValue({ data: PAGE, error: null });
    show("/u/eli-b");
    expect(await screen.findByRole("button", { name: /share my profile/i })).toBeTruthy();
  });

  it("a handle that can never be one makes no request", async () => {
    show("/u/no");
    expect(await screen.findByText("This profile isn't available")).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an unknown handle says the profile isn't available", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    show("/u/nobody-here");
    expect(await screen.findByText("This profile isn't available")).toBeTruthy();
  });
});

describe("the /u/<handle> link card (api/share.ts + vercel.json)", () => {
  let handler: { fetch: (req: Request) => Promise<Response> };
  let answer: unknown = null;
  let calls = 0;
  const USER = "3f2a1b0c-1111-4222-8333-444455556666";
  beforeAll(async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).endsWith("/rest/v1/rpc/public_profile_by_handle")) {
        calls++;
        return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
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
  const card = async (h: string) => (await handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=profile&_id=${h}`))).text();

  it("vercel.json sends /u/<handle> through the card, noindex", () => {
    const v = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as { rewrites: { source: string; destination: string }[]; headers: { source: string }[] };
    expect(v.rewrites.length).toBeGreaterThan(5);
    expect(v.rewrites.find((r) => r.source.startsWith("/u/"))?.destination).toBe("/api/share?_og=profile&_id=:handle");
    expect(v.headers.some((h) => h.source === "/u/(.*)")).toBe(true);
  });

  it("a member's card: their name, their photo at 1200x630, exactly one og:image", async () => {
    answer = { ...PAGE, photo_url: `https://example.supabase.co/storage/v1/object/public/avatars/${USER}/avatar.jpg` };
    const html = await card("Eli-B");
    expect(html).toContain('<meta property="og:title" content="Eli B. on Louisiana Helpr"');
    expect(html).toContain('<meta property="og:url" content="https://www.louisianahelpr.com/u/eli-b"');
    expect(html).toContain('<meta name="robots" content="noindex, follow"');
    expect(html).toContain(`<meta property="og:image" content="https://example.supabase.co/storage/v1/render/image/public/avatars/${USER}/avatar.jpg?width=1200&amp;height=630&amp;resize=cover&amp;quality=80&amp;format=origin"`);
    expect(html).toContain('<meta property="og:image:width" content="1200"');
    expect(html).toContain('<meta property="og:image:height" content="630"');
    expect(html.match(/<meta property="og:image" /g)?.length).toBe(1);
  });

  it("a photo from anywhere else is not used; still one og:image", async () => {
    answer = { ...PAGE, photo_url: "https://lh3.googleusercontent.com/a/photo.jpg" };
    const html = await card("eli-b");
    expect(html).not.toContain("googleusercontent");
    expect(html.match(/<meta property="og:image" /g)?.length).toBe(1);
  });

  it("an unknown handle is a noindex 'isn't available' card; a bad handle is not even looked up", async () => {
    answer = null;
    expect(await card("nobody-here")).toContain("This profile isn&#39;t available");
    const before = calls;
    expect(await card("x")).toContain("This profile isn&#39;t available");
    expect(calls).toBe(before);
  });
});
