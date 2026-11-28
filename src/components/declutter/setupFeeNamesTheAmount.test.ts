/**
 * Audit 11-10 F348 named the $2 setup fee on the Post a Wanted sheet and the Helpr-lists-it sheet. Owner 2026-11-20:
 * Declutter never charges the setup fee (buyer, seller or free claimer), so neither sheet mentions it any more.
 *
 * @mutate src/lib/i18n/enDeclSell.ts | "dsl.w.feeTyped": "A {price} item costs {total} with our fee.", | "dsl.w.feeTyped": "A {price} item costs {total} with our fee. A first purchase also has a one-time {setup} setup fee.",
 * @mutate src/components/declutter/HelprListExplainSheet.tsx | line: "You keep the whole price of what sells." }, | line: "You keep the whole price of what sells. Your first paid listing has a one-time setup fee." },
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("Declutter's sheets name no setup fee (owner 2026-11-20)", () => {
  it("the Wanted sheet's fee words, English and Spanish, name only the buyer's fee", () => {
    expect(read("src/components/declutter/DeclutterWantedViews.tsx")).not.toContain("ONBOARDING_FEE_CENTS");
    for (const [file, words] of [["src/lib/i18n/enDeclSell.ts", /setup fee|\{setup\}/i], ["src/lib/i18n/esDeclSell.ts", /inscripción|\{setup\}/i]] as const) {
      const src = read(file);
      for (const key of ["dsl.w.feeTyped"]) {
        const line = src.split("\n").find((l) => l.includes(`"${key}":`)) ?? "";
        expect(line, `${file} ${key}`).toMatch(/\{total\}/);
        expect(line, `${file} ${key}`).not.toMatch(words);
      }
    }
  });
  it("the Helpr-lists-it sheet says the seller keeps the whole price, with no fee", () => {
    const src = read("src/components/declutter/HelprListExplainSheet.tsx");
    expect(src).toContain('line: "You keep the whole price of what sells." }');
    expect(src).not.toMatch(/setup fee/i);
  });
});
