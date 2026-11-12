/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): Sell a bunch's "Your saved drafts" card (the count line, the tick
 * reminder, the list button, what was listed) in the member's language. Words in enListingParts (lp.dr.*).
 *
 * @mutate src/components/declutter/BunchDraftsSection.tsx | className="text-base font-semibold">{t("lp.dr.head")}</h2> | className="text-base font-semibold">Your saved drafts</h2>
 * @mutate src/components/declutter/BunchDraftsSection.tsx | {t("lp.dr.together")} {t(listStepShown | List them together, or finish each one under Selling. {t(listStepShown
 * @mutate src/components/declutter/BunchDraftsSection.tsx | (feeDue ? t("lp.dr.listFree") : t("lp.dr.listAll")) | (feeDue ? t("lp.dr.listFree") : "List all my drafts")
 * @mutate src/components/declutter/BunchDraftsSection.tsx | setProblem(listStepShown ? t("lp.dr.tickBelow") : t("lp.dr.tick")); | setProblem(listStepShown ? t("lp.dr.tickBelow") : "Tick the box under the four statements before you list your drafts.");
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enListingParts } from "@/lib/i18n/enListingParts";
import { esListingParts } from "@/lib/i18n/esListingParts";

vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<object>()),
  fetchMyItems: async () => [{ id: "d1", title: "Lamp", status: "draft", current_price_cents: 500 }, { id: "d2", title: "Rug", status: "draft", current_price_cents: 900 }],
  fetchPhotos: async (ids: string[]) => ids.map((id) => ({ item_id: id })),
}));
vi.mock("@/components/declutter/declutterUi", async (orig) => ({ ...(await orig<object>()), TaxStatementsCheck: () => null }));

const { BunchDraftsSection } = await import("@/components/declutter/BunchDraftsSection");

const show = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BunchDraftsSection userId="u1" exclude={new Set()} busy={false} feeDue={false} onBusy={() => {}} attested={false} setAttested={() => {}} listStepShown={false} onPricedOffered={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("Sell a bunch's saved drafts card follows the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every word has its Spanish, and es.ts carries it", () => {
    const keys = (Object.keys(enListingParts) as (keyof typeof enListingParts)[]).filter((k) => k.startsWith("lp.dr."));
    expect(keys.length).toBeGreaterThan(15);
    for (const k of keys) {
      expect(es[k], k).toBe(esListingParts[k]);
      expect(esListingParts[k], `${k} still English`).not.toBe(enListingParts[k]);
      expect([...esListingParts[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...enListingParts[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });

  it("English: the old words", async () => {
    const { container } = show();
    const button = await screen.findByRole("button", { name: "List all my drafts" });
    expect(container.textContent).toContain("Your saved drafts");
    expect(container.textContent).toContain("You have 2 unfinished listings. List them together, or finish each one under Selling. One tick counts for every draft you list now.");
    fireEvent.click(button);
    expect(screen.getByRole("alert").textContent).toBe("Tick the box under the four statements before you list your drafts.");
  });

  it("Spanish: the card, the button and the tick reminder", async () => {
    setLang("es");
    await ensureLangLoaded();
    const { container } = show();
    const button = await screen.findByRole("button", { name: "Publicar todos mis borradores" });
    expect(container.textContent).toContain("Sus borradores guardados");
    expect(container.textContent).toContain("Tiene 2 publicaciones sin terminar. Publíquelas juntas, o termine cada una en Vendiendo.");
    fireEvent.click(button);
    expect(screen.getByRole("alert").textContent).toBe("Marque la casilla debajo de las cuatro declaraciones antes de publicar sus borradores.");
    expect(container.textContent).not.toMatch(/saved drafts|unfinished|List them|Tick the box/);
  });
});
