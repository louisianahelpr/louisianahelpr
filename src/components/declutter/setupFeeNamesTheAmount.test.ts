/**
 * Audit 11-10 F348: the Post a Wanted sheet and the Helpr-lists-it sheet said "a one-time setup fee" without the
 * amount, so a buyer could not know the real cost before posting. Both now name it ($2, moneyLimits.ONBOARDING_FEE_CENTS,
 * the one fee members may see per owner 10-25) and say what it covers (the ID check, OWNER-DECISIONS 10-30).
 *
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | setup: formatPrice(ONBOARDING_FEE_CENTS) | setup: ""
 * @mutate src/lib/i18n/enDeclSell.ts | "dsl.w.feeTyped": "A {price} item costs {total} with our fee. A first purchase also has a one-time {setup} setup fee.", | "dsl.w.feeTyped": "A {price} item costs {total} with our fee. A first purchase also has a one-time setup fee.",
 * @mutate src/components/declutter/HelprListExplainSheet.tsx | one-time ${formatPrice(ONBOARDING_FEE_CENTS)} setup fee, unless | one-time setup fee, unless
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatPrice } from "@/lib/declutter/distance";
import { ONBOARDING_FEE_CENTS } from "@/lib/moneyLimits";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the setup fee is named with its amount (F348)", () => {
  it("is $2", () => {
    expect(formatPrice(ONBOARDING_FEE_CENTS)).toBe("$2");
  });
  // Area 06b H1 (11-18, f980a0bd84): the Wanted sheet's words moved to i18n (dsl.w.feeTyped / dsl.w.feeExample in
  // enDeclSell.ts) for Spanish, so the amount is the {setup} slot, filled with formatPrice(ONBOARDING_FEE_CENTS).
  it("the Wanted sheet fills its fee words' {setup} with the amount, and the English words name it", () => {
    expect(read("src/components/declutter/DeclutterWantedViews.tsx")).toContain("setup: formatPrice(ONBOARDING_FEE_CENTS)");
    const en = read("src/lib/i18n/enDeclSell.ts");
    for (const key of ["dsl.w.feeTyped", "dsl.w.feeExample"]) {
      const line = en.split("\n").find((l) => l.includes(`"${key}":`)) ?? "";
      expect(line, key).toContain("one-time {setup} setup fee");
      expect(line, key).not.toMatch(/one-time setup fee[.,]/);
    }
  });
  for (const file of ["src/components/declutter/HelprListExplainSheet.tsx"]) {
    it(`${file} names the amount and what it covers, never a bare "one-time setup fee"`, () => {
      const src = read(file);
      expect(src).toContain("one-time ${formatPrice(ONBOARDING_FEE_CENTS)} setup fee");
      expect(src).not.toMatch(/one-time setup fee[.,]/);
    });
  }
});
