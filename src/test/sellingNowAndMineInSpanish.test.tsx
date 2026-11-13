/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): "Selling now · N" on a member's profile (SellingNowRow, its own panel
 * dictionary enSellingNow) and the Buying/Selling chip row and empty notices (DeclutterMineViews, enDeclutter decl.mv.*)
 * in the member's language. An English member reads the old words, word for word.
 *
 * @mutate src/components/declutter/SellingNowRow.tsx |           {t("sn.title", { n: rest.length })}\n |           Selling now · {rest.length}\n
 * @mutate src/components/declutter/SellingNowRow.tsx | {all ? t("sn.fewer") : t("sn.all")} | {all ? t("sn.fewer") : "See all"}
 * @mutate src/components/declutter/DeclutterMineViews.tsx | { key: "offers", label: t("decl.mv.toAnswer"), count: toAnswer, hot: true }, | { key: "offers", label: "To answer", count: toAnswer, hot: true },
 * @mutate src/components/declutter/DeclutterMineViews.tsx | <DeclutterNotice title={t("decl.mv.noneBought")}> | <DeclutterNotice title="Nothing bought yet.">
 * @mutate src/components/declutter/DeclutterMineViews.tsx |         {t("decl.mv.all")}{all > 0 | All{all > 0
 * @mutate src/components/declutter/declutterSellingParts.tsx | font-semibold">{t("decl.hv.settings")}</span> | font-semibold">Declutter settings</span>
 * @mutate src/components/declutter/DeclutterHomeView.tsx | text={t("decl.hv.sell")} /> | text="Sell" />
 * @mutate src/components/declutter/declutterSellingParts.tsx | { get label() { return t("decl.hv.settings"); }, | { label: "Declutter settings",
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enSellingNow } from "@/lib/i18n/enSellingNow";
import { esSellingNow } from "@/lib/i18n/esSellingNow";
import { enDeclutter } from "@/lib/i18n/enDeclutter";
import { esDeclutter } from "@/lib/i18n/esDeclutter";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => k === "declutter" }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<object>()),
  fetchSellerItems: async () => [1, 2, 3].map((n) => ({ id: `i${n}`, title: `Lamp ${n}`, category: "home", current_price_cents: 500 })),
  fetchPhotos: async () => [],
}));

const { SellingNowRow } = await import("@/components/declutter/SellingNowRow");

const show = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><SellingNowRow sellerId="s1" /></MemoryRouter></QueryClientProvider>);
};

describe("Selling now and the Buying/Selling chips follow the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every word has its Spanish, and es.ts carries it", () => {
    const mv = (Object.keys(enDeclutter) as (keyof typeof enDeclutter)[]).filter((k) => k.startsWith("decl.mv."));
    expect(mv.length).toBeGreaterThan(8);
    for (const k of mv) {
      expect(es[k], k).toBe(esDeclutter[k]);
      expect(esDeclutter[k], `${k} still English`).not.toBe(enDeclutter[k]);
    }
    for (const k of Object.keys(enSellingNow) as (keyof typeof enSellingNow)[]) {
      expect(es[k], k).toBe(esSellingNow[k]);
      expect(esSellingNow[k], `${k} still English`).not.toBe(enSellingNow[k]);
    }
  });

  it("the chip row, Nothing bought yet and Nothing to answer read the dictionary", () => {
    const src = blankComments(readFileSync("src/components/declutter/DeclutterMineViews.tsx", "utf8"));
    for (const k of ["decl.mv.all", "decl.mv.filter", "decl.mv.noneBought", "decl.mv.noneBoughtBody", "decl.mv.toAnswer", "decl.mv.listings", "decl.mv.pickups", "decl.mv.history", "decl.mv.nothingToAnswer", "decl.mv.ended"]) {
      expect(src, k).toContain(`t("${k}")`);
    }
    expect(src).not.toMatch(/label: "|title="(Nothing|Ended)|>\s*All\{/);
  });

  it("Declutter home's settings row, Sell pill, tab row name and More ways to sell read the dictionary", () => {
    // Selling's settings row and DECLUTTER_SETTINGS moved to declutterSellingParts.tsx (componentSizeRatchet, 2026-11-13).
    const src = ["src/components/declutter/DeclutterHomeView.tsx", "src/components/declutter/declutterSellingParts.tsx"]
      .map((f) => blankComments(readFileSync(f, "utf8"))).join("\n");
    for (const k of ["decl.hv.moreWays", "decl.hv.settings", "decl.hv.settingsSub", "decl.hv.view", "decl.hv.sell"]) expect(src, k).toContain(`t("${k}")`);
    expect(src).not.toMatch(/"Declutter settings"|"Declutter view"|text="Sell"|"More ways to sell"|>Listing defaults/);
    // The settings row and the gear's name (DECLUTTER_SETTINGS.label) both read it; the tab row's name is read 3 times.
    expect(src.split('t("decl.hv.settings")').length - 1).toBe(2);
    expect(src.split('t("decl.hv.view")').length - 1).toBe(3);
    const hv = (Object.keys(enDeclutter) as (keyof typeof enDeclutter)[]).filter((k) => k.startsWith("decl.hv."));
    expect(hv.length).toBe(11); // 5 here + 6 in sellingPanelsInSpanish
    for (const k of hv) {
      expect(es[k], k).toBe(esDeclutter[k]);
      expect(esDeclutter[k], `${k} still English`).not.toBe(enDeclutter[k]);
    }
  });

  it("English: Selling now · 3 and See all", async () => {
    show();
    expect(await screen.findByText("Selling now · 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "See all" })).toBeTruthy();
  });

  it("Spanish: Vendiendo ahora · 3 and Ver todo", async () => {
    setLang("es");
    await ensureLangLoaded();
    show();
    expect(await screen.findByText("Vendiendo ahora · 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ver todo" })).toBeTruthy();
  });
});
