/**
 * AUD31-72 (Auditor 7, 10-31, Account leftovers): at 375/360 the delete-account
 * code step split the address "audit-buyer@example.co / m." (`break-all` on the
 * email span), the Account and security header ended "Account and secur...",
 * the email row was cut "audit-buyer@example..." and the two-step line split
 * "sign- / in.".
 *
 * CLASS: on a member-facing screen (everything under src/ except the admin
 * console, which keeps `break-all` on purpose: DetailHeader's moderation note),
 * an email is never shown with `break-all` (it breaks mid-word even when the
 * whole address would fit on the next line) or `truncate` (the member can't
 * read their own address). `[overflow-wrap:anywhere]` moves the address whole
 * first and breaks only an address longer than the line. Inventory: every
 * tracked .tsx under src/, comments blanked.
 *
 * @mutate src/components/profile/DeleteAccountReauth.tsx | <span className="block font-semibold [overflow-wrap:anywhere]">{email}.</span> | <span className="font-semibold break-all">{email}</span>.
 * @mutate src/components/profile/SecurityTab.tsx | text-foreground [overflow-wrap:anywhere] mt-0.5">{email}</p> | text-foreground truncate mt-0.5">{email}</p>
 * @mutate src/components/profile/SecurityTab.tsx | onBack={onBack}\n        wrapTitle | onBack={onBack}
 * @mutate src/components/profile/TwoFactorCard.tsx | <>Required at <span className="whitespace-nowrap">sign-in.</span> Support can remove it.</> | "Required at sign-in. Support can remove it."
 * @mutate src/pages/auth/SignupPending.tsx | If <span className="font-semibold [overflow-wrap:anywhere]">{prefillEmail}</span> | If <span className="font-semibold break-all">{prefillEmail}</span>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

const read = (f: string) => blankComments(readFileSync(join(process.cwd(), f), "utf8"));

const FILES = trackedFiles("src").filter(
  (f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f) && !f.startsWith("src/test/") && !f.startsWith("src/components/admin/"),
);

/** Elements whose class string has `bad` and whose first child is an expression naming an email. */
function offenders(bad: "break-all" | "truncate"): string[] {
  const out: string[] = [];
  const re = new RegExp(`className="[^"]*\\b${bad}\\b[^"]*"[^>]*>\\s*\\{[^}]*[eE]mail[^}]*\\}`, "g");
  for (const f of FILES) {
    const src = read(f);
    for (const m of src.matchAll(re)) out.push(`${f}: ${m[0].slice(0, 120)}`);
  }
  return out;
}

describe("member-facing emails never split mid-word or get cut (AUD31-72)", () => {
  it("scanned the member-facing screens", () => {
    expect(FILES.length).toBeGreaterThan(300);
    expect(FILES).toContain("src/components/profile/DeleteAccountReauth.tsx");
  });

  it("no email is shown with break-all", () => {
    expect(offenders("break-all")).toEqual([]);
  });

  it("no email is shown with truncate", () => {
    expect(offenders("truncate")).toEqual([]);
  });

  it("the delete code step puts the address on its own line", () => {
    expect(read("src/components/profile/DeleteAccountReauth.tsx")).toMatch(
      /<span className="block [^"]*\[overflow-wrap:anywhere\][^"]*">\{email\}\.<\/span>/,
    );
  });

  it("the Account and security header wraps instead of ending in ...", () => {
    const sec = read("src/components/profile/SecurityTab.tsx");
    expect(sec).toMatch(/<ProfileTabHeader\s+title=\{TAB_TITLES\.security\}[^>]*\bwrapTitle\b/);
  });

  it("the two-step line keeps 'sign-in' whole", () => {
    const card = read("src/components/profile/TwoFactorCard.tsx");
    expect(card).not.toMatch(/"[^"\n]*\bsign-in\.[^"\n]*"/);
    expect(card.match(/<span className="whitespace-nowrap">sign-in\.<\/span>/g)?.length).toBe(2);
  });
});
