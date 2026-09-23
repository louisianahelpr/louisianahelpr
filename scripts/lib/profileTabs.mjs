/**
 * The Profile tab keys, parsed from TAB_TITLES in src/pages/profile/types.ts
 * (the constant the app renders and routes on). ONE parser for every script
 * (Q279): audit-capture kept a copy that only accepted a `"` after the key, so
 * `wrapped` (a template literal) silently dropped out of every capture sweep.
 * Only KEYS matter; the value may open with any quote.
 */
export function parseProfileTabKeys(typesSrc) {
  const i = typesSrc.indexOf("TAB_TITLES");
  if (i === -1) return [];
  const block = typesSrc.slice(i, typesSrc.indexOf("};", i));
  return [...block.matchAll(/^\s*(\w+):\s*["'`]/gm)].map((m) => m[1]);
}
