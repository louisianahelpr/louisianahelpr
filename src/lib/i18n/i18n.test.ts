/**
 * Spanish language option (owner-approved, Builder 60, 2026-10-29): the app's
 * words live in one typed dictionary. English (en.ts) is the source; Spanish
 * (es.ts) must carry exactly the same keys, none empty, with the same {vars},
 * so a screen never shows a blank, an English fallback by accident, or a
 * dropped amount ("{amount}") in Spanish.
 *
 * @mutate src/lib/i18n/language.ts | return s.startsWith("es") ? "es" : "en"; | return "en";
 * @mutate src/lib/i18n/language.ts | safeStorage.setItem(LANG_KEY, next); | void next;
 */
import { describe, it, expect, beforeEach } from "vitest";
import { en } from "./en";
import { es } from "./es";
import { detectLang, getLang, setLang, t, ensureLangLoaded, LANG_KEY, __resetLangForTests } from "./language";

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the Spanish dictionary matches the English one", () => {
  it("has exactly the same keys, both ways", () => {
    const enKeys = Object.keys(en).sort();
    const esKeys = Object.keys(es).sort();
    expect(enKeys.length).toBeGreaterThan(40);
    expect(esKeys.filter((k) => !(k in en))).toEqual([]);
    expect(enKeys.filter((k) => !(k in es))).toEqual([]);
  });
  it("has no empty value in either language", () => {
    for (const [k, v] of Object.entries(en)) expect(v.trim(), `en.${k}`).not.toBe("");
    for (const [k, v] of Object.entries(es)) expect(v.trim(), `es.${k}`).not.toBe("");
  });
  it("keeps every {placeholder} (amounts, names) in both languages", () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(vars(es[k]), `es.${k}`).toEqual(vars(en[k]));
    }
  });
});

describe("choosing the language", () => {
  beforeEach(() => {
    __resetLangForTests();
    window.localStorage.clear();
  });
  it("defaults from the browser language", () => {
    expect(detectLang("es-US")).toBe("es");
    expect(detectLang("es")).toBe("es");
    expect(detectLang("en-US")).toBe("en");
    expect(detectLang(undefined)).toBe("en");
  });
  it("remembers the member's choice on this device and translates", async () => {
    setLang("es");
    await ensureLangLoaded();
    expect(getLang()).toBe("es");
    expect(window.localStorage.getItem(LANG_KEY)).toBe("es");
    expect(t("nav.home")).toBe(es["nav.home"]);
    expect(document.documentElement.lang).toBe("es");
    setLang("en");
    expect(t("nav.home")).toBe(en["nav.home"]);
    expect(document.documentElement.lang).toBe("en");
  });
  it("fills {vars}", () => {
    expect(t("lang.switchTo", { lang: "X" })).toContain("X");
  });
});
