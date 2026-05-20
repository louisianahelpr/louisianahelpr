/**
 * searchHistory — localStorage-backed recent-search list for the Browse
 * Tasks toolbar.
 *
 * Stored as a JSON string array under `helpr:search-history`. Max 5
 * entries, deduped (case-insensitive, trimmed), FIFO eviction — the
 * newest query is at index 0, the oldest at the end. Anything older than
 * the 5th most recent is dropped.
 *
 * Reads are synchronous and tolerant of corrupt / missing data: parse
 * failures return an empty list rather than crashing the toolbar. Writes
 * are best-effort; localStorage quota / private-mode errors are
 * swallowed so a search still runs even if we can't remember it.
 *
 * We do NOT route this through `safeStorage` — recent searches are
 * disposable UX polish, not durable user data worth mirroring to
 * Capacitor Preferences.
 */

export const SEARCH_HISTORY_KEY = "helpr:search-history";
export const SEARCH_HISTORY_MAX = 5;
/** Don't pollute history with single keystrokes — only remember
 *  queries the user actually committed to. */
export const SEARCH_HISTORY_MIN_LENGTH = 3;

function safeRead(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return [];
  }
}

function safeWrite(list: string[]) {
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Returns the most-recent-first list of remembered queries. */
export function getRecentSearches(): string[] {
  return safeRead();
}

/**
 * Add `query` to the front of history, deduping any case-insensitive
 * match and trimming the list to `SEARCH_HISTORY_MAX`. No-ops for
 * queries below `SEARCH_HISTORY_MIN_LENGTH` after trim.
 */
export function pushRecentSearch(query: string): void {
  const trimmed = query.trim();
  if (trimmed.length < SEARCH_HISTORY_MIN_LENGTH) return;
  const lower = trimmed.toLowerCase();
  const current = safeRead();
  const deduped = current.filter((q) => q.toLowerCase() !== lower);
  const next = [trimmed, ...deduped].slice(0, SEARCH_HISTORY_MAX);
  safeWrite(next);
}

/** Wipe all remembered searches. */
export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(SEARCH_HISTORY_KEY);
  } catch {
    /* ignore */
  }
}
