/**
 * The prod-audit write firewall's ONE exception: TermsReconsentDialog's
 * acceptance, both halves — the `profiles` version pin AND the
 * `legal_acceptances` event row (OA-009: on 2026-09-24 01:14Z a press run let
 * only the pin through, and the admin test account ended up accepted with no
 * consent record) — and NOTHING else.
 *
 * 2026-11-03: the pin check was "a profiles PATCH whose body mentions
 * terms_version_accepted", and Complete Profile's save carries that column
 * too (next to full_name, location, zip_code, parish, accepted_terms_at). So
 * the exception let a profile COMPLETION through every firewall, and a sweep
 * signed in as the shared `incomplete` seed account could finish it on prod;
 * the Journeys incomplete-account legs then fail until the account is
 * re-created. The bodies below are built from the two components' own update
 * objects, so the check follows them.
 *
 * @mutate e2e/prod-audit/consentAcceptance.ts | if (method === "POST" && /\/rest\/v1\/legal_acceptances$/ | if (method === "NEVER" && /\/rest\/v1\/legal_acceptances$/
 * @mutate e2e/prod-audit/consentAcceptance.ts | return !!keys && keys.includes("terms_version_accepted") && keys.every((k) => CONSENT_PIN_COLUMNS.has(k)); | return !!keys && keys.includes("terms_version_accepted");
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isConsentAcceptance } from "../../e2e/prod-audit/consentAcceptance";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, p), "utf8"));

/** The keys of the object literal passed to `name(` / assigned to `name =` in `src`. */
function objectKeys(src: string, anchor: RegExp): string[] {
  const m = anchor.exec(src);
  expect(m, `anchor ${anchor} not found`).not.toBeNull();
  let i = src.indexOf("{", m!.index + m![0].length - 1);
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  const body = src.slice(start + 1, i);
  // Top-level keys only: `key:` at depth 0, or a spread `...(cond ? { key: … } : {})`.
  const keys = new Set<string>();
  for (const k of body.matchAll(/(?:^|[,{(\s])([a-z_]+)\s*:/g)) keys.add(k[1]);
  return [...keys];
}

const PROFILES = "/rest/v1/profiles";
const body = (keys: string[]) => JSON.stringify(Object.fromEntries(keys.map((k) => [k, "x"])));

describe("prod-audit consent firewall", () => {
  const dialog = read("../components/TermsReconsentDialog.tsx");
  const completeProfile = read("../pages/auth/CompleteProfile.tsx");
  const pinKeys = objectKeys(dialog, /\.from\("profiles"\)\s*\.update\(/);
  const saveKeys = objectKeys(completeProfile, /const updates: ProfileCompletionUpdates = /);

  it("reads both write shapes from source", () => {
    expect(pinKeys.sort()).toEqual(["terms_accepted_at", "terms_version_accepted"]);
    expect(saveKeys).toContain("terms_version_accepted");
    expect(saveKeys).toContain("location");
    expect(saveKeys.length).toBeGreaterThan(5);
  });

  it("lets the re-consent dialog's pin through", () => {
    expect(isConsentAcceptance("PATCH", PROFILES, body(pinKeys))).toBe(true);
  });

  it("lets the dialog's legal_acceptances event through (OA-009)", () => {
    expect(dialog).toContain('from("legal_acceptances").insert(');
    expect(isConsentAcceptance("POST", "/rest/v1/legal_acceptances", JSON.stringify({ user_id: "u", terms_version: "Oct 2026", privacy_version: "Oct 2026" }))).toBe(true);
  });

  it("refuses Complete Profile's save, which also carries terms_version_accepted", () => {
    expect(isConsentAcceptance("PATCH", PROFILES, body(saveKeys))).toBe(false);
    // Even the smallest save: names + terms, no location.
    expect(isConsentAcceptance("PATCH", PROFILES, body(["full_name", ...pinKeys]))).toBe(false);
  });

  it("refuses every other write", () => {
    expect(isConsentAcceptance("PATCH", PROFILES, null)).toBe(false);
    expect(isConsentAcceptance("PATCH", PROFILES, "terms_version_accepted=x")).toBe(false);
    expect(isConsentAcceptance("PATCH", PROFILES, JSON.stringify([{ terms_version_accepted: "x" }]))).toBe(false);
    expect(isConsentAcceptance("POST", PROFILES, body(pinKeys))).toBe(false);
    expect(isConsentAcceptance("PATCH", "/rest/v1/jobs", body(pinKeys))).toBe(false);
  });
});
