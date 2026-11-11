/**
 * F260q (owner 11-11 "Spanish everything"): Declutter Browse in Spanish. The category chips, the card's tags,
 * condition and distance, the filter chips above the cards, the section tabs (Browse | Buying | Selling ...) and the
 * search bar read enDeclutter.ts / esDeclutter.ts. Rendered in English and in Spanish; the source check that no
 * written-in word is left on those files is spanishScreensUseDictionary.test.ts.
 *
 * @mutate src/components/declutter/DeclutterItemCard.tsx |   const condition = CONDITION_LABEL[item.condition_stars] ? t(`decl.cond.${item.condition_stars}` as MsgKey) : null; |   const condition = CONDITION_LABEL[item.condition_stars] ?? null;
 * @mutate src/components/declutter/DeclutterItemCard.tsx | <PhotoTag data-card-porch="">{t("decl.card.porch")}</PhotoTag> | <PhotoTag data-card-porch="">{"Porch pickup"}</PhotoTag>
 * @mutate src/components/declutter/DeclutterCategoryChips.tsx |           {CATEGORY_LABEL[k] && t(`decl.cat.${k}` as MsgKey)} |           {CATEGORY_LABEL[k]}
 * @mutate src/components/declutter/DeclutterActiveFilters.tsx | label: t("decl.filter.drops"), | label: "Price drops",
 * @mutate src/components/sections/SectionSearchBar.tsx |   return { search: t("section.search"), noun: key ? t(key) : noun }; |   return { search: "Search", noun };
 * @mutate src/components/declutter/DeclutterHomeView.tsx |     items: lists.map((l) => ({ key: l.value, label: tr(l.labelKey), |     items: lists.map((l) => ({ key: l.value, label: l.label,
 * @mutate src/components/declutter/declutterUi.tsx |   const label = CONDITION_LABEL[stars] ? t(`decl.cond.${stars}` as MsgKey) : null; |   const label = CONDITION_LABEL[stars];
 * @mutate src/components/declutter/DeclutterItemView.tsx | className="text-base font-semibold">{t("decl.item.about")}</h2> | className="text-base font-semibold">About this item</h2>
 * @mutate src/components/declutter/DeclutterItemView.tsx | <Detail label={t("decl.item.category")}>{CATEGORY_LABEL[it.category] ? t(`decl.cat.${it.category}` as MsgKey) : t("decl.cat.other")}</Detail> | <Detail label={t("decl.item.category")}>{CATEGORY_LABEL[it.category] ?? "Other"}</Detail>
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { ItemCard } from "@/components/declutter/DeclutterItemCard";
import { DeclutterCategoryChips } from "@/components/declutter/DeclutterCategoryChips";
import { DeclutterActiveFilters } from "@/components/declutter/DeclutterActiveFilters";
import { SectionSearchBar } from "@/components/sections/SectionSearchBar";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { enDeclutter } from "@/lib/i18n/enDeclutter";
import { esDeclutter } from "@/lib/i18n/esDeclutter";
import { CATEGORY_LABEL } from "@/lib/declutter/categoryIcons";
import { CONDITION_LABEL } from "@/lib/declutter/conditionLabels";
import { ConditionChip } from "@/components/declutter/declutterUi";

const item = {
  id: "i9", seller_id: "u2", status: "live", title: "Oak rocking chair", category: "furniture", condition_stars: 4,
  price_cents: 0, current_price_cents: 0, area_label: "Mid-City", area_lat: 30.45, area_lng: -91.15, porch_ok: true,
} as never;
const items = [
  { ...(item as object), id: "a", category: "furniture" }, { ...(item as object), id: "b", category: "tools" },
  { ...(item as object), id: "c", category: "tools", current_price_cents: 500 },
] as never;
const filters = { category: null, freeOnly: false, minDollars: null, maxDollars: null, conditions: [], porchOnly: false, ways: [], dropsOnly: true, tradesOnly: false } as never;

const draw = () => render(
  <MemoryRouter>
    <ItemCard item={item} miles={0.5} approximate={false} />
    <DeclutterCategoryChips items={items} value={null} onChange={() => {}} free={false} onFree={() => {}} />
    <DeclutterActiveFilters filters={filters} maxMiles={null} onChange={() => {}} />
    <SectionSearchBar noun="Declutter" home="/declutter" />
  </MemoryRouter>,
);

afterEach(() => { cleanup(); __resetLangForTests(); });

describe("F260q: Declutter Browse in Spanish", () => {
  it("the dictionary's English is the app's own words", () => {
    for (const [k, v] of Object.entries(CATEGORY_LABEL)) expect(enDeclutter[`decl.cat.${k}` as keyof typeof enDeclutter], k).toBe(v);
    for (const [k, v] of Object.entries(CONDITION_LABEL)) expect(enDeclutter[`decl.cond.${k}` as keyof typeof enDeclutter], k).toBe(v);
    expect(Object.keys(CATEGORY_LABEL).length).toBeGreaterThan(20);
    for (const k of Object.keys(enDeclutter) as (keyof typeof enDeclutter)[]) {
      if (k === "section.noun.declutter" || k === "decl.cat.camping") continue; // brand name / same word
      expect(esDeclutter[k], k).not.toBe(enDeclutter[k]);
    }
  });

  it("English: unchanged words", () => {
    draw();
    expect(screen.getAllByText("Free").length).toBeGreaterThan(0);
    expect(screen.getByText("Porch pickup")).toBeTruthy();
    expect(screen.getByText("Lightly used")).toBeTruthy();
    expect(screen.getByText("Under 1 mi")).toBeTruthy();
    expect(screen.getByText("Furniture")).toBeTruthy();
    expect(screen.getByText("Price drops")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search Declutter" })).toBeTruthy();
  });

  it("Spanish: the card, the chips, the filter chip and the search bar", async () => {
    setLang("es");
    await act(async () => { await ensureLangLoaded(); });
    draw();
    expect(screen.getAllByText("Gratis").length).toBeGreaterThan(1); // price + Free chip
    expect(screen.getByText("Recoger en el porche")).toBeTruthy();
    expect(screen.getByText("Poco usado")).toBeTruthy();
    expect(screen.getByText("Menos de 1 mi")).toBeTruthy();
    expect(screen.getByText("Muebles")).toBeTruthy();
    expect(screen.getByText("Herramientas")).toBeTruthy();
    expect(screen.getByText("Todo")).toBeTruthy();
    expect(screen.getByText("Bajadas de precio")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Buscar en Declutter" })).toBeTruthy();
    expect(screen.queryByText("Porch pickup")).toBeNull();
  });

  it("the My Declutter menu and the tabs carry their dictionary keys", () => {
    const home = blankComments(readFileSync("src/components/declutter/DeclutterHomeView.tsx", "utf8"));
    for (const k of ["buying", "selling", "deliver", "wanted", "free"]) expect(home).toContain(`labelKey: "decl.tab.${k}"`);
    expect(home).toContain('title: tr("decl.myDeclutter"),');
    expect(home).toContain("label: tr(l.labelKey),");
  });

  it("the item page: the condition chip renders Spanish, and the page draws its words from the dictionary", async () => {
    setLang("es");
    await act(async () => { await ensureLangLoaded(); });
    render(<ConditionChip stars={5} />);
    expect(screen.getByText("Como nuevo")).toBeTruthy();
    const view = blankComments(readFileSync("src/components/declutter/DeclutterItemView.tsx", "utf8"));
    const keys = ["decl.item.about", "decl.item.category", "decl.item.size", "decl.item.freePorch", "decl.item.save", "decl.item.share", "decl.item.bought", "decl.item.messageSeller", "decl.card.trades"];
    for (const k of keys) expect(view, k).toContain(`t("${k}")`);
    expect(view).toContain("t(`decl.cat.${it.category}` as MsgKey)");
    expect(view).not.toMatch(/>About this item<|>Free porch pickup|"Save this item"|"Share this item"/);
  });
});
