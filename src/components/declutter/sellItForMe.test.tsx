/**
 * Declutter "Sell it for me" (owner order 2026-10-19 ~21Z): the entry, the
 * sheet's two choices, and the switch gates.
 *   - The entry shows only while the 'declutter' switch is on.
 *   - A: "Hire a local Helpr" opens Post a job at ?sellForMe=1, which
 *     pre-fills a Declutter Help job (category, a title that fits the 32-char
 *     cap, the template with the no-account line).
 *   - B: nearby shops in "Declutter and estate sale services" on the Shops
 *     card, each with a greyed "Request a quote" (Coming soon; no shop can be
 *     asked yet: Q1869 / Q1947), and an empty state that only says so (deep
 *     audit #34: its "Hire a Helpr instead" did what "Hire a local Helpr",
 *     right above, does).
 *     Only while the 'shops' switch is on; otherwise the sheet offers A alone
 *     and never asks for shops.
 * The data modules are stubbed; the shop category's place in the list is
 * src/test/shopCategories.test.ts, the enum value src/lib/jobCategories.test.ts.
 *
 * @mutate src/components/declutter/SellItForMe.tsx |   if (!declutterOn) return null; |
 * @mutate src/components/declutter/SellItForMe.tsx | {shopsOn && open && <LocalBusinesses />} | {open && <LocalBusinesses />}
 * @mutate src/components/declutter/SellItForMe.tsx |     queryFn: () => browseShops({ lat: from?.lat ?? null, lng: from?.lng ?? null, category: SELL_FOR_ME_SHOP_CATEGORY }), |     queryFn: () => browseShops({ lat: from?.lat ?? null, lng: from?.lng ?? null }),
 * @mutate src/components/declutter/SellItForMe.tsx |                   onClick={() => setAsked(s.id)} |                   onClick={() => {}}
 * @mutate src/components/declutter/SellItForMe.tsx |           <p className="mt-2 text-sm font-semibold">No local businesses offer this yet.</p>\n |           <p className="mt-2 text-sm font-semibold">No local businesses offer this yet.</p><button type="button">Hire a Helpr instead</button>\n
 * @mutate src/components/declutter/SellItForMe.tsx |     if (underAge) {\n      explain("post");\n      return;\n    } | 
 * @mutate src/components/declutter/SellItForMe.tsx |     onHire();\n |     onOpenChange(false);\n
 * @mutate src/components/declutter/SellItForMe.tsx |     if (shopsOn) setOpen(true); |     setOpen(true);
 * @mutate src/components/declutter/HelprListExplainSheet.tsx | navigate(sellForMePostJobPath()); | navigate("/post-job");
 * @mutate src/components/declutter/DeclutterHomeView.tsx |                 <SellChooserEntry movingOutOn={movingOutOn} />\n | \n
 * @mutate src/pages/post-job/useJobFormEffects.ts |     setCategory(p.category);\n    setTitle(kept?.title \|\| p.title); |     setTitle(kept?.title \|\| p.title);
 * @mutate src/components/declutter/SellOneScreen.tsx |           {!form.free && ai.state.status !== "done" && !s.keptWork.restored && <SellItForMeEntry />}\n | \n
 * @mutate src/pages/post-job/usePostJobForm.ts |   const skipEntry = !!(searchParams.get(SELL_FOR_ME_PARAM) \|\| | const skipEntry = !!(
 * @mutate src/lib/declutter/sellForMe.ts | const SELL_FOR_ME_TITLE = "Help me list my things to sell"; | const SELL_FOR_ME_TITLE = "Help me list my things to sell, please";
 * Audit 10-30 #14: a reload keeps what was typed; the template only fills an empty start.
 * @mutate src/pages/post-job/useJobFormEffects.ts |     setDescription(kept?.description \|\| p.description); |     setDescription(p.description);
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const state = vi.hoisted(() => ({
  switches: { declutter: true, shops: true } as Record<string, boolean>,
  shops: [] as unknown[],
  browseCalls: [] as unknown[],
  fail: false,
  underAge: false,
  explained: [] as string[],
}));

vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => !!state.switches[k] }));
vi.mock("@/hooks/useAgeGate", () => ({
  useAgeGate: () => ({
    underAge: state.underAge,
    explain: (kind: string) => { state.explained.push(kind); },
    gatedProps: (kind: string) => (state.underAge ? { "aria-disabled": true, "data-age-gated": kind } : {}),
  }),
}));
vi.mock("./useDeclutterOrigin", () => ({ useDeclutterOrigin: () => ({ origin: { status: "ready", lat: 30.45, lng: -91.15 } }) }));
vi.mock("@/lib/shops/api", () => ({
  browseShops: async (args: unknown) => {
    state.browseCalls.push(args);
    if (state.fail) throw Object.assign(new Error("Failed to fetch"), { userMessage: "We couldn't reach Louisiana Helpr. Try again." });
    return state.shops;
  },
  fetchShopCardExtras: async (ids: string[]) => new Map(ids.map((id) => [id, { cover_path: null, hours: [] }])),
  fetchShopCategories: async () => [
    { slug: "declutter_estate_sales", group_slug: "home_services", group_label: "Home services", label: "Declutter and estate sale services", position: 211 },
  ],
  shopPhotoUrl: (p: string) => `https://x/${p}`,
}));

import { SellItForMeEntry, QUOTE_SOON_LINE } from "./SellItForMe";
import { buildSellForMePrefill, SELL_FOR_ME_NO_ACCOUNT_LINE, sellForMePostJobPath } from "@/lib/declutter/sellForMe";
import { JOB_CATEGORY_LABELS, JOB_CATEGORY_VALUES } from "@/lib/jobCategories";
import { isLaborTaxable } from "@/lib/salesTax";

function shop(id: string, name: string) {
  return { id, name, category: "declutter_estate_sales", area_label: "Baton Rouge", miles: 3, rating: null, review_count: 0, logo_path: null, paused: false, badges: null };
}

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/declutter?tab=selling"]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/declutter" element={<SellItForMeEntry />} />
          <Route path="/post-job" element={<Where />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const open = () => fireEvent.click(screen.getByTestId("sell-it-for-me-entry"));

describe("Sell it for me: the entry", () => {
  beforeEach(() => {
    state.switches = { declutter: true, shops: true };
    state.shops = [];
    state.browseCalls = [];
    state.fail = false;
  });

  it("shows the plain-words entry while Declutter is on", () => {
    show();
    const entry = screen.getByTestId("sell-it-for-me-entry");
    expect(entry).toHaveTextContent("Sell it for me");
    expect(entry).toHaveTextContent("Too busy? Get help photographing and listing your stuff");
  });

  it("is not there when the declutter switch is off for the viewer", () => {
    state.switches.declutter = false;
    show();
    expect(screen.queryByTestId("sell-it-for-me-entry")).toBeNull();
  });

  it("is reachable from the Selling tab (with the listings, so the empty state shows it) and sits on Sell an item for a new listing", () => {
    const home = blankComments(readFileSync(join(process.cwd(), "src/components/declutter/DeclutterHomeView.tsx"), "utf8"));
    // Owner 2026-10-30: under the listings, "More ways to sell" is ONE row to the sell chooser (so the empty state shows
    // it too), whose "Have a Helpr list it for me" is this option A (src/components/declutter/declutterSellChooser.test.tsx).
    expect(home).toMatch(/<MyListingsView userId=\{userId\} haulOn=\{haulOn\} \/>[\s\S]{0,600}?<SellChooserEntry movingOutOn=\{movingOutOn\} \/>/);
    // A NEW listing is the one screen (owner 2026-10-29); a saved draft keeps the step form, without the entry.
    const sell = blankComments(readFileSync(join(process.cwd(), "src/components/declutter/SellOneScreen.tsx"), "utf8"));
    expect(sell).toMatch(/<SellItForMeEntry \/>/);
    const steps = blankComments(readFileSync(join(process.cwd(), "src/components/declutter/DeclutterSellView.tsx"), "utf8"));
    expect(steps).not.toMatch(/<SellItForMeEntry/);
  });
});

describe("Sell it for me: A, hire a Helpr", () => {
  beforeEach(() => {
    state.switches = { declutter: true, shops: true };
    state.shops = [];
    state.browseCalls = [];
    state.underAge = false;
    state.explained = [];
  });

  it("under 18 the Helpr choice is greyed and only says why (Q1586)", async () => {
    state.underAge = true;
    show();
    open();
    const hire = await screen.findByTestId("sell-for-me-hire-helpr");
    expect(hire).toHaveAttribute("data-age-gated", "post");
    fireEvent.click(hire);
    expect(state.explained).toEqual(["post"]);
    expect(screen.queryByTestId("where")).toBeNull();
  });

  it("opens Post a job pre-filled for a Declutter Help job", async () => {
    show();
    open();
    fireEvent.click(await screen.findByTestId("sell-for-me-hire-helpr"));
    // Audit 10-30 #1: the explanation first, then the job.
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/post-job?sellForMe=1");
    expect(sellForMePostJobPath()).toBe("/post-job?sellForMe=1");
  });

  it("the pre-fill is a real category, a title that fits, and the no-account template", () => {
    const p = buildSellForMePrefill();
    expect(p.category).toBe("declutter_help");
    expect(JOB_CATEGORY_VALUES).toContain(p.category);
    expect(JOB_CATEGORY_LABELS.declutter_help).toBe("Declutter help");
    // public.jobs CHECKs (Q782): title <= 32, description <= 1000 code points.
    expect(Array.from(p.title).length).toBeLessThanOrEqual(32);
    expect(p.title).toBe("Help me list my things to sell");
    expect(Array.from(p.description).length).toBeLessThanOrEqual(1000);
    for (const ask of ["How many items", "Rough size"]) expect(p.description).toContain(ask);
    // POST-H3 (owner 10-31): no "handle pickups" line.
    expect(p.description).not.toMatch(/pickups/i);
    expect(p.description).toContain(SELL_FOR_ME_NO_ACCOUNT_LINE);
    expect(SELL_FOR_ME_NO_ACCOUNT_LINE).toBe("You take the photos and write the listings in the app, on my account; I approve each one before it goes on sale.");
  });

  it("Declutter Help is untaxed, like errands and cleaning", () => {
    expect(isLaborTaxable("declutter_help")).toBe(false);
    expect(isLaborTaxable("errands")).toBe(false);
  });
});

describe("Sell it for me: B, ask a local business", () => {
  beforeEach(() => {
    state.switches = { declutter: true, shops: true };
    state.shops = [];
    state.browseCalls = [];
    state.fail = false;
  });

  it("lists nearby shops in the declutter category on the Shops card, each with a greyed Request a quote", async () => {
    state.shops = [shop("s1", "Bayou Consignment"), shop("s2", "Red Stick Estate Sales")];
    show();
    open();
    const cards = await screen.findAllByTestId("sell-for-me-shop");
    expect(cards).toHaveLength(2);
    expect(state.browseCalls[0]).toMatchObject({ category: "declutter_estate_sales", lat: 30.45, lng: -91.15 });
    const first = within(cards[0]);
    expect(first.getByText("Bayou Consignment")).toBeInTheDocument();
    expect(cards[0].querySelector("[data-shop-card]")?.getAttribute("href")).toBe("/shops/s1");
    const ask = first.getByTestId("sell-for-me-request-quote");
    expect(ask).toHaveAttribute("aria-disabled", "true");
    expect(first.getByText("Coming soon")).toBeInTheDocument();
    expect(screen.queryByText(QUOTE_SOON_LINE)).toBeNull();
    fireEvent.click(ask);
    expect(first.getByText(QUOTE_SOON_LINE)).toBeInTheDocument();
    // Nothing navigated: no dead thread, no quote form.
    expect(screen.queryByTestId("where")).toBeNull();
  });

  it("no businesses yet: says so, and the sheet has ONE way to hire a Helpr (deep audit #34)", async () => {
    show();
    open();
    const empty = await screen.findByTestId("sell-for-me-no-businesses");
    expect(empty).toHaveTextContent("No local businesses offer this yet.");
    expect(within(empty).queryAllByRole("button")).toHaveLength(0);
    const sheet = screen.getByTestId("sell-it-for-me-sheet");
    expect(within(sheet).getAllByRole("button", { name: /hire a( local)? helpr/i })).toHaveLength(1);
    fireEvent.click(screen.getByTestId("sell-for-me-hire-helpr"));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/post-job?sellForMe=1");
  });

  it("a failed read is an error with Try again, never 'none yet'", async () => {
    state.fail = true;
    show();
    open();
    expect(await screen.findByText("We couldn't load businesses.")).toBeInTheDocument();
    expect(screen.queryByTestId("sell-for-me-no-businesses")).toBeNull();
  });

  it("with the shops switch off: only the Helpr choice, and shops are never asked for", async () => {
    state.switches.shops = false;
    state.shops = [shop("s1", "Bayou Consignment")];
    show();
    open();
    // Audit 10-30 #21: one choice needs no sheet, so the explanation opens at once.
    expect(await screen.findByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.queryByTestId("sell-for-me-hire-helpr")).toBeNull();
    expect(screen.queryByTestId("sell-for-me-businesses")).toBeNull();
    expect(state.browseCalls).toHaveLength(0);
  });
});

const noop = () => {};
/** Every param the effects read, on an empty form; `over` holds the setters a test watches. */
const effectParams = (over: Record<string, unknown>) => ({
  searchParams: new URLSearchParams("sellForMe=1"),
        profile: null,
        flushDraft: noop,
        saveDraft: noop,
        setOnboardingFeeCents: noop,
        setOpenJobCount: noop,
        setOnboardingFeePaid: noop,
        setStreetAddress: noop,
        setCity: noop,
        setAddrState: noop,
        setZipCode: noop,
        setBudget: noop,
        setEstimatedHours: noop,
        setSpecialRequirements: noop,
        setIsRecurring: noop,
        setRecurrenceInterval: noop,
        setParish: noop,
        setOfferToHelperId: noop,
        setOfferToHelperName: noop,
        title: "",
        description: "",
        category: "",
        streetAddress: "",
        city: "",
        addrState: "",
        zipCode: "",
        dateNeeded: "",
        startTime: "",
        estimatedHours: "",
        budget: "",
        specialRequirements: "",
        isRecurring: false,
        recurrenceInterval: "weekly",
        recurrenceEndDate: "",
        isFlexibleSchedule: false,
        isUrgent: false,
        urgentFee: "",
        isGroupJob: false,
        helpersNeeded: "1",
        credentialTier: 0,
        includeMaterials: false,
        materialsNote: "",
        offerToHelperId: null,
  ...over,
});

