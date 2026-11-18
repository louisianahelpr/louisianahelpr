/**
 * Design audit area 02, Home dashboard (11-18, ~/.lh-shots/design-audit-areas/02-home/FINDINGS.md).
 *
 * #1 (High): with Home's reads failing, a signed-in visitor at `/` sat on the route skeleton forever (no error, no
 *    Try again), and on the desktop website the bones spanned the whole window with no rail.
 * @mutate src/components/DashboardRouteSkeleton.tsx | const id = setTimeout(() => setStuck(true), ms); | const id = setTimeout(() => setStuck(false), ms);
 * @mutate src/components/DashboardRouteSkeleton.tsx | const railBones = desktop && typeof window !== "undefined" && !isDesktopRailRoute(window.location.pathname); | const railBones = false;
 *
 * #2 (High): the Create and Customize sheets were English in Español.
 * @mutate src/components/create/CreateSheet.tsx | <SheetHero moment title={t("cs.title")} /> | <SheetHero moment title="What are we doing?" />
 * @mutate src/components/create/CreateSheet.tsx | { label: t("cs.sellItem"), path | { label: "Sell an item", path
 * @mutate src/components/sections/CustomizeSheet.tsx | <SheetHero title={t("cz.title")} /> | <SheetHero title="Customize sections" />
 * #22 (Low): the Customize invite line was cut off at 390 ("Shop local or open a sh..."); it wraps.
 * @mutate src/components/sections/CustomizeSheet.tsx | <span className="block text-ds-13 text-muted-foreground" data-section-invite={key}> | <span className="block text-ds-13 text-muted-foreground truncate" data-section-invite={key}>
 *
 * #3 (High): /search was English in Español. #5 (Medium): it searched only on Enter.
 * @mutate src/pages/search/SearchStart.tsx | text-muted-foreground px-1">{t("srch.everySection")}</p> | text-muted-foreground px-1">Search every section at once.</p>
 * @mutate src/components/savedSearches/SaveSearchButton.tsx |         {t("srch.save")}\n |         Save this search\n
 * @mutate src/pages/search/SearchPage.tsx |     if (next === q) return;\n |     return;\n
 *
 * #4 (High): the Needs-you Declutter to-dos were English in Español ("Pick up ...", "Open order").
 * @mutate src/lib/declutter/declutterTodos.ts | w("dt.pickUp", `Pick up ${l.item_title}`, { item: l.item_title }) | `Pick up ${l.item_title}`
 * @mutate src/lib/declutter/declutterTodos.ts | action: seller ? w("dt.openSale", "Open sale") : w("dt.openOrder", "Open order"), | action: seller ? "Open sale" : "Open order",
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", async () => (await import("./helpers/emptySupabaseClient")).emptySupabaseModule());
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
const sw = vi.hoisted(() => ({ on: new Set(["declutter"]), desktop: false }));
vi.mock("@/hooks/useFeature", async (orig) => ({ ...(await orig<object>()), useFeature: (k: string) => sw.on.has(k) }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => sw.desktop }));
vi.mock("@/components/sections/useSectionPrefs", async (orig) => ({
  ...(await orig<object>()),
  useSectionPrefs: () => ({ prefs: { order: ["jobs", "declutter", "shops", "homes"], hidden: [] }, visible: [], setHidden: () => true, move: () => {} }),
}));

import DashboardRouteSkeleton, { HOME_SKELETON_STUCK_MS } from "@/components/DashboardRouteSkeleton";
import { CustomizeSheet } from "@/components/sections/CustomizeSheet";
import { CreateSheet, waysLine } from "@/components/create/CreateSheet";
import { SearchStart } from "@/pages/search/SearchStart";
import { SaveSearchButton } from "@/components/savedSearches/SaveSearchButton";
import { declutterTodos } from "@/lib/declutter/declutterTodos";
import type { CartLine } from "@/lib/declutter/api";

const spanish = async () => {
  setLang("es");
  await act(async () => { await ensureLangLoaded(); });
};
const wrap = (ui: React.ReactNode, path = "/") => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
  </QueryClientProvider>
);

beforeEach(() => __resetLangForTests());
afterEach(() => { cleanup(); vi.useRealTimers(); sw.desktop = false; __resetLangForTests(); });

describe("area 02 #1: Home's bones do not outlive the wait", () => {
  it("after the wait the skeleton shows an error card with Try again", () => {
    vi.useFakeTimers();
    render(wrap(<DashboardRouteSkeleton />));
    expect(screen.queryByTestId("home-stuck-card")).toBeNull();
    act(() => { vi.advanceTimersByTime(HOME_SKELETON_STUCK_MS + 10); });
    expect(screen.getByTestId("home-stuck-card")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(HOME_SKELETON_STUCK_MS).toBeGreaterThan(4000);
    expect(HOME_SKELETON_STUCK_MS).toBeLessThanOrEqual(10_000);
  });
  it("off a rail route the desktop bones draw the rail's place", () => {
    sw.desktop = true;
    window.history.replaceState(null, "", "/");
    render(wrap(<DashboardRouteSkeleton />));
    expect(screen.getByTestId("dashboard-route-skeleton-rail")).toBeInTheDocument();
    cleanup();
    sw.desktop = false;
    render(wrap(<DashboardRouteSkeleton />));
    expect(screen.queryByTestId("dashboard-route-skeleton-rail")).toBeNull();
  });
});

describe("area 02 #2: Create and Customize speak Spanish", () => {
  it("Customize sheet: title, sections, invites, Done", async () => {
    await spanish();
    render(wrap(<CustomizeSheet open onOpenChange={() => {}} />));
    expect(screen.getByText("Personalizar secciones")).toBeInTheDocument();
    expect(screen.getByText("Contrate ayuda o encuentre trabajo")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Mostrar Trabajos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Listo" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Customize sections|Use the arrows|Hire help/);
    // #22: the invite line wraps rather than cutting off.
    const invites = [...document.querySelectorAll("[data-section-invite]")];
    expect(invites.length).toBeGreaterThan(0);
    for (const el of invites) expect(el.className).not.toMatch(/\btruncate\b/);
  });
  it("Create sheet: title and the ways line", async () => {
    await spanish();
    render(wrap(<CreateSheet open onOpenChange={() => {}} />));
    expect(screen.getByText("¿Qué vamos a hacer?")).toBeInTheDocument();
    expect(waysLine(2)).toBe("Una cuenta, dos maneras de resolver lo que necesita.");
    expect(document.body.textContent).not.toMatch(/What are we doing/);
  });
  it("English is unchanged", () => {
    render(wrap(<CreateSheet open onOpenChange={() => {}} />));
    expect(screen.getByText("What are we doing?")).toBeInTheDocument();
    expect(waysLine(3)).toBe("One account, three ways to get things done.");
  });
});

describe("area 02 #3: /search speaks Spanish", () => {
  it("the start screen and the Save pill", async () => {
    await spanish();
    render(wrap(<><SearchStart userId={null} declutterOn signedIn={false} /><SaveSearchButton userId="u1" draft={{ section: "jobs", query: "x", category: null, minDollars: null, maxDollars: null, radiusMiles: null }} /></>));
    expect(await screen.findByText("Busque en todas las secciones a la vez.")).toBeInTheDocument();
    expect(await screen.findByText("Ver por categoría")).toBeInTheDocument();
    expect(screen.getByText("Guardar esta búsqueda")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Browse by category|Save this search|Search every section/);
  });
});

describe("area 02 #5: /search searches as you type", () => {
  it("typing writes the words to the URL after the pause, with no Enter", async () => {
    vi.useFakeTimers();
    const { default: SearchPage, SEARCH_AS_YOU_TYPE_MS } = await import("@/pages/search/SearchPage");
    let search = "";
    const Spy = () => { search = useLocation().search; return null; };
    render(wrap(<Routes><Route path="/search" element={<><SearchPage /><Spy /></>} /></Routes>, "/search"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "lamp" } });
    expect(search).toBe("");
    act(() => { vi.advanceTimersByTime(SEARCH_AS_YOU_TYPE_MS + 10); });
    expect(search).toContain("lamp");
    expect(SEARCH_AS_YOU_TYPE_MS).toBeLessThanOrEqual(500);
  });
});

describe("area 02 #4: the Declutter to-dos speak Spanish", () => {
  const line = (over: Partial<CartLine>): CartLine => ({
    item_id: "i1", item_title: "Lámpara", price_cents: 3000, status: "paid", order_id: "o1", order_status: "paid",
    handover: "pickup", my_side: "buyer", checkout_by: new Date(Date.now() + 3_600_000).toISOString(), ...over,
  } as unknown as CartLine);
  it("pickup row in Spanish, English unchanged", async () => {
    const en = declutterTodos([line({})], [], Date.now()).map((r) => r.item);
    expect(en[0]).toMatchObject({ title: "Pick up Lámpara", meta: "Buying · paid, waiting for the pickup", action: "Open order" });
    await spanish();
    const es = declutterTodos([line({})], [], Date.now()).map((r) => r.item);
    expect(es.length).toBeGreaterThan(0);
    expect(es[0]).toMatchObject({ title: "Recoja Lámpara", meta: "Comprando · pagado, falta recogerlo", action: "Abrir pedido" });
    const sold = declutterTodos([line({ my_side: "seller" })], [], Date.now()).map((r) => r.item);
    expect(sold[0]).toMatchObject({ title: "Entregue Lámpara", action: "Abrir venta" });
  });
});

/**
 * Mediums and Lows (area 02, 11-18).
 * #6: the desktop Home has the search pill in its bar.
 * @mutate src/pages/home/HomeDashboard.tsx | <Link to="/search" data-testid="home-desktop-search" | <Link to="/home" data-testid="home-desktop-search"
 * #8: See all lists the other to-dos, not the one on the card again.
 * @mutate src/pages/home/HomeDashboard.tsx | {summary.todos.filter((_, i) => i !== at).map((td, i, arr) => ( | {summary.todos.map((td, i, arr) => (
 * #11: a member whose posted jobs were all cancelled is not "Your first job posted"; the checklist sits on a card.
 * @mutate src/pages/home/homeDashboard/PosterFirstJobCard.tsx | posted: jobs.some((j) => !ENDED_UNDONE.has(j.status ?? "")), | posted: jobs.length > 0,
 * #15: the rail's Home row reads Home / Inicio, as the dock.
 * @mutate src/lib/i18n/enCore.ts |   "nav.home": "Home", |   "nav.home": "Dashboard",
 * #16: the rail's badge uses the shared 99+ cap.
 * @mutate src/components/DesktopSidebarNav.tsx |                       {formatUnreadBadge(count)}\n |                       {count > 9 ? "9+" : count}\n
 * #20: the section chips are a two-column grid.
 * @mutate src/pages/home/HomeDashboard.tsx | <div data-section-chips="" className="grid grid-cols-2 gap-2"> | <div data-section-chips="" className="flex flex-wrap gap-2">
 * #23: the money tiles carry a chevron.
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx | {!disabled && <ChevronRight data-money-chevron | {false && <ChevronRight data-money-chevron
 */
