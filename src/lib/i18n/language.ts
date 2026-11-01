/**
 * The member's language (English or Spanish) and the t() that reads the
 * dictionary. A tiny module store (useSyncExternalStore), so no provider is
 * needed: a screen rendered in a test, a portal or a lazy chunk reads the same
 * value. English is bundled (boot words in enCore.ts; screen words in enScreens.ts, a chunk the screens load); Spanish (es.ts) is fetched on first use, so an
 * English member downloads none of it.
 *
 * Remembered per device in safeStorage ("helpr_lang", mirrored to native
 * Preferences). With nothing saved it follows the browser/phone language.
 * A profile column (so emails and texts can follow it too) is phase 2.
 */
import { useSyncExternalStore } from "react";
import { safeStorage } from "@/lib/safeStorage";
import type { MsgKey } from "./en";
import { englishWords } from "./enRegistry";
import { loadModule } from "@/lib/loadModule";

// Loaded alone, then called: work chained straight onto import() runs inside Vite's preload wrapper, where a
// failure reads as a broken chunk (dynamicImportThenDoesNoWork).
const esModule = () => loadModule(() => import("./es"));

export type Lang = "en" | "es";
export const LANG_KEY = "helpr_lang";
export const LANGS: readonly Lang[] = ["en", "es"];

/** "es", "es-US", "es-419" -> Spanish; anything else -> English. */
export function detectLang(browser: string | undefined | null): Lang {
  const s = (browser ?? "").toLowerCase();
  return s.startsWith("es") ? "es" : "en";
}

function initialLang(): Lang {
  const saved = safeStorage.getItem(LANG_KEY);
  if (saved === "en" || saved === "es") return saved;
  return detectLang(typeof navigator !== "undefined" ? navigator.language : undefined);
}

let lang: Lang = initialLang();
let esDict: Record<MsgKey, string> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
// Bumps on every change (language or a dictionary arriving) so subscribers re-render.
let version = 0;

function emit() {
  version += 1;
  for (const l of listeners) l();
}

function applyHtmlLang() {
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

/** Fetch the Spanish dictionary if Spanish is chosen. Resolves when ready. */
export function ensureLangLoaded(): Promise<void> {
  if (lang !== "es" || esDict) return Promise.resolve();
  if (!loading) {
    loading = esModule().then(
      (m) => {
        // A recovery reload is under way: stay in English, and let the next call try again.
        if (!m) {
          loading = null;
          return;
        }
        esDict = m.es;
        emit();
      },
      (err: unknown) => {
        // A failed chunk (offline, stale deploy) leaves the app in English
        // rather than blank; the next setLang/visit retries.
        loading = null;
        console.warn("[i18n] Spanish dictionary failed to load; showing English", err);
      },
    );
  }
  return loading;
}

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang) {
  if (next !== "en" && next !== "es") return;
  lang = next;
  safeStorage.setItem(LANG_KEY, next);
  applyHtmlLang();
  emit();
  void ensureLangLoaded();
}

function fill(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** The words for `key` in the current language (English until Spanish arrives). */
export function t(key: MsgKey, vars?: Record<string, string | number>): string {
  // English: the boot words plus any screen words already loaded (enRegistry.ts).
  const dict: Record<string, string | undefined> = lang === "es" && esDict ? esDict : englishWords;
  return fill(dict[key] ?? englishWords[key] ?? key, vars);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Re-renders the caller when the language (or its dictionary) changes. */
export function useLanguage(): { lang: Lang; setLang: (l: Lang) => void; t: typeof t } {
  useSyncExternalStore(subscribe, () => version, () => version);
  return { lang, setLang, t };
}

/** Test seam: back to the device default with no dictionary cached. */
export function __resetLangForTests() {
  lang = "en";
  esDict = null;
  loading = null;
  applyHtmlLang();
  emit();
}

applyHtmlLang();
void ensureLangLoaded();
