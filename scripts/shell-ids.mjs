// The HTML shells in index.html (#lh-<page>-shell, Q2705 A and the earlier landing/home/jobs/messages/declutter
// ones) are a copy of what a page renders, and they stay in the document until the page has painted
// (removeShellOncePainted, up to 10 s). With the page's own ids the document then held two #email and two #password
// inputs on /login: a duplicate id (WCAG 4.1.1; a password manager or a script may pick the shell's inert copy), and
// e2e-real-backend's signed-in job failed every scheduled run on it ("locator('#password') resolved to 2 elements",
// runs 42206493836 and 42393309936). Every id in a shell, and every attribute that points at one (for,
// aria-labelledby, aria-describedby, aria-controls), takes the prefix lh-shell-<shell>-, so it repeats neither its page
// nor another shell (login and signup both have an email field).
// Guards: src/test/shellsCarryNoPageIds.test.ts (every shell), src/test/authShellsMatchPages.test.tsx.
//
// Every <img> in a shell also loads lazily (lead 2026-11-08, guest /declutter LCP 2,060 ms live against the 2 s rule). The
// shells sit in EVERY page's HTML, hidden (display: none) except the one the route shows, and a browser fetches an
// eager <img> even when it is hidden: the landing, login, signup and home shells' Helpr emblem cost a 16 KB WebP
// (the 256 px pick) on every route, sharing the slow link with that route's first paint (on /declutter, with the first
// card photo). A lazy <img> that is not displayed is never fetched; in the shell the route does show, it loads at the
// first layout from the emblem preload (index.html #emblem-preload asks for the same pick).

export const SHELL_ID_PREFIX = "lh-shell-";

const ONE = /(\s)(id|for)="([^"]+)"/g;
const LIST = /(\s)(aria-labelledby|aria-describedby|aria-controls)="([^"]+)"/g;

const EAGER_IMG = /<img\b(?![^>]*\sloading=)/g;

/** The shell markup's images, lazy (above). */
function lazyShellImages(html) {
  return html.replace(EAGER_IMG, '<img loading="lazy"');
}

/** The markup with every id (and every reference to one) given the shell's own prefix, lh-shell-<shell>-, and its images lazy. */
export function scopeShellIds(html, shell) {
  if (!/^[a-z]+$/.test(shell)) throw new Error(`scopeShellIds: shell name "${shell}"`);
  const p = `${SHELL_ID_PREFIX}${shell}-`;
  return lazyShellImages(html)
    .replace(ONE, (_, sp, attr, v) => `${sp}${attr}="${p}${v}"`)
    .replace(LIST, (_, sp, attr, v) => `${sp}${attr}="${v.split(/\s+/).filter(Boolean).map((x) => p + x).join(" ")}"`);
}
