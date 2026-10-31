/**
 * THE "Preview" MARK (lead, 2026-10-21): a live section the viewer can open
 * only because they are a tester (admin or test account) carries an olive
 * mark wherever it is listed, so the owner can see what members cannot. It
 * says "Coming soon", the phone switcher's words (audit A2-L17, 2026-10-29:
 * the rail said "Preview" while the 375 switcher said "Coming soon").
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
 * signed out (never asks); (c) every listing draws PreviewPill gated on the
 * section's own preview flag. Explore's header is the one exception (owner, 2026-10-22): its chips say
 * "Coming soon" to every viewer, and a tester's empty Browse says "Opens soon" instead (no banner, owner 2026-10-28)
 * (src/test/sectionNavTabs.test.tsx, src/test/exploreHeaderSteady.test.ts).
 *
 * @mutate src/components/mobileNav/useSectionTabs.ts |   return on && openToEveryone !== null && !openToEveryone.has(feature) && !OPEN_FOR_THOSE_WHO_HAVE_IT.has(feature); |   return on && !openToEveryone?.has(feature) && !OPEN_FOR_THOSE_WHO_HAVE_IT.has(feature);
 * Owner 2026-10-30: Declutter reads as open to everyone who has it (no tester mark), Shops and Homes keep theirs.
 * @mutate src/components/mobileNav/useSectionTabs.ts | && !OPEN_FOR_THOSE_WHO_HAVE_IT.has(feature); | ;
 * @mutate src/components/mobileNav/useSectionTabs.ts | const OPEN_FOR_THOSE_WHO_HAVE_IT: ReadonlySet<string> = new Set(["declutter"]); | const OPEN_FOR_THOSE_WHO_HAVE_IT: ReadonlySet<string> = new Set(["declutter", "shops", "rentals"]);
 * @mutate src/components/landing/useSectionsOpen.ts |   return q.isSuccess && q.data !== null ? new Set(q.data) : null; |   return q.isError ? new Set() : q.data ? new Set(q.data) : null;
 * @mutate src/components/landing/useSectionsOpen.ts |   return q.isSuccess && q.data !== null ? new Set(q.data) : null; |   return q.isSuccess ? new Set(q.data ?? []) : null;
 * @mutate src/components/landing/useSectionsOpen.ts |   return q.isSuccess && q.data !== null ? new Set(q.data) : null; |   return q.data ? new Set(q.data) : null;
 * @mutate src/components/mobileNav/useSectionTabs.ts |   const openToEveryone = useOpenToEveryoneAnswer(declutter \|\| shops \|\| rentals \|\| guest); |   const openToEveryone = useOpenToEveryoneAnswer(true);
 * @mutate src/components/DesktopSidebarNav.tsx |                   {preview && <PreviewPill variant="rail" />} |
 * @mutate src/components/sections/PreviewPill.tsx |       {t("soon.full")}\n    </span>\n  );\n}\n | Preview\n    </span>\n  );\n}\n
 * @mutate src/components/sections/PreviewPill.tsx |         {t("soon.full")}\n      </span> |         Coming soon\n      </span>
 * @mutate src/components/create/CreateSheet.tsx |                   {on && isPreview(s) && <PreviewPill data-create-preview={s.key} />} |                   {on && <PreviewPill data-create-preview={s.key} />}
 * @mutate src/components/profile/SettingsTab.tsx |           const preview = s.feature !== null && !!tab?.preview; |           const preview = s.feature !== null && !!tab?.on;
 * @mutate src/components/admin/settings/FeatureSwitchesCard.tsx |       await queryClient.invalidateQueries({ queryKey: SECTIONS_OPEN_QUERY_KEY }); |
 * @mutate src/components/mobileNav/useSectionTabs.ts |   const on = { declutter: declutter \|\| (guest && !!openToEveryone?.has("declutter")), shops, rentals } as const; |   const on = { declutter, shops, rentals } as const;
 * @mutate src/components/mobileNav/useSectionTabs.ts |   const guest = isReady && !user; |   const guest = false;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { render, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";

const rpc = vi.fn();
const auth = { user: { id: "u1" } as { id: string } | null, isReady: true };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => auth }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { sectionIsPreview, useSectionTabs } from "@/components/mobileNav/useSectionTabs";
import { SECTIONS_OPEN_QUERY_KEY } from "@/components/landing/useSectionsOpen";
import { PreviewPill } from "@/components/sections/PreviewPill";
import { __resetLangForTests, ensureLangLoaded, setLang } from "@/lib/i18n/language";

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
    expect(sectionIsPreview(true, "rentals", new Set())).toBe(true);
    expect(sectionIsPreview(true, "rentals", new Set(["shops"]))).toBe(true);
    expect(sectionIsPreview(true, "rentals", new Set(["rentals"])), "open to everyone").toBe(false);
    expect(sectionIsPreview(true, "rentals", null), "answer loading or failed").toBe(false);
    expect(sectionIsPreview(false, "rentals", new Set()), "not live for the viewer").toBe(false);
    expect(sectionIsPreview(false, "rentals", null)).toBe(false);
  });

  // Owner 2026-10-30 (via the lead): the owner and admins HAVE Declutter, so it is never marked "Coming soon" /
  // "Soon" for them, even while it is not yet open to everyone. Shops and Homes keep the tester mark.
  it("Declutter is open to everyone who has it: never a preview", () => {
    expect(sectionIsPreview(true, "declutter", new Set()), "live for the viewer, not yet for everyone").toBe(false);
    expect(sectionIsPreview(true, "declutter", new Set(["shops"]))).toBe(false);
    expect(sectionIsPreview(true, "shops", new Set(["declutter"])), "Shops keeps its mark").toBe(true);
  });
});

describe("(b) useSectionTabs `preview`", () => {
  it("tester: a section open to testers only is a preview; one open to everyone is not; one off is not", async () => {
    serve({ declutter: false, shops: true, rentals: true }, () => ({ data: ["shops"], error: null }));
    const { result } = renderHook(() => useSectionTabs(), { wrapper });
    await waitFor(() => expect(previews(result.current).rentals).toBe(true));
    expect(previews(result.current)).toEqual({ declutter: false, shops: false, rentals: true });
    expect(ons(result.current)).toEqual({ declutter: false, shops: true, rentals: true });
  });

  it("owner 2026-10-30: a tester who has Declutter (not yet open to everyone) sees it live with no mark", async () => {
    serve({ declutter: true, shops: true, rentals: true }, () => ({ data: [], error: null }));
    const { result } = renderHook(() => useSectionTabs(), { wrapper });
    await waitFor(() => expect(previews(result.current).shops).toBe(true));
    expect(previews(result.current)).toEqual({ declutter: false, shops: true, rentals: true });
    expect(ons(result.current).declutter).toBe(true);
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
    await waitFor(() => expect(previews(result.current)).toEqual({ declutter: false, shops: true, rentals: false }));
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
    serve({ declutter: false, shops: true, rentals: false }, () => (fail ? { data: null, error: { message: "boom", code: "500" } } : { data: [], error: null }));
    const { result } = renderHook(() => useSectionTabs(), { wrapper });
    await waitFor(() => expect(previews(result.current).shops).toBe(true));
    fail = true;
    await client.refetchQueries({ queryKey: SECTIONS_OPEN_QUERY_KEY });
    await waitFor(() => expect(client.getQueryState(SECTIONS_OPEN_QUERY_KEY)?.status).toBe("error"));
    await waitFor(() => expect(previews(result.current).shops).toBe(false));
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

  it("a member with nothing live never asks features_open_to_everyone; a guest asks, and is never shown a preview", async () => {
    serve({ declutter: false, shops: false, rentals: false }, () => ({ data: ["declutter", "shops"], error: null }));
    const a = renderHook(() => useSectionTabs(), { wrapper });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("feature_switches_for_me", expect.anything()));
    await tick();
    expect(askedOpen()).toBe(0);
    auth.user = null;
    const b = renderHook(() => useSectionTabs(), { wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider> });
    // AUD31-73: a guest's Declutter (open to everyone, readable by guests) is live, never greyed "Soon"; Shops and
    // Homes stay off for a guest even when open (no guest pages).
    await waitFor(() => expect(b.result.current.find((t) => t.feature === "declutter")?.on).toBe(true));
    expect(askedOpen()).toBeGreaterThan(0);
    expect(b.result.current.find((t) => t.feature === "shops")?.on).toBe(false);
    expect(previews(a.result.current)).toEqual({ declutter: false, shops: false, rentals: false });
    expect(previews(b.result.current)).toEqual({ declutter: false, shops: false, rentals: false });
    expect(a.result.current.find((t) => t.feature === "declutter")?.on).toBe(false);
  });
});

describe("(c) every listing draws PreviewPill, gated on the section's own preview flag", () => {
  const read = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));
  const SITES: Array<[string, RegExp]> = [
    ["src/components/DesktopSidebarNav.tsx", /\{preview && <PreviewPill variant="rail"/],
    ["src/components/profile/SettingsTab.tsx", /badge=\{preview \? <PreviewPill\b/],
    ["src/components/create/CreateSheet.tsx", /\{on && isPreview\(s\) && <PreviewPill\b/],
  ];
  it("inventory: three listings (Explore's chips left on 2026-10-22, see the header note)", () => expect(SITES.length).toBeGreaterThan(2));
  it.each(SITES)("%s", (f, re) => expect(read(f)).toMatch(re));

  it("each site's flag comes from useSectionTabs' `preview`", () => {
    expect(read("src/components/DesktopSidebarNav.tsx")).toMatch(/preview: t \? t\.preview : false/);
    expect(read("src/components/profile/SettingsTab.tsx")).toMatch(/const preview = s\.feature !== null && !!tab\?\.preview;/);
    expect(read("src/components/sections/ExploreSwitcher.tsx")).toMatch(/s\.feature !== null && !!live\.find\(\(t\) => t\.path === s\.path\)\?\.preview/);
  });

  it("the mark says 'Coming soon' (the phone switcher's words, A2-L17) in sentence case, muted olive, in both variants", () => {
    for (const variant of ["pill", "rail"] as const) {
      const { container, unmount } = render(<PreviewPill variant={variant} data-x="" />);
      const el = container.querySelector("[data-preview-pill]") as HTMLElement;
      expect({ variant, text: el.textContent?.trim(), color: el.style.color }).toEqual({ variant, text: "Coming soon", color: "hsl(var(--bark))" });
      unmount();
    }
  });

  // AUD31-52: in Spanish the rail read "Tiendas · Muy pronto" (SoonPill) beside "Casas · Coming soon" (this mark).
  it("speaks the viewer's language, like SoonPill (soon.full)", async () => {
    setLang("es");
    await ensureLangLoaded();
    try {
      for (const variant of ["pill", "rail"] as const) {
        const { container, unmount } = render(<PreviewPill variant={variant} data-x="" />);
        expect((container.querySelector("[data-preview-pill]") as HTMLElement).textContent?.trim()).toBe("Muy pronto");
        unmount();
      }
    } finally {
      __resetLangForTests();
    }
  });

  it("on the rail the mark is a line under the section's name, inside the label (beside it, the row ran past its padding)", () => {
    expect(read("src/components/DesktopSidebarNav.tsx")).toMatch(/\{soon && <SoonPill variant="rail"[^}]*\}\s*(?:\{\s*\}\s*)?\{preview && <PreviewPill variant="rail" \/>\}\s*<\/span>/);
  });

  it("an admin's switch change re-asks which sections are open to everyone", () => {
    expect(read("src/components/admin/settings/FeatureSwitchesCard.tsx")).toMatch(/invalidateQueries\(\{ queryKey: SECTIONS_OPEN_QUERY_KEY \}\)/);
  });
});
