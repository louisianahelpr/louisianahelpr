/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): Selling's small panels (the tablet "Sell an item" row, "More ways to
 * sell", "Deliver for pay") and Buying's order-group chips (Needs you · Waiting · Upcoming · Done · Cancelled) in the
 * member's language. Words in enDeclutter (decl.hv.*, decl.mv.bk.*). An English member reads the old words.
 *
 * @mutate src/components/declutter/TabletSellRow.tsx | <Link to={SELL_ONE_PATH}>{t("decl.hv.sellOne")}</Link> | <Link to={SELL_ONE_PATH}>Sell an item</Link>
 * @mutate src/components/declutter/TabletSellRow.tsx | underline-offset-2">{t("decl.hv.otherWays")}</Link> | underline-offset-2">Free, a bunch, or moving out?</Link>
 * @mutate src/components/declutter/SellChooserEntry.tsx | const ways = movingOutOn ? t("decl.hv.waysMoving") : t("decl.hv.ways"); | const ways = movingOutOn ? "A bunch at once, a moving out sale, free, or a Helpr lists it" : t("decl.hv.ways");
 * @mutate src/components/declutter/SellChooserEntry.tsx | font-semibold">{t("decl.hv.moreWays")}</span> | font-semibold">More ways to sell</span>
 * @mutate src/components/declutter/DeclutterDeliverEntry.tsx | text-sm">{t("decl.hv.deliver")}</span> | text-sm">Deliver for pay</span>
 * @mutate src/components/declutter/DeclutterDeliverEntry.tsx | muted-foreground">{t("decl.hv.deliverSub")}</span> | muted-foreground">Carry Declutter items for buyers near you</span>
 * @mutate src/components/declutter/DeclutterMineViews.tsx | bucketChips(trk.counts).map((c) => ({ ...c, label: t(`decl.mv.bk.${c.key}` as MsgKey) })) | bucketChips(trk.counts)
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enDeclutter } from "@/lib/i18n/enDeclutter";
import { esDeclutter } from "@/lib/i18n/esDeclutter";
import { ORDER_BUCKETS } from "@/components/declutter/OrderSteps";
import { TabletSellRow } from "@/components/declutter/TabletSellRow";
import { SellChooserEntry } from "@/components/declutter/SellChooserEntry";
import { DeliverEntry } from "@/components/declutter/DeclutterDeliverEntry";
import { blankComments } from "./helpers/blankNonCode";

const KEYS = ["decl.hv.sellOne", "decl.hv.otherWays", "decl.hv.ways", "decl.hv.waysMoving", "decl.hv.deliver", "decl.hv.deliverSub", ...ORDER_BUCKETS.map((b) => `decl.mv.bk.${b.key}`)] as (keyof typeof enDeclutter)[];

const text = (moving = false) => {
  cleanup();
  render(<MemoryRouter><TabletSellRow /><SellChooserEntry movingOutOn={moving} /><DeliverEntry /></MemoryRouter>);
  return document.body.textContent ?? "";
};

describe("Selling's small panels and Buying's chips follow the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every word has its Spanish, es.ts carries it, and the chips' English is ORDER_BUCKETS' word for word", () => {
    for (const k of KEYS) {
      expect(enDeclutter[k], k).toBeTruthy();
      expect(es[k], k).toBe(esDeclutter[k]);
      expect(esDeclutter[k], `${k} still English`).not.toBe(enDeclutter[k]);
    }
    for (const b of ORDER_BUCKETS) expect(enDeclutter[`decl.mv.bk.${b.key}` as keyof typeof enDeclutter]).toBe(b.label);
  });

  it("Buying's chips take their names from the dictionary", () => {
    const src = blankComments(readFileSync("src/components/declutter/DeclutterMineViews.tsx", "utf8"));
    expect(src).toMatch(/bucketChips\(trk\.counts\)\.map\(\(c\) => \(\{ \.\.\.c, label: t\(`decl\.mv\.bk\.\$\{c\.key\}` as MsgKey\) \}\)\)/);
  });

  it("English: the old words", () => {
    const en = text();
    for (const w of ["Sell an item", "Free, a bunch, or moving out?", "More ways to sell", "A bunch at once, free, or a Helpr lists it", "Deliver for pay", "Carry Declutter items for buyers near you"]) expect(en).toContain(w);
    expect(text(true)).toContain("A bunch at once, a moving out sale, free, or a Helpr lists it");
  });

  it("Spanish: every panel's words change", async () => {
    setLang("es");
    await ensureLangLoaded();
    const sp = text();
    for (const w of ["Vender un artículo", "¿Gratis, varios o por mudanza?", "Más formas de vender", "Varios a la vez, gratis, o un Helpr lo publica", "Entregar por pago", "Lleve artículos de Declutter a compradores cerca de usted"]) expect(sp).toContain(w);
    expect(sp).not.toContain("Sell an item");
    expect(text(true)).toContain("Varios a la vez, venta por mudanza, gratis, o un Helpr lo publica");
  });
});
