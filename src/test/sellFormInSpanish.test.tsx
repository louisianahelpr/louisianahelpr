/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): the new-listing sell screen in the member's language. SellOneScreen's
 * own words (titles, what blocks Post, the photo trouble box, the progress view, Post it), the parts of SellFormParts
 * it shows (price box steppers, "You get if it sells today", the free note, Accept offers, the tax box head) and the
 * trades switch come from enSellForm.ts / esSellForm.ts. An English member reads the old words, word for word.
 * Not yet: formProblem's own messages (sellForm.ts; SellOneScreen routes them by matching English words), the tax
 * statements (TaxStatementsCheck), the saved draft's step form (DeclutterSellView) and the post steps.
 *
 * @mutate src/components/declutter/SellTradesRow.tsx | >{t("sf.tradesTitle")}< | >Open to trades?<
 * @mutate src/components/declutter/SellFormParts.tsx | >{t(offersWanted ? "sf.offersOn" : "sf.offersOff")}</span> | >{offersWanted ? "Buyers can offer a lower price, and you say yes or no." : "Off. Buyers pay your price with Buy now; no offers."}</span>
 * @mutate src/components/declutter/SellFormParts.tsx |       {t("sf.youGet")}\n |       You get if it sells today\n
 * @mutate src/components/declutter/SellOneScreen.tsx | >{tr("sf.stillWriting")}</p> | >Still writing your listing. It posts when that's done.</p>
 * @mutate src/components/declutter/SellOneScreen.tsx | out.push({ message: tr("sf.tickBox"), at: "tax" }); | out.push({ message: "Tick the box about this item before you list it.", at: "tax" });
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enSellForm } from "@/lib/i18n/enSellForm";
import { esSellForm } from "@/lib/i18n/esSellForm";
import { OFFERS_TITLE, offersSettingLine } from "@/lib/declutter/offersOnPost";

vi.mock("@/components/declutter/useSellerSetupFee", () => ({ useSellerSetupFee: () => ({ unknown: false, server: false, orderId: null, cents: 0 }) }));

const { SellTradesRow } = await import("@/components/declutter/SellTradesRow");
const { SellFreeNote, SellOffersToggle, SellTaxBox, SellPriceInput, SellYouGet } = await import("@/components/declutter/SellFormParts");

type S = Parameters<typeof SellPriceInput>[0]["s"];
const flow = (free = false) => ({
  form: { free, price: "20" },
  priceCents: 2000,
  set: vi.fn(),
  offersWanted: true,
  setOffersWanted: vi.fn(),
  tradesWanted: false,
  setTradesWanted: vi.fn(),
  attested: false,
  setAttested: vi.fn(),
}) as unknown as S;

const show = () => render(
  <div>
    <ul><SellTradesRow s={flow()} /></ul>
    <SellPriceInput s={flow()} />
    <SellYouGet priceCents={2000} />
    <SellFreeNote />
    <SellOffersToggle s={flow()} />
    <SellTaxBox s={flow()} />
  </div>,
);

describe("the sell screen follows the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every English word has its Spanish, es.ts carries it, and the Accept offers words match Settings'", () => {
    const keys = Object.keys(enSellForm) as (keyof typeof enSellForm)[];
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) {
      expect(es[k], k).toBe(esSellForm[k]);
      expect(esSellForm[k], `${k} still English`).not.toBe(enSellForm[k]);
      expect([...esSellForm[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...enSellForm[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
    // Settings and Sell a bunch still say it from offersOnPost: the sell form says it the same way.
    expect(enSellForm["sf.offersTitle"]).toBe(OFFERS_TITLE);
    expect(enSellForm["sf.offersOn"]).toBe(offersSettingLine(true));
    expect(enSellForm["sf.offersOff"]).toBe(offersSettingLine(false));
  });

  it("English: the old words", () => {
    show();
    expect(screen.getByRole("switch", { name: /Open to trades\?/ })).toBeTruthy();
    expect(screen.getByText("You get if it sells today")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lower the price by $1" })).toBeTruthy();
    expect(screen.getByText(/^Free items are claimed, not bought/)).toBeTruthy();
    expect(screen.getByText("Buyers can offer a lower price, and you say yes or no.")).toBeTruthy();
    expect(screen.getByText("Confirm about this item")).toBeTruthy();
  });

  it("Spanish: the trades switch, price box, You get, free note, Accept offers and tax head, same amount", async () => {
    setLang("es");
    await ensureLangLoaded();
    show();
    expect(screen.getByRole("switch", { name: /¿Acepta intercambios\?/ })).toBeTruthy();
    expect(screen.getByText("Usted recibe si se vende hoy")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bajar el precio $1" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Precio" })).toBeTruthy();
    expect(screen.getByText(/^Los artículos gratis se piden/)).toBeTruthy();
    expect(screen.getByText("Aceptar ofertas")).toBeTruthy();
    expect(screen.getByText(/^Los compradores pueden ofrecer un precio más bajo/)).toBeTruthy();
    expect(screen.getByText("Confirme sobre este artículo")).toBeTruthy();
    expect(document.body.textContent).toMatch(/\$20(\.00)?/);
    expect(document.body.textContent).not.toMatch(/Open to trades|You get if|Free items|Accept offers|Confirm about/);
  });

  it("the sell screen writes none of its dictionary's English in its source", () => {
    const code = (f: string) => blankComments(readFileSync(f, "utf8"));
    // SellFormParts also holds the saved draft's step form (not converted yet: "Give it away free"), so only its sell
    // screen parts' words are checked there.
    const parts = ["sf.youGet", "sf.lower", "sf.raise", "sf.freeNote", "sf.offersOn", "sf.offersOff", "sf.taxHead", "sf.taxLine"] as const;
    const files: [string, readonly string[]][] = [
      ["src/components/declutter/SellOneScreen.tsx", Object.values(enSellForm)],
      ["src/components/declutter/SellTradesRow.tsx", Object.values(enSellForm)],
      ["src/components/declutter/SellFormParts.tsx", parts.map((k) => enSellForm[k])],
    ];
    for (const [f, words] of files) {
      const text = code(f);
      expect(text, f).toContain('import "@/lib/i18n/enSellForm";');
      for (const english of words) {
        if (english.length < 12 || english.includes("{")) continue;
        expect(text.includes(english), `${f} still writes "${english}"`).toBe(false);
      }
    }
  });
});
