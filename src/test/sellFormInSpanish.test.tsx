/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): the new-listing sell screen in the member's language. SellOneScreen's
 * own words (titles, what blocks Post, the photo trouble box, the progress view, Post it), the parts of SellFormParts
 * it shows (price box steppers, "You get if it sells today", the free note, Accept offers, the tax box head) and the
 * trades switch come from enSellForm.ts / esSellForm.ts. An English member reads the old words, word for word.
 * formProblem's messages come from codes (sellForm.ts formProblemCode, "sf.fp.*"); the row Post marks and the price
 * step's check key off the code, never the words (a Spanish message used to land every problem on Settings).
 * Not yet: the tax statements (TaxStatementsCheck), the saved draft's step form (DeclutterSellView) and the post steps.
 *
 * @mutate src/components/declutter/SellTradesRow.tsx | >{t("sf.tradesTitle")}< | >Open to trades?<
 * @mutate src/components/declutter/SellFormParts.tsx | >{t(offersWanted ? "sf.offersOn" : "sf.offersOff")}</span> | >{offersWanted ? "Buyers can offer a lower price, and you say yes or no." : "Off. Buyers pay your price with Buy now; no offers."}</span>
 * @mutate src/components/declutter/SellFormParts.tsx |       {t("sf.youGet")}\n |       You get if it sells today\n
 * @mutate src/components/declutter/CategoryDrillDown.tsx | const headingWords = (h: CategoryGroupHeading) => t(HEADING_KEY[h]); | const headingWords = (h: CategoryGroupHeading) => h;
 * @mutate src/components/declutter/CategoryDrillDown.tsx | const catWords = (k: string) => (CATEGORY_LABEL[k] ? t(`decl.cat.${k}` as MsgKey) : k); | const catWords = (k: string) => CATEGORY_LABEL[k] ?? k;
 * @mutate src/components/declutter/CategoryDrillDown.tsx |   return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() |   return s.toLowerCase()
 * @mutate src/components/declutter/SellOneScreen.tsx | >{tr("sf.stillWriting")}</p> | >Still writing your listing. It posts when that's done.</p>
 * @mutate src/components/declutter/sellForm.ts | export const formProblemWords = (code: FormProblemCode): string => tr(`sf.fp.${code}` as MsgKey); | export const formProblemWords = (code: FormProblemCode): string => String(code);
 * @mutate src/components/declutter/sellForm.ts |   if (code === "price" \|\| code === "floor" \|\| code === "dropPct") return "price"; |   if (code === "price") return "price";
 * @mutate src/components/declutter/sellForm.ts | if (step === 3) return code && problemRow(code) === "price" ? formProblemWords(code) : null; | if (step === 3) return code && /price/i.test(formProblemWords(code)) ? formProblemWords(code) : null;
 * @mutate src/components/declutter/useSellFlowState.ts |   const postStage = postStepOf(postStepAt?.key ?? null); |   const postStage = postStepOf(null);
 * @mutate src/components/declutter/SellOneScreen.tsx | step: s.postStage | step: "photos" as const
 * @mutate src/components/declutter/SellOneScreen.tsx | const at: Where = problemRow(code); | const at: Where = /name/i.test(formProblemWords(code)) ? "title" : /price\|lowest\|drops/i.test(formProblemWords(code)) ? "price" : "settings";
 * @mutate src/components/declutter/SellOneScreen.tsx | out.push({ message: tr("sf.tickBox"), at: "tax" }); | out.push({ message: "Tick the box about this item before you list it.", at: "tax" });
 * @mutate src/components/declutter/useSellFlowState.ts | toast.error(tr("sf.t.maxPhotos")); | toast.error("A listing can have up to 12 photos.");
 * @mutate src/components/declutter/useSellFlowState.ts | toast(tr("sf.t.sentAt", { price: formatPrice(out.cents) })); | toast(`Listed and sent at ${formatPrice(out.cents)}. They have 48 hours to accept.`);
 * @mutate src/components/declutter/useSellFlowState.ts |         ? tr("sf.t.whereKeepUp") |         ? 'You can turn on "Keep it up" from Manage listing.'
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { setLang, ensureLangLoaded, __resetLangForTests, t as tr } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enSellForm } from "@/lib/i18n/enSellForm";
import { esSellForm } from "@/lib/i18n/esSellForm";
import { OFFERS_TITLE, offersSettingLine } from "@/lib/declutter/offersOnPost";
import { fireEvent } from "@testing-library/react";
import { CATEGORY_GROUPS } from "@/lib/declutter/categoryIcons";
import { formProblem, formProblemCode, problemRow, sellStepProblem, type FormState } from "@/components/declutter/sellForm";

