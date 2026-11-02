/**
 * Q2614 (Jobs audit 1102b row 28): until 2026-11-02 Post a job's step 5 gave two rules for when the street address is shared: the
 * header said "your street address after you hire", the Location help said "sent only to the Helpr you offer the job
 * to". The job page shows it to an offered Helpr before they accept, so the offer is the moment. Both lines now say the
 * one rule (STREET_ADDRESS_RULE), and no Post a job source says "after you hire" about the address.
 *
 * @mutate src/lib/i18n/enPostJob.ts |   "postJob.whereH": `Helprs see the area now. ${STREET_ADDRESS_RULE}`, |   "postJob.whereH": "Helprs see the area now and your street address after you hire.",
 * @mutate src/components/postjob/LogisticsSection.tsx | and the distance. {STREET_ADDRESS_RULE} | and the distance. The street address is shared after you hire.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { STREET_ADDRESS_RULE } from "@/lib/streetAddressRule";
import { enPostJob } from "@/lib/i18n/enPostJob";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe("Q2614: one rule for the street address on Post a job", () => {
  it("step 5's header says the rule", () => {
    expect(enPostJob["postJob.whereH"]).toBe(`Helprs see the area now. ${STREET_ADDRESS_RULE}`);
    expect(STREET_ADDRESS_RULE).toMatch(/offer the job/);
  });

  it("the Location help says the same rule, from the same constant", () => {
    const src = blankComments(readFileSync("src/components/postjob/LogisticsSection.tsx", "utf8"));
    expect(src).toContain("and the distance. {STREET_ADDRESS_RULE}");
  });

  it("no Post a job source ties the address to the hire", () => {
    const all = [...files("src/components/postjob"), ...files("src/pages/post-job"), "src/lib/i18n/enPostJob.ts"];
    expect(all.length).toBeGreaterThan(20);
    const bad = all.filter((f) => /(street )?address[^"`\n]{0,40}after you hire/i.test(blankComments(readFileSync(f, "utf8"))));
    expect(bad).toEqual([]);
  });
});
