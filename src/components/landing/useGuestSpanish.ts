import { useEffect, useState } from "react";
import { loadModule, untilReload } from "@/lib/loadModule";

/**
 * Spanish for the signed-out first screens (the footer; F260q, owner 11-11 "Spanish everything"): the same rule as
 * useHeroWords.ts and src/lib/i18n/language.ts (saved "helpr_lang", else the browser's language), and the same es
 * chunk, fetched only when the language is Spanish. Returns the Spanish dictionary, or null for English (the caller's
 * own English words, unchanged).
 *
 * Like useHeroWords, this file imports no i18n module, so guest first paint does not grow. It follows a switch made
 * on the page: language.ts's setLang fires LANG_EVENT, and every guest hook re-reads.
 */
const esModule = () => loadModule(() => import("@/lib/i18n/es"));

/** Fired on window by language.ts setLang (kept as a plain string so neither file imports the other). */
export const LANG_EVENT = "helpr:lang";

type EsDict = Record<string, string>;

export function guestLangIsSpanish(): boolean {
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

export function useGuestSpanish(): EsDict | null {
  const [dict, setDict] = useState<EsDict | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => {
      if (!guestLangIsSpanish()) {
        setDict(null);
        return;
      }
      // An empty module (a recovery reload is on its way) waits on untilReload(), as useHeroWords does: nothing is dropped.
      esModule()
        .then((m) => m ?? untilReload())
        .then(
        ({ es }) => {
          if (live) setDict(es);
        },
        (err: unknown) => console.warn("[i18n] Spanish words failed to load; showing English", err),
      );
    };
    read();
    window.addEventListener(LANG_EVENT, read);
    return () => {
      live = false;
      window.removeEventListener(LANG_EVENT, read);
    };
  }, []);
  return dict;
}
