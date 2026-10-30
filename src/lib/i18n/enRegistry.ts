/**
 * The English words t() can read right now: enCore on boot, plus enScreens
 * once a screen that uses it has loaded (it calls addEnglish on import).
 * No imports, so boot carries only this and enCore.
 */
import { enCore } from "./enCore";

export const englishWords: Record<string, string> = { ...enCore };

export function addEnglish(words: Record<string, string>): void {
  Object.assign(englishWords, words);
}
