/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): Sell a bunch's photo grid and photo sheet, the not-sorted pile, the row's
 * open/close and Free, and the bar that stays in view (keep this page open, undo, all set, Next: list N items) in the
 * member's language. Words in enListingParts (lp.bp.*, lp.br.*, lp.bb.*). An English member reads the old words.
 *
 * @mutate src/components/declutter/DeclutterBunchPhotos.tsx | data-bunch-cover="">{t("lp.bp.cover")}</span> | data-bunch-cover="">Cover</span>
 * @mutate src/components/declutter/DeclutterBunchPhotos.tsx |             {t("lp.bp.add")}\n |             Add photo\n
 * @mutate src/components/declutter/DeclutterBunchPhotos.tsx | aria-label={t("lp.bp.choose", { name, n: i + 1 })} | aria-label={`Choose ${name}, photo ${i + 1}`}
 * @mutate src/components/declutter/DeclutterBunchPile.tsx | onClick={onSortAgain}>{t("lp.bp.sortAgain")}</Button> | onClick={onSortAgain}>Sort again</Button>
 * @mutate src/components/declutter/DeclutterBunchPile.tsx | : t("lp.bp.pileN", { n }); | : `${n} photos not sorted yet`;
 * @mutate src/components/declutter/DeclutterBunchBar.tsx | onClick={onUndo}>{t("lp.bb.undo")}</Button> | onClick={onUndo}>Undo</Button>
 * @mutate src/components/declutter/DeclutterBunchBar.tsx | : t("lp.bb.nextN", { n: readyCount })}</Button> | : `Next: list ${readyCount} items`}</Button>
 * @mutate src/components/declutter/DeclutterBunchBar.tsx | {listingProgressLine(listing.done, listing.total, runNames)} {t("lp.bb.keepOpen")} | {listingProgressLine(listing.done, listing.total, runNames)} Keep this page open.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enListingParts } from "@/lib/i18n/enListingParts";
import { esListingParts } from "@/lib/i18n/esListingParts";
import { blankItem } from "@/lib/declutter/bunch";
import { BunchPhotos } from "@/components/declutter/DeclutterBunchPhotos";
import { BunchPileCard } from "@/components/declutter/DeclutterBunchPile";
import { BunchBar } from "@/components/declutter/DeclutterBunchBar";

const noop = () => {};
const show = () => render(
  <div>
    <BunchPhotos item={blankItem(["a", "b"])} name="Lamp" others={[]} urls={new Map()} files={new Map()} onMove={noop} onSplit={noop}
      onRemove={noop} onCover={noop} onReorder={noop} canDrag={false} onAdd={noop} />
    <BunchPileCard item={{ ...blankItem(["c", "d"]), notSorted: true, sortReason: "x" }} urls={new Map()} busy={false} onSortAgain={noop} onOneItem={noop} onDrop={noop} />
    <BunchBar sorting={null} found={0} listing={{ done: 0, total: 4 }} runNames={[]} undo={null} itemCount={3} readyCount={3}
      needs={null} onNeeds={null} onNext={noop} onUndo={noop} onUseOtherPrice={noop} />
    <BunchBar sorting={null} found={0} listing={null} runNames={[]} undo={{ said: "Merged.", before: [], photos: [] }} itemCount={3} readyCount={3}
      needs={null} onNeeds={null} onNext={noop} onUndo={noop} onUseOtherPrice={noop} />
  </div>,
);

describe("Sell a bunch's photos, pile and bar follow the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every word has its Spanish, and es.ts carries it", () => {
    const keys = (Object.keys(enListingParts) as (keyof typeof enListingParts)[]).filter((k) => /^lp\.(bp|br|bb)\./.test(k));
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) {
      expect(es[k], k).toBe(esListingParts[k]);
      expect(esListingParts[k], `${k} still English`).not.toBe(enListingParts[k]);
      expect([...esListingParts[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...enListingParts[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });

  it("English: the old words", () => {
    const { container } = show();
    for (const w of ["Cover", "Add photo", "2 photos not sorted yet", "Sort again", "These are one item", "Don't sell these", "Keep this page open.", "Undo", "All 3 set.", "Next: list 3 items"]) {
      expect(container.textContent, w).toContain(w);
    }
    expect(screen.getByRole("button", { name: "Choose Lamp, photo 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "See Lamp, photo 1" })).toBeTruthy();
  });

  it("Spanish: the grid, the pile and the bar", async () => {
    setLang("es");
    await ensureLangLoaded();
    const { container } = show();
    for (const w of ["Portada", "Agregar foto", "2 fotos sin ordenar todavía", "Ordenar de nuevo", "Todas son un solo artículo", "No vender estas", "Mantenga esta página abierta.", "Deshacer", "Los 3 están listos.", "Siguiente: publicar 3 artículos"]) {
      expect(container.textContent, w).toContain(w);
    }
    expect(screen.getByRole("button", { name: "Elegir Lamp, foto 2" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/Cover|Add photo|not sorted|Sort again|Keep this page|Undo|Next: list/);
  });
});
