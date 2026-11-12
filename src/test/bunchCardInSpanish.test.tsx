/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): Sell a bunch's item card (write it for me, title, price, free, offers,
 * trades, condition, description, merge, don't sell) in the member's language. Words in enListingParts (lp.bc.*; the
 * offers/trades title and lines reuse Listing defaults' lp.ld.*). An English member reads the old words, word for word.
 *
 * @mutate src/components/declutter/DeclutterBunchCard.tsx | {rewriting ? t("lp.bc.writing") : noWords ? t("lp.bc.writeForMe") : t("lp.bc.writeAgain")} | {rewriting ? t("lp.bc.writing") : noWords ? "Write it for me" : t("lp.bc.writeAgain")}
 * @mutate src/components/declutter/DeclutterBunchCard.tsx | htmlFor={`title-${id}`}>{t("lp.bc.title")}</label> | htmlFor={`title-${id}`}>Title</label>
 * @mutate src/components/declutter/DeclutterBunchCard.tsx | {on ? t("lp.ld.offersOn") : t("lp.ld.offersOff")}</span> | {on ? "Buyers can offer a lower price, and you say yes or no." : t("lp.ld.offersOff")}</span>
 * @mutate src/components/declutter/DeclutterBunchCard.tsx | {on ? t("lp.ld.tradesOn") : t("lp.ld.tradesOff")}</span> | {on ? t("lp.ld.tradesOn") : "Off. Buyers can't offer a trade."}</span>
 * @mutate src/components/declutter/DeclutterBunchCard.tsx | onClick={onDrop}>{t("lp.bc.drop")}</Button> | onClick={onDrop}>Don't sell this</Button>
 * @mutate src/components/declutter/DeclutterBunchCard.tsx | return it.title.trim() || t("lp.b.item", { n: index + 1 }); | return it.title.trim() || `Item ${index + 1}`;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enListingParts } from "@/lib/i18n/enListingParts";
import { esListingParts } from "@/lib/i18n/esListingParts";
import { blankItem } from "@/lib/declutter/bunch";

vi.mock("@/components/declutter/DeclutterPriceHint", () => ({ default: () => null }));
const { BunchCard } = await import("@/components/declutter/DeclutterBunchCard");

const show = () => render(
  <BunchCard item={{ ...blankItem(["a"]), price: "12" }} index={2} others={[{ key: "o", name: "Lamp", photo: undefined } as never]} urls={new Map()} files={new Map()} at={null} rewriting={false}
    onChange={() => {}} onMove={() => {}} onSplit={() => {}} onRemovePhoto={() => {}} onCover={() => {}} onReorder={() => {}} canDrag={false} onAddPhotos={() => {}} onMerge={() => {}} onDrop={() => {}} onRewrite={() => {}} />,
);

describe("Sell a bunch's item card follows the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every card word has its Spanish, and es.ts carries it", () => {
    const keys = (Object.keys(enListingParts) as (keyof typeof enListingParts)[]).filter((k) => k.startsWith("lp.bc."));
    expect(keys.length).toBeGreaterThan(25);
    for (const k of keys) {
      expect(es[k], k).toBe(esListingParts[k]);
      if (k !== "lp.bc.writeAria") expect(esListingParts[k], `${k} still English`).not.toBe(enListingParts[k]);
      expect([...esListingParts[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...enListingParts[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });

  it("English: the old words", () => {
    const { container } = show();
    for (const w of ["Write it for me", "Title", "Price ($)", "Give it away free", "Accept offers", "Buyers can offer a lower price, and you say yes or no.", "Open to trades", "Off. Buyers can't offer a trade.", "Condition", "Description", "Same thing as another item?", "Don't sell this"]) {
      expect(container.textContent, w).toContain(w);
    }
    expect(screen.getByRole("button", { name: "Don't sell Item 3" })).toBeTruthy();
  });

  it("Spanish: the card's labels, switches and buttons", async () => {
    setLang("es");
    await ensureLangLoaded();
    const { container } = show();
    for (const w of ["Escríbalo por mí", "Título", "Precio ($)", "Regalarlo", "Aceptar ofertas", "Los compradores pueden ofrecer un precio más bajo", "Abierto a cambios", "Apagado. Los compradores no pueden ofrecer un cambio.", "Estado", "Descripción", "¿Es lo mismo que otro artículo?", "No vender esto"]) {
      expect(container.textContent, w).toContain(w);
    }
    expect(screen.getByRole("button", { name: "No vender Artículo 3" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/Write it|Give it away|Accept offers|Open to trades|Don't sell/);
  });
});
