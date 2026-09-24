/**
 * OA-009 — the prod-audit write firewall must let BOTH halves of a consent
 * acceptance through: the `profiles` version pin AND the `legal_acceptances`
 * event row. On 2026-09-24 01:14Z a press run let only the pin through, and
 * the admin test account ended up accepted with no consent record.
 *
 * Source-read, because harness.ts imports @playwright/test.
 *
 * @mutate e2e/prod-audit/harness.ts | if (method === "POST" && /\/rest\/v1\/legal_acceptances$/ | if (method === "NEVER" && /\/rest\/v1\/legal_acceptances$/
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../../e2e/prod-audit/harness.ts"), "utf8");
const fn = /export function isConsentAcceptance\([\s\S]*?\n\}/.exec(src)?.[0] ?? "";

describe("prod-audit consent firewall (OA-009)", () => {
  it("allows the profiles pin", () => {
    expect(fn).toMatch(/method === "PATCH" && \/\\\/rest\\\/v1\\\/profiles\$\//);
  });
  it("allows the legal_acceptances event", () => {
    expect(fn).toMatch(/method === "POST" && \/\\\/rest\\\/v1\\\/legal_acceptances\$\//);
  });
  it("the dialog it lets through still writes to legal_acceptances", () => {
    const dialog = readFileSync(resolve(__dirname, "../components/TermsReconsentDialog.tsx"), "utf8");
    expect(dialog).toContain('from("legal_acceptances").insert(');
  });
});
