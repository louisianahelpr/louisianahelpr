/**
 * Home's greeting on the desktop website: the hours rule, the date line and the member's first name kept on this device.
 * A phone draws no greeting (owner 11-14, Depop/Vinted audit item 6), so index.html no longer draws one into
 * #lh-home-shell (Q1158 had it paint the phone greeting with the HTML).
 *
 * The member's first name. Lead decision (11-06, logged): it may be cached on the member's OWN device in localStorage,
 * keyed to their user id, cleared on sign-out and on an account switch, and never shown to another account. Until the
 * profile is read, HomeDashboard's desktop greeting uses it so the name never drops out and grows back.
 *
 * Shared by HomeDashboard and the sign-out paths (src/lib/authSignOut.ts, src/main.tsx).
 * Guard: src/test/homeGreetingShell.test.tsx.
 */

/** localStorage key: JSON {"u": <user id>, "n": <first name>}. One entry, so an account switch overwrites it. */
export const GREETING_NAME_KEY = "helpr_greeting_name";

/** "Good morning" before noon, "Good afternoon" before 5 PM, else "Good evening" (local time). F260q: Spanish
 *  ("es") reads Buenos días / Buenas tardes / Buenas noches. */
export function greetingFor(d = new Date(), lang = "en") {
  const h = d.getHours();
  if (lang === "es") return h < 12 ? "Buenos días" : h < 17 ? "Buenas tardes" : "Buenas noches";
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** The date line: "Friday, Nov 6" ("miércoles, 11 nov" in Spanish). */
export function greetingDate(d = new Date(), lang = "en") {
  return d.toLocaleDateString(lang === "es" ? "es-US" : "en-US", { weekday: "long", month: "short", day: "numeric" });
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
    // Quota or blocked storage: the greeting just has no name until the profile loads next time.
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
