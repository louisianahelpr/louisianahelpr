import { useEffect, useState } from "react";

/**
 * The landing hero in Spanish (UX-8 phase 1; Auditor 3 A3-3, 11-01). The hero's English is LOCKED (CLAUDE.md) and
 * renders exactly as before; a visitor whose saved language (or browser) is Spanish gets the faithful translation
 * (hero.* in src/lib/i18n/es.ts, lead 2026-10-29).
 *
 * Guest first paint stays flat: this file imports nothing. The language is read synchronously, with the same rule as
 * src/lib/i18n/language.ts (saved "helpr_lang", else the browser's language), and the Spanish words are fetched
 * (the same es chunk language.ts loads) only when the language is Spanish. Until they arrive, and if they fail, the
 * hero stays English.
 */
export type HeroWords = { titleLead: string; titleAccent: string; subhead: string; searchLabel: string; searchButton: string };

function heroLangIsSpanish(): boolean {
  let saved: string | null;
  try {
    saved = typeof localStorage !== "undefined" ? localStorage.getItem("helpr_lang") : null;
  } catch {
    // Storage blocked (private mode): fall through to the browser's language, as language.ts does.
    saved = null;
  }
  if (saved === "en" || saved === "es") return saved === "es";
  return typeof navigator !== "undefined" && (navigator.language ?? "").toLowerCase().startsWith("es");
}

export function useHeroWords(): HeroWords | null {
  const [words, setWords] = useState<HeroWords | null>(null);
  useEffect(() => {
    if (!heroLangIsSpanish()) return;
    let live = true;
    import("@/lib/i18n/es").then(
      ({ es }) => {
        if (!live) return;
        setWords({
          titleLead: es["hero.titleLead"], titleAccent: es["hero.titleAccent"], subhead: es["hero.subhead"],
          searchLabel: es["hero.searchLabel"], searchButton: es["hero.searchButton"],
        });
      },
      (err: unknown) => console.warn("[hero] Spanish words failed to load; showing English", err),
    );
    return () => {
      live = false;
    };
  }, []);
  return words;
}