describe("Post a job reads ?sellForMe=1", () => {
  it("skips the entry screen and pre-fills category, title and description", async () => {
    const form = blankComments(readFileSync(join(process.cwd(), "src/pages/post-job/usePostJobForm.ts"), "utf8"));
    expect(form).toMatch(/const skipEntry = !!\(searchParams\.get\(SELL_FOR_ME_PARAM\) \|\|/);
    vi.resetModules();
    vi.doMock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: false }) }));
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: { rpc: () => Promise.resolve({ data: null, error: null }), from: () => ({}) },
    }));
    const { useJobFormEffects } = await import("@/pages/post-job/useJobFormEffects");
    const set = { category: "", title: "", description: "" };
    renderHook(() =>
      useJobFormEffects(effectParams({
        setTitle: (v: string) => { set.title = v; },
        setDescription: (v: string) => { set.description = v; },
        setCategory: (v: string) => { set.category = v; },
      }) as never),
    );
    expect(set).toEqual(buildSellForMePrefill());
  });

  it("#14: a reload puts back what was typed, not the template", async () => {
    const { useJobFormEffects } = await import("@/pages/post-job/useJobFormEffects");
    localStorage.setItem("helpr_draft_job", JSON.stringify({ title: "Help with my garage", description: "EDITED about 12 items", category: "declutter_help", savedAt: Date.now() }));
    const set = { setCategory: vi.fn(), setTitle: vi.fn(), setDescription: vi.fn() };
    renderHook(() => useJobFormEffects(effectParams(set) as never));
    expect(set.setCategory).toHaveBeenLastCalledWith("declutter_help");
    expect(set.setTitle).toHaveBeenLastCalledWith("Help with my garage");
    expect(set.setDescription).toHaveBeenLastCalledWith("EDITED about 12 items");
    localStorage.removeItem("helpr_draft_job");
  });

  it("#14: a kept draft from another kind of job never fills this one", async () => {
    const { useJobFormEffects } = await import("@/pages/post-job/useJobFormEffects");
    localStorage.setItem("helpr_draft_job", JSON.stringify({ title: "Mow my lawn", description: "Front and back", category: "yard_work", savedAt: Date.now() }));
    const set = { setCategory: vi.fn(), setTitle: vi.fn(), setDescription: vi.fn() };
    renderHook(() => useJobFormEffects(effectParams(set) as never));
    expect(set.setDescription).toHaveBeenLastCalledWith(buildSellForMePrefill().description);
    localStorage.removeItem("helpr_draft_job");
  });
});
