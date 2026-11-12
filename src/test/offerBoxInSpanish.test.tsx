/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"; written 2026-11-12): the offer box's last English words in the member's language: the
 * "At most, <with pickup>" ceiling line, the no-delivery total phrases (pickupWords.ts: "with porch pickup", "for a
 * safe meetup", "before delivery") and the "Offer sent" what-next sheet. Same amounts; English reads the old words.
 * Not yet: DeclutterOffersSection (Buying/Selling's offer rows and accept sheets).
 *
 * @mutate src/lib/declutter/pickupWords.ts | return t(way === "porch" ? "decl.for.porch" : way === "meetup" ? "decl.for.meetup" : way === "none" ? "decl.for.none" : "decl.for.pickup"); | return way === "meetup" ? "for a safe meetup" : "for pickup";
 * @mutate src/components/declutter/OfferSentWhatNext.tsx | label: t("osw.ifAccepts"), detail: <>{t("osw.checkout")} <BuyerTotal | label: "If the seller accepts", detail: <>You have 24 hours to check out: <BuyerTotal
 * @mutate src/components/declutter/OfferSentWhatNext.tsx | primary={{ label: t("osw.gotIt"), acknowledge: true }} | primary={{ label: "Got it", acknowledge: true }}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { forPhrase, totalPhrase } from "@/lib/declutter/pickupWords";
import { OfferSentWhatNext } from "@/components/declutter/OfferSentWhatNext";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => 0, useFirstPayoutFeeKnown: () => true }));

const sheet = () => render(<OfferSentWhatNext cents={5000} onClose={() => {}} onBrowse={() => {}} way="meetup" />);

describe("the offer box follows the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every offer-box word has its Spanish with the same placeholders", () => {
    const keys = (Object.keys(en) as (keyof typeof en)[]).filter((k) => /^osw\.|^offer\.atMost$|^decl\.(total|for)\./.test(k));
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) {
      expect(es[k], `${k} still English`).not.toBe(en[k]);
      expect([...es[k].matchAll(/\{\w+\}/g)].map((m) => m[0]), k).toEqual([...en[k].matchAll(/\{\w+\}/g)].map((m) => m[0]));
    }
  });

  it("English: the old words", () => {
    expect(totalPhrase("porch")).toBe("with porch pickup");
    expect(forPhrase("meetup")).toBe("for a safe meetup");
    sheet();
    const steps = within(screen.getByTestId("what-next-sheet")).getAllByRole("listitem");
    expect(steps[2].textContent).toContain("You have 24 hours to check out: $53.20 for a safe meetup");
    expect(screen.getByRole("button", { name: "Got it" })).toBeTruthy();
  });

  it("Spanish: the phrases, the sheet's steps and buttons, same total", async () => {
    setLang("es");
    await ensureLangLoaded();
    expect(totalPhrase("porch")).toBe("con recogida en el porche");
    expect(totalPhrase("none")).toBe("antes del envío");
    expect(es["offer.atMost"].replace("{phrase}", totalPhrase("pickup"))).toBe("Como máximo, con recogida. Una bajada de precio o más artículos de este vendedor lo hacen menor.");
    sheet();
    const box = screen.getByTestId("what-next-sheet");
    const steps = within(box).getAllByRole("listitem");
    expect(steps[0].textContent).toContain("Usted ofreció $50");
    expect(steps[2].textContent).toContain("Tiene 24 horas para pagar: $53.20 para un encuentro seguro");
    expect(steps[3].textContent).toContain("Encuéntrense en el lugar seguro");
    expect(screen.getByRole("button", { name: "Entendido" })).toBeTruthy();
    expect(box.textContent).not.toMatch(/You offered|check out|Got it|for a safe/);
  });
});
