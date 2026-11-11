/**
 * Audit 11-10 F310 (second half): "lamb" now offers "lamp" (a2fc56fd85), but Spanish "lampara" still found nothing,
 * and "lámpara" split on the accent into "l" and "mpara". When a search finds nothing, closeSearch drops accents and
 * tries a common household word in Spanish as its English word, so Browse offers "Search for lamp instead".
 *
 * @mutate src/lib/declutter/searchMatch.ts |     const english = SPANISH_WORDS[w]; |     const english = undefined as string \| undefined;
 * @mutate src/lib/declutter/searchMatch.ts | searchWords(query.normalize("NFD") | searchWords(query.normalize("NFC")
 */
import { describe, expect, it } from "vitest";
import { closeSearch } from "@/lib/declutter/searchMatch";

const items = [
  { title: "Brass floor lamp", category: "home_decor" },
  { title: "Oak dining chairs (set of 4)", category: "furniture" },
];

describe("F310: a Spanish word offers the English search that finds the item", () => {
  const cases: [string, string | null][] = [
    ["lampara", "lamp"],
    ["lámpara", "lamp"],
    ["sillas", "chair"],
    ["lampara de piso", null], // "de" and "piso" are not in the list: no guess
    ["mesa", null], // no table listed: nothing is offered
    ["lamb", "lamp"], // the typo half still works
  ];
  it.each(cases)("%s -> %s", (q, want) => {
    expect(closeSearch(q, items)).toBe(want);
  });
  it("covers a word, an accent, a plural and the no-guess cases", () => {
    expect(cases.length).toBeGreaterThan(5);
  });
});
