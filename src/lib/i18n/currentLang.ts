/**
 * The current language as a leaf value, with no imports. language.ts owns the store and writes it here on every
 * change; plain helpers (dateUtils.ts) read it without importing language.ts, whose lazy Spanish/save chunks pull
 * in the whole app (and the Supabase client) wherever a pure helper is imported, such as the e2e typecheck project
 * (tsconfig.e2e.json lists dateUtils.ts; train 11-18 went red on TS6307 when dateUtils imported language.ts).
 */
let current: "en" | "es" = "en";

export function getLang(): "en" | "es" {
  return current;
}

/** Called only by language.ts. */
export function setCurrentLang(next: "en" | "es"): void {
  current = next;
}
