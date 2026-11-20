/**
 * Owner 11-20 (site polish E): a Declutter item's link preview (api/share.ts og:title) shows the title in the same smart
 * title case the item page shows ("Vintage duck touch Lamp" -> "Vintage Duck Touch Lamp"). Display only: the stored
 * title is what the seller typed.
 *
 * Plain dependency-free ESM, like shareCardPrice.mjs: the serverless function imports it with no TypeScript step. The
 * rule is the item page's (src/lib/declutter/displayTitle.ts, PR #4819): a word is changed only when it is all
 * lowercase letters ("iPhone", "OK", "LSU", "3-piece", "w/" stay exactly as typed); short joining words ("a", "and",
 * "of", "with" ...) stay lowercase inside the title, never as its first or last word; hyphenated words are cased part
 * by part ("mid-century" -> "Mid-Century"). Guard: src/test/declutterShareCard.test.ts.
 */
const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "nor", "of", "on", "or", "per", "the", "to", "vs", "via", "with"]);

function capPart(part) {
  return /^\p{Ll}+$/u.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part;
}

/** The title as shown: smart title case, display only. */
export function titleCase(title) {
  if (!title) return title ?? "";
  const tokens = String(title).split(/(\s+)/);
  const words = tokens.map((t, i) => ({ t, i })).filter(({ t }) => t.trim() !== "");
  if (words.length === 0) return title;
  const first = words[0].i;
  const last = words[words.length - 1].i;
  return tokens
    .map((t, i) => {
      if (t.trim() === "") return t;
      const m = /^([("'“‘]*)(\p{Ll}+(?:-\p{Ll}+)*)([.,!?:;)"'”’]*)$/u.exec(t);
      if (!m) return t;
      if (i !== first && i !== last && SMALL.has(m[2])) return t;
      return m[1] + m[2].split("-").map(capPart).join("-") + m[3];
    })
    .join("");
}
