/**
 * Owner 11-20 (Declutter item page polish #7): a listing title is SHOWN in smart title case, so "Vintage duck touch
 * Lamp" reads "Vintage Duck Touch Lamp". Display only: the stored title, the share text and the edit form keep what
 * the seller typed.
 *
 * A word is changed only when it is all lowercase letters: a word with any capital ("iPhone", "OK", "McCoy", "LSU")
 * is the seller's own spelling and is left exactly as typed, as is anything starting with a digit or a symbol
 * ("3-piece", "#2", "w/"). Short joining words ("a", "and", "of", "with" ...) stay lowercase inside the title, never
 * as its first or last word. Hyphenated words are cased part by part ("mid-century" -> "Mid-Century").
 */
const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "nor", "of", "on", "or", "per", "the", "to", "vs", "via", "with"]);

function capPart(part: string): string {
  return /^\p{Ll}+$/u.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part;
}

export function displayTitle(title: string | null | undefined): string {
  if (!title) return title ?? "";
  const tokens = title.split(/(\s+)/);
  const words = tokens.map((t, i) => ({ t, i })).filter(({ t }) => t.trim() !== "");
  if (words.length === 0) return title;
  const first = words[0].i;
  const last = words[words.length - 1].i;
  return tokens
    .map((t, i) => {
      if (t.trim() === "") return t;
      // Only a run of lowercase letters (with hyphens between them, and quotes or punctuation around them) is changed.
      const m = /^([("'“‘]*)(\p{Ll}+(?:-\p{Ll}+)*)([.,!?:;)"'”’]*)$/u.exec(t);
      if (!m) return t;
      if (i !== first && i !== last && SMALL.has(m[2])) return t;
      return m[1] + m[2].split("-").map(capPart).join("-") + m[3];
    })
    .join("");
}