describe("area 02 Mediums and Lows", () => {
  it("#11: all-cancelled posted jobs are not a first job posted", async () => {
    const { posterFirstJobState } = await import("@/pages/home/homeDashboard/PosterFirstJobCard");
    const cancelled = { helper_id: null, status: "cancelled", poster_completed_at: null };
    expect(posterFirstJobState([cancelled, { ...cancelled, status: "expired" }]).posted).toBe(false);
    expect(posterFirstJobState([cancelled, { ...cancelled, status: "open" }]).posted).toBe(true);
    const src = blankComments(readFileSync("src/pages/home/homeDashboard/PosterFirstJobCard.tsx", "utf8"));
    expect(src).toContain('data-testid="poster-first-job" className="liquid-glass p-card');
  });
  it("#15: nav.home is Home / Inicio in both languages", async () => {
    const { en } = await import("@/lib/i18n/en");
    const { es } = await import("@/lib/i18n/es");
    expect(en["nav.home"]).toBe(en["nav.dockHome"]);
    expect(es["nav.home"]).toBe(es["nav.dockHome"]);
  });
  it("#6 #8 #16 #20 #23: the source carries each fix", () => {
    const home = blankComments(readFileSync("src/pages/home/HomeDashboard.tsx", "utf8"));
    expect(home).toMatch(/<Link to="\/search" data-testid="home-desktop-search"/);
    expect(home).toContain("{summary.todos.filter((_, i) => i !== at).map((td, i, arr) => (");
    expect(home).toContain('<GroupSection title={t("home.todo")} count={rest}>');
    expect(home).toContain('<div data-section-chips="" className="grid grid-cols-2 gap-2">');
    const rail = blankComments(readFileSync("src/components/DesktopSidebarNav.tsx", "utf8"));
    expect(rail).toContain("{formatUnreadBadge(count)}");
    expect(rail).not.toContain('{count > 9 ? "9+" : count}');
    const tiles = blankComments(readFileSync("src/pages/home/homeDashboard/HomeMoneyTiles.tsx", "utf8"));
    expect(tiles).toContain("{!disabled && <ChevronRight data-money-chevron");
  });
});
