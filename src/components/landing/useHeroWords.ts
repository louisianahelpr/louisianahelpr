import { useEffect, useState } from "react";
import { loadModule, untilReload } from "@/lib/loadModule";

/**
 * The landing hero in Spanish (UX-8 phase 1; Auditor 3 A3-3, 11-01). The hero's English is LOCKED (CLAUDE.md) and
 * renders exactly as before; a visitor whose saved language (or browser) is Spanish gets the faithful translation
 * (hero.* in src/lib/i18n/es.ts, lead 2026-10-29).
 *
 * Guest first paint stays flat: this file imports only loadModule (which imports nothing). The language is read synchronously, with the same rule as
 * src/lib/i18n/language.ts (saved "helpr_lang", else the browser's language), and the Spanish words are fetched
 * (the same es chunk language.ts loads) only when the language is Spanish. Until they arrive, and if they fail, the
 * hero stays English.
 */
/** The Spanish words alone in their own loader, read outside Vite's preload wrapper (dynamicImportThenDoesNoWork). */
const esModule = () => loadModule(() => import("@/lib/i18n/es"));

export type HeroWords = { titleLead: string; titleAccent: string; subhead: string; searchLabel: string; searchButton: string; searchDeclutter: string; tabJobs: string };

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
    let live = true;
    const read = () => {
      // F260q: a switch made on the page (the footer's English / Español) re-reads; English is the locked copy (null).
      if (!heroLangIsSpanish()) {
        setWords(null);
        return;
      }
      esModule()
        .then((m) => m ?? untilReload())
        .then(
          ({ es }) => {
            if (!live) return;
            setWords({
              titleLead: es["hero.titleLead"], titleAccent: es["hero.titleAccent"], subhead: es["hero.subhead"],
              searchLabel: es["hero.searchLabel"], searchButton: es["hero.searchButton"],
              searchDeclutter: es["hero.searchDeclutter"], tabJobs: es["hero.tabJobs"],
            });
          },
          (err: unknown) => console.warn("[hero] Spanish words failed to load; showing English", err),
        );
    };
    read();
    // "helpr:lang" is fired by src/lib/i18n/language.ts setLang (useGuestSpanish.ts LANG_EVENT; a literal, so no import).
    window.addEventListener("helpr:lang", read);
    return () => {
      live = false;
      window.removeEventListener("helpr:lang", read);
    };
  }, []);
  return words;
}
