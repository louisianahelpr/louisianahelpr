// The /login and /signup HTML shells (index.html, Q2705 A) are a copy of what the page renders, and they stay in the
// document until the page has painted (removeShellOncePainted, up to 10 s). With the page's own ids the document then
// held two #email and two #password inputs: a duplicate id (WCAG 4.1.1; a password manager or a script may pick the
// shell's inert copy), and e2e-real-backend's signed-in job failed every scheduled run on it ("locator('#password')
// resolved to 2 elements", runs 42206493836 and 42393309936). Every id in a shell, and every attribute that points at
// one (for, aria-labelledby, aria-describedby, aria-controls), takes the shell's own prefix.
// Guard: src/test/authShellsMatchPages.test.tsx ("no id in a shell repeats one its page renders").

export const SHELL_ID_PREFIX = "lh-shell-";

const ONE = /(\s)(id|for)="([^"]+)"/g;
const LIST = /(\s)(aria-labelledby|aria-describedby|aria-controls)="([^"]+)"/g;

/** The markup with every id (and every reference to one) given the shell prefix. */
export function scopeShellIds(html) {
  return html
    .replace(ONE, (_, sp, attr, v) => `${sp}${attr}="${SHELL_ID_PREFIX}${v}"`)
    .replace(LIST, (_, sp, attr, v) => `${sp}${attr}="${v.split(/\s+/).filter(Boolean).map((x) => SHELL_ID_PREFIX + x).join(" ")}"`);
}
