/**
 * The prod-audit explore presser never starts an Apple/Google sign-in link on
 * a shared test account.
 *
 * prod-audit run 38181023758: `explore: profile-security` pressed "Connect
 * Apple" (SignInMethodsCard, Profile > Security). That hands the tab to the
 * provider's OAuth page to link a new sign-in to the shared account, and the
 * explore judged the provider's page "blank page (0 chars of text)". It is a
 * sign-in change, the same kind NEVER_PRESS already refuses for "Edit email".
 *
 * Class: every "Connect <provider>" label SignInMethodsCard can render is
 * refused by NEVER_PRESS, read from the component's own provider names.
 *
 * @mutate e2e/prod-audit/harness.ts | \|edit email\|connect (apple\|google)/i; | \|edit email/i;
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const harness = readFileSync(resolve(ROOT, "e2e/prod-audit/harness.ts"), "utf8");
const card = readFileSync(resolve(ROOT, "src/components/profile/SignInMethodsCard.tsx"), "utf8");

describe("explore never links a sign-in", () => {
  const lit = /export const NEVER_PRESS = \/(.+)\/([a-z]*);/.exec(harness);
  const NEVER_PRESS = new RegExp(lit![1], lit![2]);

  it("reads the card's provider names (floor)", () => {
    expect(lit).not.toBeNull();
    expect(card).toMatch(/`Connect \$\{NAME\[p\]\}`/);
    const names = [...(/const NAME[^=]*=\s*\{([^}]+)\}/.exec(card)?.[1] ?? "").matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(2);
    for (const n of names) expect(NEVER_PRESS.test(`Connect ${n}`), `Connect ${n}`).toBe(true);
  });

  it("still lets ordinary controls through", () => {
    for (const ok of ["Connect a Calendar", "Save Changes", "Add a Calendar"]) expect(NEVER_PRESS.test(ok), ok).toBe(false);
  });
});
