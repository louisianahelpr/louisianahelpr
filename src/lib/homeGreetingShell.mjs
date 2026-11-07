/**
 * Q1158 (lead 11-06; owner rule: every page under 2 s). A signed-in phone's /home LCP is the Dashboard greeting h1, and
 * it waited on the whole app: live 11-06, 375 px, Slow 4G + 4x, LCP 4704 / 4836 ms, "Good afternoon" [20,68 335x31].
 * index.html now draws the greeting text into #lh-home-shell's greeting slot (data-skeleton-part="greeting") with an
 * inline script, so the h1 paints with the HTML.
 *
 * The member's first name. Lead decision (11-06, logged): it may be cached on the member's OWN device in localStorage,
 * keyed to their user id, cleared on sign-out and on an account switch, and never shown to another account. With no
 * cached name for the stored session's user, the greeting is drawn without a name (as HomeDashboard does before the
 * profile loads).
 *
 * Shared by HomeDashboard (the React greeting: same classes, same text rules), index.html's inline script (literal
 * copies; src/test/homeGreetingShell.test.tsx holds them equal), scripts/inline-shell-css.mjs (the classes' CSS is
 * inlined) and the sign-out paths (src/lib/authSignOut.ts, src/main.tsx).
 */

/** localStorage key: JSON {"u": <user id>, "n": <first name>}. One entry, so an account switch overwrites it. */
export const GREETING_NAME_KEY = "helpr_greeting_name";

/** HomeDashboard's phone greeting: the h1 and the date line under it. */
export const GREETING_TITLE_CLASS = "font-moment text-page-title text-foreground";
export const GREETING_DATE_CLASS = "text-ds-14 text-muted-foreground mt-0.5";

/** The markup the inline script draws (empty text), for the CSS inliner's first-frame inventory. */
export const GREETING_SHELL_MARKUP = `<div><h1 class="${GREETING_TITLE_CLASS}"></h1><p class="${GREETING_DATE_CLASS}"></p></div>`;

/** "Good morning" before noon, "Good afternoon" before 5 PM, else "Good evening" (local time). */
export function greetingFor(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** The date line: "Friday, Nov 6". */
export function greetingDate(d = new Date()) {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function store() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Storage blocked (a private window, a sandboxed frame): nothing is cached, the greeting has no name.
    return null;
  }
}

/** The cached first name for `userId`, or "" (none cached, another account's, unreadable). */
export function readGreetingName(userId) {
  const s = store();
  if (!s || !userId) return "";
  try {
    const v = JSON.parse(s.getItem(GREETING_NAME_KEY) || "null");
    return v && v.u === userId && typeof v.n === "string" ? v.n : "";
  } catch {
    // A corrupt entry reads as no name; the next profile load rewrites it.
    return "";
  }
}

/** Keep `first` for `userId` on this device; an empty name removes the entry. */
export function saveGreetingName(userId, first) {
  const s = store();
  if (!s || !userId) return;
  try {
    if (first) s.setItem(GREETING_NAME_KEY, JSON.stringify({ u: userId, n: first }));
    else s.removeItem(GREETING_NAME_KEY);
  } catch {
    // Quota or blocked storage: the HTML greeting just has no name next time.
  }
}

/** Remove the cached name, unless it belongs to `keepUserId` (an account switch keeps only the new account's). */
export function clearGreetingName(keepUserId) {
  const s = store();
  if (!s) return;
  try {
    if (keepUserId) {
      const v = JSON.parse(s.getItem(GREETING_NAME_KEY) || "null");
      if (v && v.u === keepUserId) return;
    }
    s.removeItem(GREETING_NAME_KEY);
  } catch {
    // A corrupt or unreadable entry: try a plain remove; if storage itself is blocked there is nothing stored to leak.
    try {
      s.removeItem(GREETING_NAME_KEY);
    } catch {
      // Blocked storage holds no entry.
    }
  }
}
