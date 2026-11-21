/**
 * Audit 11-20 night Low 6: Declutter's payout words in the member's language. The "Set up payouts" link beside the
 * seller's payout line matched an English pattern, so a Spanish line would have lost its way to the payout settings;
 * the line and the link now ask the same dictionary. English stays word for word (sellerCardYouGetPaidOn,
 * payoutWords.test, sellerPayoutPrompt.test).
 *
 * @mutate src/components/declutter/declutterPayoutWords.ts |     const [before, after] = t(key, { gets: "\u0000" }).split("\u0000"); |     const [before, after] = englishWords[key].split("{gets}");
 * @mutate src/components/declutter/declutterPayoutWords.ts |   if (ctx.payoutReady === false) return t(ctx.setupPaused === false ? "dpo.onceSetup" : "dpo.onceReady", { gets }); |   if (ctx.payoutReady === false) return ctx.setupPaused === false ? `${gets} once you set up payouts in Settings.` : `${gets} once your payout account is ready.`;
 * @mutate src/lib/declutter/timeLeft.ts |   return new Date(iso).toLocaleDateString(locale(), { timeZone: CENTRAL, weekday: "short", month: "short", day: "numeric" }); |   return new Date(iso).toLocaleDateString("en-US", { timeZone: CENTRAL, weekday: "short", month: "short", day: "numeric" });
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({ block: "none" as string }));
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupBlock: () => h.block }));

import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enDeclPayout } from "@/lib/i18n/enDeclPayout";
import { esDeclPayout } from "@/lib/i18n/esDeclPayout";
import type { MyPayout } from "@/lib/declutter/handover";
import { payoutLine, payoutLineWaitsOnSetup } from "@/components/declutter/declutterPayoutWords";
import { PayoutLineText, FailedPayoutLink } from "@/components/declutter/FailedPayoutLink";
import { soldWords } from "@/components/declutter/SellerPayoutPrompt";
import { payoutStatusWords } from "@/lib/declutter/payoutWords";

const row = (over: Partial<MyPayout> = {}): MyPayout => ({
  order_id: "o1", items_cents: 4500, delivery_cents: 0, refunded_cents: 0, debt_cents: 0, amount_cents: 4500, status: "pending", executed_at: null, attempts: 0, ...over,
} as MyPayout);
const HANDED = "2026-11-10T18:00:00Z";
const NOW = Date.parse("2026-11-10T19:00:00Z");
const WAITS = { handedOverAt: HANDED, now: NOW, payoutReady: false, setupPaused: false } as const;

async function spanish() {
  __resetLangForTests();
  setLang("es");
  await ensureLangLoaded();
}

describe("Declutter payout words follow the member's language (audit 11-20 night Low 6)", () => {
  afterEach(() => {
    cleanup();
    h.block = "none";
    __resetLangForTests();
  });

  it("every English payout word has its Spanish, and es.ts carries it", () => {
    const keys = Object.keys(enDeclPayout) as (keyof typeof enDeclPayout)[];
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) {
      expect(es[k], k).toBe(esDeclPayout[k]);
      expect(esDeclPayout[k], `${k} still English`).not.toBe(enDeclPayout[k]);
      // The same {names} on both sides, so no value is dropped in Spanish.
      expect((esDeclPayout[k].match(/\{\w+\}/g) ?? []).sort(), k).toEqual((enDeclPayout[k].match(/\{\w+\}/g) ?? []).sort());
    }
  });

  it("English: the line that waits on setup is told apart from every other line", () => {
    expect(payoutLineWaitsOnSetup(payoutLine(row(), false, WAITS))).toBe(true);
    expect(payoutLineWaitsOnSetup(payoutLine(row(), false, { ...WAITS, setupPaused: true }))).toBe(true);
    const others = [
      payoutLine(row(), false, { handedOverAt: HANDED, now: NOW }),
      payoutLine(row(), true, { handedOverAt: HANDED, now: NOW }),
      payoutLine(row(), false, { handedOverAt: HANDED, now: NOW, refundOpen: true }),
      payoutLine(row({ status: "succeeded", executed_at: HANDED }), false),
      payoutLine(row({ status: "failed" }), false),
      payoutLine(row(), false, {}),
    ];
    expect(new Set(others).size).toBe(others.length);
    for (const o of others) expect(payoutLineWaitsOnSetup(o), o).toBe(false);
  });

  it("Spanish: the payout line reads in Spanish and still links to the payout settings", async () => {
    await spanish();
    const line = payoutLine(row(), false, WAITS);
    expect(line).toBe("Recibe $45 cuando configure los pagos en Ajustes.");
    expect(payoutLineWaitsOnSetup(line)).toBe(true);
    render(<MemoryRouter><p><PayoutLineText line={line} /></p></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Configurar pagos" }).getAttribute("href")).toBe("/profile?tab=payment");
    cleanup();
    const paid = payoutLine(row(), false, { handedOverAt: HANDED, now: NOW });
    expect(paid).toMatch(/^Recibe \$45, que se paga el .+, salvo que el comprador pida un reembolso\.$/);
    expect(paid).not.toMatch(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Nov)\b/);
    render(<MemoryRouter><p><PayoutLineText line={paid} /></p></MemoryRouter>);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("Spanish: status words, the breakdown, the failed-payout link and the sold list", async () => {
    await spanish();
    expect(payoutStatusWords(row({ status: "succeeded" }))).toBe("Enviado a su cuenta de pagos. Los bancos suelen mostrarlo en 2 días hábiles.");
    expect(payoutLine(row({ delivery_cents: 500, amount_cents: 5000 }), true, { handedOverAt: HANDED, now: NOW }))
      .toBe("Recibe $50 ($45 + $5 de entrega). Queda retenido mientras Louisiana Helpr revisa el problema.");
    expect(payoutLine(row({ refunded_cents: 2000, amount_cents: 2500 }), false, { handedOverAt: HANDED, now: NOW, refundOpen: true }))
      .toBe("Recibe $25 después del reembolso de $20. Espera hasta que se resuelva la solicitud de reembolso.");
    render(<MemoryRouter><p><FailedPayoutLink /></p></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Revise sus pagos" })).toBeTruthy();
    expect(soldWords(["Silla", "Taza"])).toBe("Silla y Taza");
    expect(soldWords(["A", "B", "C", "D"])).toBe("A, B y 2 más");
  });
});
