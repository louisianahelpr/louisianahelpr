/**
 * THE "Preview" MARK (lead, 2026-10-21): a live section the viewer can open
 * only because they are a tester (admin or test account) says "Preview"
 * wherever it is listed, so the owner can see what members cannot.
 *
 * No new server function: preview = the section's switch is on for the viewer
 * (useFeature) AND features_open_to_everyone() (migration 20261019051933,
 * live on prod: STABLE, EXECUTE for authenticated, measured 2026-10-21) has
 * ANSWERED AND does not list it. While that read is loading, after it fails
 * (a failed refetch too), and while it is not deployed (PGRST202), nothing is
 * a preview: an unknown answer must never put a false mark on a member's
 * section that is open to everyone.
 *
 * (a) the pure decision, every case; (b) the real useSectionTabs over a mocked
 * supabase.rpc: tester, member, loading, failed, failed refetch, not deployed,
 * signed out (never asks); (c) every listing marks a tester-only section, gated on its own preview flag.
 * Since 2026-10-23 (owner: the rail says "Coming soon", not "Preview") that mark is "Coming soon", the same
 * as a closed section's, and no surface says "Preview" (src/test/comingSoonNotPreview.test.tsx); a tester's
 * section carries the "early preview" banner inside.
 *
 * @mutate src/components/mobileNav/useSectionTabs.ts |   return on && openToEveryone !== null && !openToEveryone.has(feature); |   return on && !openToEveryone?.has(feature);
 * @mutate src/components/landing/useSectionsOpen.ts |   return q.isSuccess && q.data !== null ? new Set(q.data) : null; |   return q.isError ? new Set() : q.data ? new Set(q.data) : null;
 * @mutate src/components/landing/useSectionsOpen.ts |   return q.isSuccess && q.data !== null ? new Set(q.data) : null; |   return q.isSuccess ? new Set(q.data ?? []) : null;
 * @mutate src/components/landing/useSectionsOpen.ts |   return q.isSuccess && q.data !== null ? new Set(q.data) : null; |   return q.data ? new Set(q.data) : null;
 * @mutate src/components/mobileNav/useSectionTabs.ts |   const openToEveryone = useOpenToEveryoneAnswer(declutter \|\| shops \|\| rentals); |   const openToEveryone = useOpenToEveryoneAnswer(true);
 * @mutate src/components/DesktopSidebarNav.tsx | soonMark: t ? sectionComingSoon(t) : false, | soonMark: t ? !t.on : false,
 * @mutate src/components/create/CreateSheet.tsx | {on && isPreview(s) && <SoonPill data-create-preview={s.key} />} | {on && <SoonPill data-create-preview={s.key} />}
 * @mutate src/components/profile/SettingsTab.tsx |           const preview = s.feature !== null && !!tab?.preview; |           const preview = s.feature !== null && !!tab?.on;
 * @mutate src/components/admin/settings/FeatureSwitchesCard.tsx |       await queryClient.invalidateQueries({ queryKey: SECTIONS_OPEN_QUERY_KEY }); |
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";

const rpc = vi.fn();
const auth = { user: { id: "u1" } as { id: string } | null, isReady: true };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => auth }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { sectionIsPreview, useSectionTabs } from "@/components/mobileNav/useSectionTabs";
import { SECTIONS_OPEN_QUERY_KEY } from "@/components/landing/useSectionsOpen";

const ROOT = resolve(__dirname, "..", "..");
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

type Answer = { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>;
/** Answer the two reads useSectionTabs makes: the viewer's switches, and which are open to everyone. */
function serve(switches: Record<string, boolean>, open: () => Answer) {
  rpc.mockImplementation((fn: string) => {
    if (fn === "feature_switches_for_me") return Promise.resolve({ data: switches, error: null });
    if (fn === "features_open_to_everyone") return Promise.resolve(open());
    return Promise.resolve({ data: null, error: null });
  });
}
const previews = (tabs: ReturnType<typeof useSectionTabs>) => Object.fromEntries(tabs.map((t) => [t.feature, t.preview]));
const ons = (tabs: ReturnType<typeof useSectionTabs>) => Object.fromEntries(tabs.map((t) => [t.feature, t.on]));
const askedOpen = () => rpc.mock.calls.filter(([fn]) => fn === "features_open_to_everyone").length;
const tick = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  rpc.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  auth.user = { id: "u1" };
  auth.isReady = true;
});

describe("(a) the decision", () => {
  it("a preview only when live for the viewer AND the answer is in AND it is not open to everyone", () => {
    expect(sectionIsPreview(true, "declutter", new Set())).toBe(true);
    expect(sectionIsPreview(true, "declutter", new Set(["shops"]))).toBe(true);
    expect(sectionIsPreview(true, "declutter", new Set(["declutter"])), "open to everyone").toBe(false);
    expect(sectionIsPreview(true, "declutter", null), "answer loading or failed").toBe(false);
    expect(sectionIsPreview(false, "declutter", new Set()), "not live for the viewer").toBe(false);
    expect(sectionIsPreview(false, "declutter", null)).toBe(false);
  });
});

