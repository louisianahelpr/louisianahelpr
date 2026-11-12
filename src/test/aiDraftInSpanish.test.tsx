/**
 * F260q: the sell form's photo-tool panel (SellAiDraft.tsx SellAiDraftPanel / AiPriceLine) reads in the member's
 * language: its words come from enAiDraft/esAiDraft (one-importer panel dictionary), the summary line's category,
 * condition and size from decl.cat/cond/size by CODE (wordInLang: English readers get the tables' own words).
 * The "no item seen" line stays word for word the shared NO_ITEM_SEEN.
 *
 * @mutate src/components/declutter/SellAiDraft.tsx | {free ? t("aid.busyBodyFree") : t("aid.busyBody")} | {t("aid.busyBody")}
 * @mutate src/components/declutter/SellAiDraft.tsx | CONDITION_LABEL[d.conditionStars] && wordInLang(`decl.cond.${d.conditionStars}`, CONDITION_LABEL[d.conditionStars]), | CONDITION_LABEL[d.conditionStars],
 * @mutate src/components/declutter/SellAiDraft.tsx | SIZE_LABEL[d.deliverySize] && wordInLang(`decl.size.${d.deliverySize}`, SIZE_LABEL[d.deliverySize]), | SIZE_LABEL[d.deliverySize],
 * @mutate src/components/declutter/SellAiDraft.tsx | {oneScreen ? t("aid.hintOne") : t("aid.hintSteps")} | {t("aid.hintSteps")}
 * @mutate src/lib/i18n/inLang.ts |   return w === key ? english : w; |   return english;
 * @mutate src/lib/i18n/inLang.ts |   return w === key ? english : w; |   return w;
 * @mutate src/lib/i18n/es.ts |   ...esAiDraft, |
 */
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { enAiDraft } from "@/lib/i18n/enAiDraft";
import { esAiDraft } from "@/lib/i18n/esAiDraft";
import { englishWords } from "@/lib/i18n/enRegistry";
import { wordInLang } from "@/lib/i18n/inLang";
import { NO_ITEM_SEEN } from "@/lib/declutter/writerWarning";
import { SellAiDraftPanel } from "@/components/declutter/SellAiDraft";
import type { AiDraft } from "@/lib/declutter/api";

const draft: AiDraft = { title: "Oak dresser", description: "Six drawers.", category: "furniture", deliverySize: "large", conditionStars: 4, flagged: true, priceDollars: 40, priceReason: null };
const noop = () => {};

describe("F260q: the photo-tool panel follows the member's language", () => {
  afterEach(() => { cleanup(); __resetLangForTests(); });

  it("every key has its Spanish; the no-item line is the shared one word for word", () => {
    for (const k of Object.keys(enAiDraft) as (keyof typeof enAiDraft)[]) {
      expect(esAiDraft[k], k).toBeTruthy();
      expect(esAiDraft[k], k).not.toBe(enAiDraft[k]);
    }
    expect(enAiDraft["aid.noItem"]).toBe(NO_ITEM_SEEN);
  });

  it("English: the panel's English and the tables' own words", () => {
    render(<SellAiDraftPanel state={{ status: "done", draft }} onRun={noop} />);
    expect(screen.getByText("We wrote your listing. Check it before you post")).toBeTruthy();
    expect(screen.getByText("Furniture · Lightly used · Large: needs a truck")).toBeTruthy();
    expect(screen.getByText("Suggested price: $40")).toBeTruthy();
    expect(screen.getByText("Check it and change anything on the next steps.")).toBeTruthy();
  });

  it("Spanish not loaded yet: a code word with no Spanish gives the English, never a raw key", () => {
    const saved = englishWords["decl.cond.4"];
    delete englishWords["decl.cond.4"];
    setLang("es");
    try { expect(wordInLang("decl.cond.4", "Lightly used")).toBe("Lightly used"); } finally { if (saved) englishWords["decl.cond.4"] = saved; }
  });

  it("Spanish: every panel state, the summary line by code, the price line", async () => {
    setLang("es");
    await ensureLangLoaded();
    const { rerender } = render(<SellAiDraftPanel state={{ status: "busy" }} onRun={noop} free />);
    expect(screen.getByText(esAiDraft["aid.busy"])).toBeTruthy();
    expect(screen.getByText(esAiDraft["aid.busyBodyFree"])).toBeTruthy();
    rerender(<SellAiDraftPanel state={{ status: "done", draft }} onRun={noop} oneScreen={false} />);
    expect(screen.getByText(esAiDraft["aid.done"])).toBeTruthy();
    expect(screen.getByText(esAiDraft["aid.flagged"])).toBeTruthy();
    expect(screen.getByText(esAiDraft["aid.hintSteps"])).toBeTruthy();
    expect(screen.getByText("Precio sugerido: $40")).toBeTruthy();
    const line = document.querySelector("[data-ai-title]")?.nextElementSibling?.textContent ?? "";
    expect(line).not.toMatch(/Lightly used|Large: needs a truck|Furniture/);
    expect(line.split(" · ")).toHaveLength(3);
    rerender(<SellAiDraftPanel state={{ status: "done", draft }} onRun={noop} oneScreen />);
    expect(screen.getByText(esAiDraft["aid.hintOne"])).toBeTruthy();
    rerender(<SellAiDraftPanel state={{ status: "done", draft: { ...draft, noItem: true } }} onRun={noop} />);
    expect(screen.getByText(esAiDraft["aid.noItem"])).toBeTruthy();
    rerender(<SellAiDraftPanel state={{ status: "idle" }} onRun={noop} />);
    expect(screen.getByText(esAiDraft["aid.idle"])).toBeTruthy();
    expect(screen.getByText(esAiDraft["aid.write"])).toBeTruthy();
    rerender(<SellAiDraftPanel state={{ status: "error", message: "x" }} onRun={noop} />);
    expect(screen.getByText(esAiDraft["aid.tryAgain"])).toBeTruthy();
  });
});
