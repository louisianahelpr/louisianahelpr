/**
 * Audit 11-20 night #24 (owner 11-19): the referral credit pays only when BOTH
 * people have finished a job or a Declutter sale or purchase. Every screen
 * states that one rule; none says "your first job" alone.
 *
 * @mutate src/components/profile/ReferralExtras.tsx | You each get $5 once you have both finished a job or a Declutter sale or purchase. | you earn when their first job is done.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

const ROOT = resolve(__dirname, "../..");
const RULE = "once you have both finished a job or a Declutter sale or purchase";
const FILES = [
  "src/components/ReferralSection.tsx",
  "src/components/profile/ReferralExtras.tsx",
  "src/components/referral/EnterReferralCodeCard.tsx",
];

describe("referral copy states the both-finished rule everywhere", () => {
  it.each(FILES)("%s states the rule and not the old first-job line", (f) => {
    const src = readFileSync(resolve(ROOT, f), "utf8");
    expect(src).toContain(RULE);
    expect(src).not.toMatch(/(once you finish|on|when|Once) (your|their) first job/);
  });
  it("sign-up help says it in English and Spanish", () => {
    expect((en as Record<string, string>)["signup.referralHelp"]).toContain(RULE);
    expect((es as Record<string, string>)["signup.referralHelp"]).toContain("cuando los dos hayan terminado un trabajo o una venta o compra en Declutter");
  });
});
