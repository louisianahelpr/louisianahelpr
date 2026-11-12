/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): Sell a bunch's per-item problem, the "1 needs a name" line and the
 * sorting/listing progress lines (lib/declutter/bunch.ts) in the member's language. Words in enListingParts (lp.bq.*).
 * The screen keys off a problem code, never the words, so a Spanish reader still lands on the right field.
 *
 * @mutate src/lib/declutter/bunch.ts |   if (row) return it.title.trim().length < 3 ? "name" : "price"; |   if (row) return "price";
 * @mutate src/lib/declutter/bunch.ts |   if (p === "fewPhotos" \|\| p === "manyPhotos") return "photos"; |   if (p === "fewPhotos") return "photos";
 * @mutate src/lib/declutter/bunch.ts | : t("lp.bq.looking"); | : "Looking through your photos.";
 * @mutate src/lib/declutter/bunch.ts |   if (seconds < 45) return t("lp.bq.underMinute"); |   if (seconds < 45) return "Less than a minute left.";
 * @mutate src/lib/declutter/bunch.ts | t(getting ? "lp.bq.getting" : "lp.bq.listing", { at, n }) | `Getting ${at} of ${n} ready`
 * @mutate src/lib/declutter/bunch.ts | (n === 1 ? t(NEEDS_ONE[need]) : t(NEEDS_MANY[need], { n })) | `${n} need ${need}`
 * @mutate src/lib/declutter/bunch.ts | const pileNotPlaced = () => t("lp.bq.pileNotPlaced"); | const pileNotPlaced = () => "We couldn't tell which item these belong to.";
 * @mutate src/lib/declutter/bunch.ts | export const pilePageClosed = () => t("lp.bq.pilePageClosed"); | export const pilePageClosed = () => "The page closed before these were sorted.";
 * @mutate src/lib/declutter/bunch.ts | : t("lp.bq.couldNotN", { n: part.length, why }) | : `We couldn't sort these ${part.length} photos yet: ${why}`
 * @mutate src/lib/declutter/moves.ts |   if (d < 0) return t("lp.mv.datePast"); |   if (d < 0) return "Your move-out date can't be in the past.";
 * @mutate src/lib/declutter/moves.ts |   if (d > MOVE_DATE_MAX_DAYS) return t("lp.mv.dateFar"); |   if (d > MOVE_DATE_MAX_DAYS) return "Pick a move-out date within the next 6 months.";
 * @mutate src/lib/declutter/moveDates.ts | new Intl.DateTimeFormat(spanish ? "es-US" : "en-US", | new Intl.DateTimeFormat("en-US",
 *
 * The not-sorted pile's reason is made in the member's language when the pile is made (it is kept on the device in those
 * words, like the To-do lines: decision 11-12 spanish12).
 */
import { afterEach, describe, expect, it } from "vitest";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enListingParts } from "@/lib/i18n/enListingParts";
import { esListingParts } from "@/lib/i18n/esListingParts";
import { formatMoveDate, moveDateProblem } from "@/lib/declutter/moves";
import { blankItem, bunchItemNeed, bunchItemProblem, bunchNeedsLine, groupPhotos, itemsFromAnswer, listingProgressLine, pilePageClosed, sortProgressLine, type BunchPhoto } from "@/lib/declutter/bunch";

const unnamed = { ...blankItem(["a"]), title: "ab", price: "5", sizeUnknown: false };
const unpriced = { ...blankItem(["a"]), title: "Lamp", price: "", sizeUnknown: false };
const tooMany = { ...blankItem(Array.from({ length: 13 }, (_, i) => `p${i}`)), title: "Lamp", price: "5", sizeUnknown: false };

describe("Sell a bunch's problem and progress lines follow the member's language (F260q)", () => {
  afterEach(() => __resetLangForTests());

  it("every word has its Spanish, and es.ts carries it", () => {
    const keys = (Object.keys(enListingParts) as (keyof typeof enListingParts)[]).filter((k) => k.startsWith("lp.bq."));
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) {
      expect(es[k], k).toBe(esListingParts[k]);
      expect(esListingParts[k], `${k} still English`).not.toBe(enListingParts[k]);
      expect([...esListingParts[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...enListingParts[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });

  it("English: the old words", () => {
    expect(bunchItemProblem(unnamed)).toBe("Give it a name of at least 3 characters.");
    expect(bunchItemProblem(unpriced)).toBe("Give it a price between $1 and $1,000.");
    expect(bunchItemProblem(tooMany)).toBe("Use at most 12 photos: split this item or move some photos.");
    expect(bunchNeedsLine([unnamed, unpriced, unpriced])).toBe("1 needs a name, 2 need a price");
    expect(sortProgressLine(0, 1, 0)).toBe("Looking through your photos. Less than a minute left.");
    expect(listingProgressLine(0, 8, ["Lamp"])).toBe("Getting 1 of 4 ready: Lamp. About 1 minute left.");
  });

  it("Spanish: the words change, and each problem still points at its field", async () => {
    setLang("es");
    await ensureLangLoaded();
    expect(bunchItemProblem(unnamed)).toBe("Póngale un nombre de al menos 3 caracteres.");
    expect(bunchItemProblem(unpriced)).toBe("Póngale un precio entre $1 y $1,000.");
    expect(bunchItemNeed(unnamed)).toBe("name");
    expect(bunchItemNeed(unpriced)).toBe("price");
    expect(bunchItemNeed(tooMany)).toBe("photos");
    expect(bunchItemNeed({ ...blankItem([]), title: "Lamp", price: "5", sizeUnknown: false })).toBe("photos");
    expect(bunchNeedsLine([unnamed, unpriced, unpriced])).toBe("1 necesita un nombre, 2 necesitan un precio");
    expect(sortProgressLine(0, 1, 0)).toBe("Revisando sus fotos. Queda menos de un minuto.");
    expect(listingProgressLine(6, 8, ["Lamp", "Chair", "Rug"])).toBe("Publicando 3 de 4: Rug. Queda menos de un minuto.");
  });

  it("the not-sorted pile says why in the member's language", async () => {
    const photo = (key: string): BunchPhoto => ({ key, file: new File([key], `${key}.jpg`, { type: "image/jpeg" }) });
    const batch = [photo("a"), photo("b"), photo("c")];
    const giveUpReason = async () => {
      const res = await groupPhotos(batch, () => {}, async () => { throw new Error("boom"); }, async () => {}, () => 1e9, async (f) => f, { whenBack: async () => {}, awayCount: () => 0 });
      return res.items.find((it) => it.notSorted)?.sortReason ?? "";
    };
    expect(itemsFromAnswer({ items: [], leftover: [] }, batch)[0].sortReason).toBe("We couldn't tell which item these belong to.");
    expect(pilePageClosed()).toBe("The page closed before these were sorted.");
    expect(await giveUpReason()).toMatch(/^We couldn't sort these 3 photos yet: /);
    setLang("es");
    await ensureLangLoaded();
    expect(itemsFromAnswer({ items: [], leftover: [] }, batch)[0].sortReason).toBe("No pudimos saber a qué artículo pertenecen estas fotos.");
    expect(pilePageClosed()).toBe("La página se cerró antes de ordenar estas fotos.");
    expect(await giveUpReason()).toMatch(/^Todavía no pudimos ordenar estas 3 fotos: /);
  });

  it("the move-out date's problems follow the member's language; the date reads in Spanish when asked", async () => {
    const today = "2026-10-15";
    expect(moveDateProblem("", today)).toBe("Pick your move-out date.");
    expect(moveDateProblem("2026-10-14", today)).toBe("Your move-out date can't be in the past.");
    expect(moveDateProblem("2027-05-01", today)).toBe("Pick a move-out date within the next 6 months.");
    expect(formatMoveDate("2026-11-14")).toBe("Saturday, Nov 14");
    setLang("es");
    await ensureLangLoaded();
    expect(moveDateProblem("", today)).toBe(esListingParts["lp.mv.datePick"]);
    expect(moveDateProblem("2026-10-14", today)).toBe("Su fecha de mudanza no puede estar en el pasado.");
    expect(moveDateProblem("2027-05-01", today)).toBe("Elija una fecha de mudanza dentro de los próximos 6 meses.");
    expect(moveDateProblem("2026-10-16", today)).toBeNull();
    expect(formatMoveDate("2026-11-14", true)).toMatch(/^sábado, 14/);
    for (const k of ["lp.mv.datePick", "lp.mv.datePast", "lp.mv.dateFar"] as const) {
      expect(es[k], k).toBe(esListingParts[k]);
      expect(esListingParts[k]).not.toBe(enListingParts[k]);
    }
  });
});
