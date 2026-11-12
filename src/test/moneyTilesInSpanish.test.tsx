/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): Home's money strip and the head of You › Money in the member's language.
 * Same money meaning, same amounts; an English member reads the old words, word for word. The source is checked by
 * spanishScreensUseDictionary (CONVERTED).
 *
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx |   if (c.at) return t(c.severalDates ? "mt.firstReaches" : "mt.reaches", { day: walletDay(c.at) }); |   if (c.at) return `Reaches your wallet ${walletDay(c.at)}`;
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx | const walletDay = (iso: string) => new Date(iso).toLocaleDateString(getLang() === "es" ? "es-US" : "en-US", | const walletDay = (iso: string) => new Date(iso).toLocaleDateString("en-US",
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx |     label: h.jobs === 1 ? t("mt.heldForOneJob") : t("mt.heldForJobs", { n: h.jobs }), |     label: `Held for ${h.jobs} jobs`,
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enMoneyTiles } from "@/lib/i18n/enMoneyTiles";
import { esMoneyTiles } from "@/lib/i18n/esMoneyTiles";
import { HomeMoneyTiles } from "@/pages/home/homeDashboard/HomeMoneyTiles";

vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));

type Money = Parameters<typeof HomeMoneyTiles>[0]["money"];
const MONEY = {
  coming: { cents: 9655, at: "2026-10-23T15:00:00Z", overdue: false, severalDates: false, hasPayoutAccount: true },
  held: { cents: 4000, jobs: 2, only: null },
} as unknown as Money;
const show = () => render(<MemoryRouter><HomeMoneyTiles money={MONEY} placement="main" /></MemoryRouter>);

describe("the money tiles follow the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every English tile word has its Spanish, and es.ts carries it", () => {
    const keys = Object.keys(enMoneyTiles) as (keyof typeof enMoneyTiles)[];
    expect(keys.length).toBeGreaterThan(12);
    for (const k of keys) {
      expect(es[k], k).toBe(esMoneyTiles[k]);
      expect(esMoneyTiles[k], `${k} still English`).not.toBe(enMoneyTiles[k]);
      // Same placeholders both ways (an amount or a date never drops out).
      expect([...esMoneyTiles[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...enMoneyTiles[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });

  it("English: the old words", () => {
    show();
    expect(screen.getByText("Coming to you")).toBeTruthy();
    expect(screen.getByText("Reaches your wallet Fri, Oct 23")).toBeTruthy();
    expect(screen.getByText("Held for 2 jobs")).toBeTruthy();
  });

  it("Spanish: the labels, the wallet day and the held tile, same amounts", async () => {
    setLang("es");
    await ensureLangLoaded();
    show();
    expect(screen.getByText("Por recibir")).toBeTruthy();
    expect(screen.getByText(/^Llega a su billetera el vie, 23 (de )?oct/)).toBeTruthy();
    expect(screen.getByText("Retenido para 2 trabajos")).toBeTruthy();
    expect(document.body.textContent).toContain("$96.55");
    expect(document.body.textContent).not.toMatch(/Coming to you|Held for|Reaches/);
  });
});
