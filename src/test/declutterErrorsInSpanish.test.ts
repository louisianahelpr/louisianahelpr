/**
 * F260q: every Declutter refusal (errors.ts declutterErrorMessage) follows the member's language. The English tables
 * stay the English (declutterErrorCopy.test.ts holds them to the migrations); a Spanish reader gets each refusal by its
 * CODE (de.<code> in enDeclErrors/esDeclErrors, esDeclErrors rides es.ts only), never by its words.
 * Inventory: every code in DECLUTTER_ERROR_COPY and DECLUTTER_CLIENT_ERROR_COPY has a de.* key whose English is the
 * table's word for word, and its Spanish; the generic, offline and constraint lines too.
 *
 * @mutate src/lib/declutter/errors.ts |   return w === key ? english : w; |   return english;
 * @mutate src/lib/declutter/errors.ts |   return w === key ? english : w; |   return w;
 * @mutate src/lib/declutter/errors.ts |     return inLang(message, DECLUTTER_ERROR_COPY[message]); |     return DECLUTTER_ERROR_COPY[message];
 * @mutate src/lib/declutter/errors.ts |     return inLang(message, DECLUTTER_CLIENT_ERROR_COPY[message]); |     return DECLUTTER_CLIENT_ERROR_COPY[message];
 * @mutate src/lib/declutter/errors.ts |   if (!err) return inLang("generic", GENERIC); |   if (!err) return GENERIC;
 * @mutate src/lib/i18n/es.ts |   ...esDeclErrors, |
 */
import { afterEach, describe, expect, it } from "vitest";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enDeclErrors } from "@/lib/i18n/enDeclErrors";
import { esDeclErrors } from "@/lib/i18n/esDeclErrors";
import { englishWords } from "@/lib/i18n/enRegistry";
import { DECLUTTER_CLIENT_ERROR_COPY, DECLUTTER_ERROR_COPY, DECLUTTER_OFFLINE_COPY, declutterErrorMessage } from "@/lib/declutter/errors";

const TABLE: Record<string, string> = { ...DECLUTTER_ERROR_COPY, ...DECLUTTER_CLIENT_ERROR_COPY };

describe("F260q: Declutter's refusals follow the member's language", () => {
  afterEach(() => __resetLangForTests());

  it("every code has its key (English word for word) and its Spanish, and es.ts carries it", () => {
    expect(Object.keys(TABLE).length).toBeGreaterThan(250);
    for (const [code, english] of Object.entries(TABLE)) {
      const k = `de.${code}` as keyof typeof enDeclErrors;
      expect(enDeclErrors[k], k).toBe(english);
      expect(esDeclErrors[k], k).toBeTruthy();
      expect(esDeclErrors[k], k).not.toBe(english);
      expect((es as Record<string, string>)[k], k).toBe(esDeclErrors[k]);
    }
    expect(enDeclErrors["de.offline"]).toBe(DECLUTTER_OFFLINE_COPY);
    // No key without a code (a removed code takes its words with it).
    const extra = Object.keys(enDeclErrors).filter((k) => !(k.slice(3) in TABLE) && !["de.generic", "de.offline", "de.check"].includes(k));
    expect(extra).toEqual([]);
  });

  it("English reader: the table's own words", () => {
    expect(declutterErrorMessage({ message: "photos_required" })).toBe(DECLUTTER_ERROR_COPY.photos_required);
    expect(declutterErrorMessage({ message: "ai_unavailable" })).toBe(DECLUTTER_CLIENT_ERROR_COPY.ai_unavailable);
  });

  it("Spanish chosen but not loaded yet: the English, never a raw key", () => {
    // At runtime no English de.* words are registered (enDeclErrors is not imported by the app; this test imports it).
    const saved = englishWords["de.photos_required"];
    delete englishWords["de.photos_required"];
    setLang("es");
    try {
      expect(declutterErrorMessage({ message: "photos_required" })).toBe(DECLUTTER_ERROR_COPY.photos_required);
    } finally { englishWords["de.photos_required"] = saved; }
    expect(declutterErrorMessage({ message: "nope_not_a_code" })).not.toMatch(/^de\./);
  });

  it("Spanish reader: server codes, app codes, the constraint and generic lines read in Spanish", async () => {
    setLang("es");
    await ensureLangLoaded();
    expect(declutterErrorMessage({ message: "photos_required" })).toBe("Agregue al menos 1 foto del artículo (hasta 12).");
    expect(declutterErrorMessage({ message: "porch_place_needed" })).toBe(esDeclErrors["de.porch_place_needed"]);
    expect(declutterErrorMessage({ message: "ai_unavailable" })).toBe(esDeclErrors["de.ai_unavailable"]);
    expect(declutterErrorMessage({ message: "x", code: "23514" })).toBe(esDeclErrors["de.check"]);
    expect(declutterErrorMessage({ message: "nope_not_a_code" })).toBe(esDeclErrors["de.generic"]);
    expect(declutterErrorMessage(null)).toBe(esDeclErrors["de.generic"]);
  });
});
