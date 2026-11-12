/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): Sell a bunch's moving sale card, its intro lines, the setup fee gate
 * and "What happened" after listing, in the member's language. Words in enListingParts (lp.mv.*, lp.rs.*, lp.fg.*,
 * lp.bv.intro). An English member reads the old words, word for word.
 *
 * @mutate src/components/declutter/DeclutterBunchMovingSale.tsx | className="text-base font-semibold">{t("lp.mv.head")}</h2> | className="text-base font-semibold">Your move</h2>
 * @mutate src/components/declutter/DeclutterBunchMovingSale.tsx | <p className="text-sm text-muted-foreground">{t("lp.mv.help")}</p> | <p className="text-sm text-muted-foreground">Need a hand carrying things out? Hire a Helpr for the job.</p>
 * @mutate src/components/declutter/DeclutterBunchMovingSale.tsx | (moving ? t("lp.mv.intro") : t("lp.bv.intro")) | (moving ? "Moving? List everything at once." : t("lp.bv.intro"))
 * @mutate src/components/declutter/DeclutterBunchResults.tsx | focus:outline-none">{t("lp.rs.head")}</h2> | focus:outline-none">What happened</h2>
 * @mutate src/components/declutter/DeclutterBunchResults.tsx | onClick={onListMore}>{t("lp.rs.listMore")}</Button> | onClick={onListMore}>List more</Button>
 * @mutate src/components/declutter/DeclutterBunchResults.tsx | review > 0 ? t("lp.rs.checking", { n: review }) : null | review > 0 ? `${review} being checked` : null
 * @mutate src/components/declutter/DeclutterBunchResults.tsx | {t("lp.rs.stays")}{" "} | It's still on the list.{" "}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enListingParts } from "@/lib/i18n/enListingParts";
import { esListingParts } from "@/lib/i18n/esListingParts";

vi.mock("@/lib/declutter/moves", () => ({
  fetchMyMoveItems: vi.fn(async () => []),
  fetchMyMoveOutDate: vi.fn(async () => null),
  formatMoveDate: (d: string) => d,
  moveDateProblem: () => null,
  setMoveOutDate: vi.fn(),
}));
vi.mock("@/components/declutter/DeclutterMovingSaleDetails", () => ({ MovingSaleDetails: () => null }));
vi.mock("@/lib/nativeShare", () => ({ shareNative: vi.fn() }));

const { BunchMovingSale, bunchIntro } = await import("@/components/declutter/DeclutterBunchMovingSale");
const { BunchResults } = await import("@/components/declutter/DeclutterBunchResults");

const show = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BunchMovingSale userId="u1" date="" setDate={() => {}} today="2026-11-12" />
        <BunchResults userId="u1" inSale={false} onFix={() => {}} onListMore={() => {}}
          results={[{ key: "a", title: "Lamp", status: "live", id: "i1" }, { key: "b", title: "Rug", status: "pending_review", id: "i2" }, { key: "c", title: "Desk", error: new Error("x"), draftId: null, stays: true }]} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("Sell a bunch's moving sale, fee gate and results follow the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every word has its Spanish, and es.ts carries it", () => {
    const keys = (Object.keys(enListingParts) as (keyof typeof enListingParts)[]).filter((k) => /^lp\.(mv|rs|fg)\./.test(k) || k === "lp.bv.intro");
    expect(keys.length).toBeGreaterThan(50);
    for (const k of keys) {
      expect(es[k], k).toBe(esListingParts[k]);
      expect(esListingParts[k], `${k} still English`).not.toBe(enListingParts[k]);
      expect([...esListingParts[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...enListingParts[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });

  it("English: the old words", () => {
    const { container } = show();
    for (const w of ["Your move", "Move-out date", "Hire a Helpr for moving day", "Haul away what's left", "What happened", "wasn't listed:", "It's still on the list.", "1 for sale, 1 being checked.", "(being checked)", "List more", "See your listings"]) {
      expect(container.textContent, w).toContain(w);
    }
    expect(bunchIntro(false)).toBe("Add photos of everything. We'll group them and write each listing.");
  });

  it("Spanish: the moving card, the intros and the results", async () => {
    setLang("es");
    await ensureLangLoaded();
    const { container } = show();
    for (const w of ["Su mudanza", "Fecha de mudanza", "Contratar a un Helpr para el día de la mudanza", "Llevarse lo que quede", "Qué pasó", "no se publicó:", "Sigue en la lista.", "1 a la venta, 1 en revisión.", "(en revisión)", "Publicar más", "Ver sus publicaciones"]) {
      expect(container.textContent, w).toContain(w);
    }
    expect(bunchIntro(true)).toMatch(/^¿Se muda\?/);
    expect(container.textContent).not.toMatch(/Your move|Hire a Helpr|What happened|being checked|List more|See your/);
  });
});
