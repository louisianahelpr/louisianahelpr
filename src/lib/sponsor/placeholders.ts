/**
 * 25 Days sponsor page: the "hidden until filled" rule (owner spec 2026-11-09,
 * trust rules). Text in src/content/sponsorPage.ts that still holds a
 * [bracketed placeholder] is never shown to a visitor: the smallest unit that
 * holds it (a card, a paragraph, a button, a stat, an FAQ item) is hidden.
 */

const PLACEHOLDER_RE = /\[[^\]]*\]/;

/** True when `text` still holds a [bracketed placeholder] (or is empty). */
export function hasPlaceholder(text: string | null | undefined): boolean {
  if (text == null) return true;
  if (text.trim() === "") return true;
  return PLACEHOLDER_RE.test(text);
}

/** `text` when it is filled in, else null. */
function filled(text: string | null | undefined): string | null {
  return hasPlaceholder(text) ? null : (text as string);
}

/** Only an http(s) URL with no placeholder counts as a real link. */
export function filledUrl(url: string | null | undefined): string | null {
  const v = filled(url);
  if (!v) return null;
  return /^https?:\/\/[^\s[\]]+$/i.test(v) ? v : null;
}

/** Keep only the items whose chosen text fields are all filled in. */
export function onlyFilled<T>(items: readonly T[], fields: (item: T) => Array<string | null | undefined>): T[] {
  return items.filter((item) => fields(item).every((f) => !hasPlaceholder(f)));
}

/**
 * A reach stat's number: the admin's value (from the database) when set,
 * else the content file's value when it is a plain whole number. Anything
 * else (blank, "[X]", text) is null = hidden.
 */
export function statNumber(adminValue: number | null | undefined, contentValue: string): number | null {
  if (typeof adminValue === "number" && Number.isFinite(adminValue) && adminValue >= 0) return Math.floor(adminValue);
  const s = contentValue.replace(/,/g, "").trim();
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

/** Splits text into plain and [placeholder] runs, for the dev preview that highlights them. */
export function placeholderRuns(text: string): Array<{ text: string; placeholder: boolean }> {
  const out: Array<{ text: string; placeholder: boolean }> = [];
  const re = /\[[^\]]*\]/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), placeholder: false });
    out.push({ text: m[0], placeholder: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), placeholder: false });
  return out;
}