describe("(b) useSectionTabs `preview`", () => {
  it("tester: a section open to testers only is a preview; one open to everyone is not; one off is not", async () => {
    serve({ declutter: true, shops: true, rentals: false }, () => ({ data: ["shops"], error: null }));
    const { result } = renderHook(() => useSectionTabs(), { wrapper });
    await waitFor(() => expect(previews(result.current).declutter).toBe(true));
    expect(previews(result.current)).toEqual({ declutter: true, shops: false, rentals: false });
    expect(ons(result.current)).toEqual({ declutter: true, shops: true, rentals: false });
  });

  it("member: a live section is open to everyone, so never a preview", async () => {
    serve({ declutter: false, shops: true, rentals: false }, () => ({ data: ["shops"], error: null }));
    const { result } = renderHook(() => useSectionTabs(), { wrapper });
    await waitFor(() => expect(ons(result.current).shops).toBe(true));
    await waitFor(() => expect(askedOpen()).toBe(1));
    await tick();
    expect(previews(result.current)).toEqual({ declutter: false, shops: false, rentals: false });
  });

  it("loading: no mark until features_open_to_everyone answers", async () => {
    let answer!: (v: { data: unknown; error: unknown }) => void;
    const pending = new Promise<{ data: unknown; error: unknown }>((r) => { answer = r; });
    serve({ declutter: true, shops: true, rentals: true }, () => pending);
    const { result } = renderHook(() => useSectionTabs(), { wrapper });
    await waitFor(() => expect(ons(result.current).declutter).toBe(true));
    await waitFor(() => expect(askedOpen()).toBe(1));
    expect(previews(result.current)).toEqual({ declutter: false, shops: false, rentals: false });
    answer({ data: ["rentals"], error: null });
    await waitFor(() => expect(previews(result.current)).toEqual({ declutter: true, shops: true, rentals: false }));
  });

  it("failed: no mark (a failure never reads as 'open to nobody')", async () => {
    serve({ declutter: true, shops: true, rentals: true }, () => ({ data: null, error: { message: "boom", code: "500" } }));
    const { result } = renderHook(() => useSectionTabs(), { wrapper });
    await waitFor(() => expect(askedOpen()).toBe(1));
    await waitFor(() => expect(client.getQueryState(SECTIONS_OPEN_QUERY_KEY)?.status).toBe("error"));
    expect(ons(result.current)).toEqual({ declutter: true, shops: true, rentals: true });
    expect(previews(result.current)).toEqual({ declutter: false, shops: false, rentals: false });
  });

  it("a failed REFETCH drops the marks it had", async () => {
    let fail = false;
    serve({ declutter: true, shops: false, rentals: false }, () => (fail ? { data: null, error: { message: "boom", code: "500" } } : { data: [], error: null }));
    const { result } = renderHook(() => useSectionTabs(), { wrapper });
    await waitFor(() => expect(previews(result.current).declutter).toBe(true));
    fail = true;
    await client.refetchQueries({ queryKey: SECTIONS_OPEN_QUERY_KEY });
    await waitFor(() => expect(client.getQueryState(SECTIONS_OPEN_QUERY_KEY)?.status).toBe("error"));
    await waitFor(() => expect(previews(result.current).declutter).toBe(false));
  });

  it("not deployed (PGRST202 naming no other function): no mark", async () => {
    serve({ declutter: true, shops: true, rentals: true }, () => ({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.features_open_to_everyone without parameters in the schema cache", hint: null },
    }));
    const { result } = renderHook(() => useSectionTabs(), { wrapper });
    await waitFor(() => expect(client.getQueryState(SECTIONS_OPEN_QUERY_KEY)?.status).toBe("success"));
    expect(client.getQueryData(SECTIONS_OPEN_QUERY_KEY)).toBeNull();
    expect(previews(result.current)).toEqual({ declutter: false, shops: false, rentals: false });
  });

  it("signed out, or nothing live: never asks features_open_to_everyone", async () => {
    serve({ declutter: false, shops: false, rentals: false }, () => ({ data: [], error: null }));
    const a = renderHook(() => useSectionTabs(), { wrapper });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("feature_switches_for_me", expect.anything()));
    await tick();
    auth.user = null;
    const b = renderHook(() => useSectionTabs(), { wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider> });
    await tick();
    expect(askedOpen()).toBe(0);
    expect(previews(a.result.current)).toEqual({ declutter: false, shops: false, rentals: false });
    expect(previews(b.result.current)).toEqual({ declutter: false, shops: false, rentals: false });
  });
});

describe("(c) every listing marks a tester-only section, gated on its own preview flag (\"Coming soon\", owner 2026-10-23)", () => {
  const read = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));
  const SITES: Array<[string, RegExp]> = [
    ["src/components/DesktopSidebarNav.tsx", /soonMark: t \? sectionComingSoon\(t\) : false/],
    ["src/components/profile/SettingsTab.tsx", /badge=\{preview \? <SoonPill\b/],
    ["src/components/create/CreateSheet.tsx", /\{on && isPreview\(s\) && <SoonPill\b/],
    ["src/components/sections/ExploreSwitcher.tsx", /const soon = sectionComingSoon\(\{ on, preview: isPreview\(s\) \}\);/],
  ];
  it("inventory: four listings", () => expect(SITES.length).toBeGreaterThan(3));
  it.each(SITES)("%s", (f, re) => expect(read(f)).toMatch(re));

  it("each site's flag comes from useSectionTabs' `preview`", () => {
    expect(read("src/components/profile/SettingsTab.tsx")).toMatch(/const preview = s\.feature !== null && !!tab\?\.preview;/);
    expect(read("src/components/sections/ExploreSwitcher.tsx")).toMatch(/s\.feature !== null && !!live\.find\(\(t\) => t\.path === s\.path\)\?\.preview/);
  });

  it("an admin's switch change re-asks which sections are open to everyone", () => {
    expect(read("src/components/admin/settings/FeatureSwitchesCard.tsx")).toMatch(/invalidateQueries\(\{ queryKey: SECTIONS_OPEN_QUERY_KEY \}\)/);
  });
});