vi.mock("@/components/declutter/useSellerSetupFee", () => ({ useSellerSetupFee: () => ({ unknown: false, server: false, orderId: null, cents: 0 }) }));

const { SellTradesRow } = await import("@/components/declutter/SellTradesRow");
const { CategoryDrillDown } = await import("@/components/declutter/CategoryDrillDown");
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

  it("Spanish: the category drill-down's headings, categories, search (accents optional) and chosen line", async () => {
    setLang("es");
    await ensureLangLoaded();
    const onChange = vi.fn();
    const { container } = render(<CategoryDrillDown label="Categoría" groups={CATEGORY_GROUPS} value="kitchen" onChange={onChange} />);
    expect(screen.getByRole("searchbox", { name: "Buscar categorías" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hogar, Cocina elegida" })).toBeTruthy();
    expect(screen.getByText("Elegida: Cocina")).toBeTruthy();
    expect(screen.getByText("Pasatiempos y diversión")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar categorías" }), { target: { value: "jardin" } });
    const leaf = container.querySelector('[data-category-leaf="outdoor_garden"]');
    expect(leaf?.textContent).toBe("Exterior y jardínAire libre");
    // The English words still find it.
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar categorías" }), { target: { value: "garden" } });
    expect(container.querySelector('[data-category-leaf="outdoor_garden"]')).not.toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar categorías" }), { target: { value: "zzqx" } });
    expect(screen.getByRole("status").textContent).toBe('Ninguna categoría coincide con "zzqx". Elija Otro en Más, o sugiera una abajo.');
    expect(container.textContent).not.toMatch(/Search categories|Chosen:|Hobbies/);
  });

  it("the sell screen writes none of its dictionary's English in its source", () => {
    const code = (f: string) => blankComments(readFileSync(f, "utf8"));
    // SellFormParts: the sell screen's parts and the saved draft's step parts (free box, drops card, ways words); the
    // words it shares with other screens (FieldLabel callers, DROPS_SWITCH_LABEL) are not in this list.
    const parts = ["sf.youGet", "sf.lower", "sf.raise", "sf.freeNote", "sf.offersOn", "sf.offersOff", "sf.taxHead", "sf.taxLine", "sf.ds.giveFree", "sf.dr.tooLow", "sf.dr.off", "sf.dr.howMuch", "sf.dr.onlyYou", "sf.wy.privFreePlaces", "sf.wy.privPlaces", "sf.wy.privFree", "sf.wy.priv", "sf.wy.timesHead", "sf.wy.timesPlaces", "sf.wy.timesFreePlaces", "sf.wy.times"] as const;
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

describe("the sell form's problems follow the member's language and mark their row by code (F260q)", () => {
  afterEach(() => __resetLangForTests());
  const ok = { title: "Oak chair", description: "", category: "furniture", conditionStars: 4, deliverySize: "large", price: "40", floor: "20", drops: true, dropPct: 5, free: false, areaLabel: "Mid-City", pickupAddress: "1234 Example St, Baton Rouge" } as unknown as FormState;

  it("each code has its row: name and the writer's note on the title, price/lowest/step on the price, the rest on Settings", () => {
    expect(formProblemCode({ ...ok, title: "ab" })).toBe("name");
    expect(formProblemCode({ ...ok, title: "Item photo unclear - please retake photos" })).toBe("writerNote");
    expect(formProblemCode({ ...ok, price: "" })).toBe("price");
    expect(formProblemCode({ ...ok, floor: "50" })).toBe("floor");
    expect(formProblemCode({ ...ok, dropPct: 7 })).toBe("dropPct");
    expect(formProblemCode({ ...ok, pickupAddress: "" })).toBe("address");
    expect(formProblemCode({ ...ok, areaLabel: "1234 Example St" })).toBe("city");
    expect(["name", "writerNote", "price", "floor", "dropPct", "address", "city"].map((c) => problemRow(c as never))).toEqual(
      ["title", "title", "price", "price", "price", "settings", "settings"],
    );
  });

  it("English: the old words, word for word", () => {
    expect(formProblem({ ...ok, floor: "50" })).toBe("Set your lowest price: at least $1 and below your price. Or turn price drops off.");
    expect(formProblem({ ...ok, title: "ab" })).toBe("Give the item a name of at least 3 characters.");
    expect(sellStepProblem(3, { ...ok, dropPct: 7 }, 3)).toBe("Pick how much the price drops each evening.");
  });

  it("Spanish: every problem in Spanish, and the price step still stops on a price problem only", async () => {
    setLang("es");
    await ensureLangLoaded();
    expect(formProblem({ ...ok, price: "" })).toBe("Ponga un precio entre $1 y $1,000.");
    expect(formProblem({ ...ok, areaLabel: "1234 Example St" })).toMatch(/^No pudimos saber la ciudad/);
    expect(sellStepProblem(2, { ...ok, title: "ab" }, 3)).toMatch(/^Póngale al artículo un nombre/);
    expect(sellStepProblem(3, { ...ok, floor: "50" }, 3)).toMatch(/^Ponga su precio más bajo/);
    expect(sellStepProblem(3, { ...ok, dropPct: 7 }, 3)).toBe("Elija cuánto baja el precio cada tarde.");
    expect(sellStepProblem(3, { ...ok, pickupAddress: "" }, 3)).toBeNull();
    expect(sellStepProblem(4, { ...ok, pickupAddress: "" }, 3)).toMatch(/^Agregue la dirección de recogida/);
  });

  it("SellOneScreen marks the row from the code, not by reading the words", () => {
    const text = blankComments(readFileSync("src/components/declutter/SellOneScreen.tsx", "utf8"));
    expect(text).toContain("const at: Where = problemRow(code);");
    expect(text).not.toMatch(/\/name\/i\.test|\/price\|/);
  });
});

describe("the posting progress keys off the step, not its words (F260q)", () => {
  afterEach(() => __resetLangForTests());
  it("the step is a key: its words follow the language and the progress row reads the key", async () => {
    const hook = blankComments(readFileSync("src/components/declutter/useSellFlowState.ts", "utf8"));
    expect(hook).toContain("const postStage = postStepOf(postStepAt?.key ?? null);");
    expect(hook).not.toMatch(/setPostStep\(\s*["`]/);
    const screenSrc = blankComments(readFileSync("src/components/declutter/SellOneScreen.tsx", "utf8"));
    expect(screenSrc).toContain("step: s.postStage");
    setLang("es");
    await ensureLangLoaded();
    expect(tr("sf.ps.adding", { n: 1, total: 2 })).toBe("Agregando la foto 1 de 2");
    expect(tr("sf.ps.puttingUp")).toBe("Publicándolo");
  });
});

describe("the sell flow's toasts follow the member's language (F260q)", () => {
  // Every toast the sell flow raises says its words through t(): a literal sentence in a toast() call is English for a
  // Spanish member. (Error text from declutterErrorMessage is the server's mapped words, not a literal here.)
  it("useSellFlowState has no literal sentence in a toast, and the toast words have Spanish", () => {
    const src = blankComments(readFileSync("src/components/declutter/useSellFlowState.ts", "utf8"));
    const calls = src.match(/toast(?:\.error)?\(([^;]*)\);/g) ?? [];
    expect(calls.length).toBeGreaterThan(8);
    for (const c of calls) expect(c, c).not.toMatch(/["'`][A-Z][^"'`]*\s[^"'`]*[.?]["'`]/);
    const where = src.match(/const where = [\s\S]*?;\n/)?.[0] ?? "";
    expect(where).toContain('tr("sf.t.whereKeepUp")');
    expect(where).not.toMatch(/"You can/);
    for (const k of ["sf.t.priceRange", "sf.t.maxPhotos", "sf.t.sentAt", "sf.t.checking", "sf.t.answerFailed"] as const) {
      expect(esSellForm[k], k).toBeTruthy();
      expect(esSellForm[k], k).not.toBe(enSellForm[k]);
    }
    expect(enSellForm["sf.t.sentAt"]).toBe("Listed and sent at {price}. They have 48 hours to accept.");
  });
});
