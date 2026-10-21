/** Which result group /search shows (board 89's chips). */
export type SearchSection = "all" | "jobs" | "declutter";

/**
 * A PostgREST `ilike` pattern that matches the typed words as literal text.
 * `%` and `_` are LIKE wildcards and `\` is its escape, so each is escaped;
 * a search for "50%" finds "50%", not everything. PostgREST also reads `*` as
 * `%` in a like/ilike value, and has no escape for it, so `*` becomes a space. Commas and parentheses are
 * safe here because the pattern goes through `.ilike()`, not an `or=` string.
 */
export function likePattern(q: string): string {
  return `%${q.trim().replace(/\*/g, " ").replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
