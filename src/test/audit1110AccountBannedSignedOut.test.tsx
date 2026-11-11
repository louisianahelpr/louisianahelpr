/**
 * Whole-app audit 11-10, Builder 2:
 *   F251 /account-banned signed out: the page bounced to /login with no explanation, so a restricted member following an
 *         email link saw only a login form. Signed out it now shows a short card ("This account is restricted") with the
 *         Contact support link and a Log in link; the signed-in card and its /home bounce are unchanged.
 *
 * @mutate src/pages/auth/AccountBanned.tsx | if (!user) {\n    return ( | if (!user && false) {\n    return (
 * @mutate src/pages/auth/AccountBanned.tsx | <Link to="/support?topic=message&subject=Account%20restricted">Contact support</Link> | <Link to="/login">Contact support</Link>
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync("src/pages/auth/AccountBanned.tsx", "utf8"));

describe("F251: a signed-out visitor to /account-banned sees a short restricted-account card", () => {
  it("no /login redirect; the guest card links to /support and /login", () => {
    expect(src).not.toMatch(/navigate\("\/login"/);
    const start = src.indexOf("if (!user) {\n    return (");
    expect(start).toBeGreaterThan(0);
    const guest = src.slice(start, src.indexOf("  return (\n    <AuthShell", start));
    expect(guest).toContain('data-account-banned-guest=""');
    expect(guest).toMatch(/This account is restricted\./);
    expect(guest).toContain('<Link to="/support?topic=message&subject=Account%20restricted">Contact support</Link>');
    expect(guest).toContain('<Link to="/login">Log in</Link>');
    // The signed-in branch still bounces a no-longer-banned member home.
    expect(src).toMatch(/navigate\("\/home", \{ replace: true \}\)/);
  });
});
