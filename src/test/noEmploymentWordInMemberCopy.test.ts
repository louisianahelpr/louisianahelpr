/**
 * Owner UI audit 2026-11-09, F092 (HIGH): the Work record was titled "Employment and earnings record" while the
 * Terms say Helprs are independent contractors, not employees. Renamed "Work and earnings record". CLASS: no
 * member-facing code says "employment" / "employee(s)" / "employed" about Helpr work. The IRS term
 * "self-employment tax" stays (it is the tax's legal name), and so does the Terms' "independent contractors, not
 * employees" (it says the opposite).
 *
 * Inventory: every tracked .ts/.tsx file under src/ and supabase/functions/ (tests excluded), comments blanked.
 *
 * @mutate src/lib/workRecordDocument.ts | "Work and earnings record", | "Employment and earnings record",
 * @mutate src/pages/profile/WorkRecord.tsx | "Helpr Work and Earnings Record" | "Helpr Employment & Earnings Record"
 * @mutate src/components/profile/WorkRecordReserve.tsx | >Work and earnings record< | >Employment and earnings record<
 */
import { describe, expect, it } from "vitest";
import { relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const files = walkSource([resolve(ROOT, "src"), resolve(ROOT, "supabase/functions")]).filter(
  (f) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(f) && !/\/src\/test\//.test(f) && !/\.gen\.ts$/.test(f),
);
/** Word forms that call Helpr work a job with an employer. "self-employment" / "self-employed" are excluded below. */
const EMPLOY = /\b(employment|employees?|employed)\b/i;

describe("member copy never calls Helpr work employment (F092)", () => {
  it("reads a real inventory", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  it("no employment / employee wording outside comments", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const raw = readSource(f);
      if (raw == null) continue;
      const code = blankComments(raw).replace(/self-employ(ment|ed)/gi, "").replace(/\bnot (an? )?employees?\b/gi, "");
      code.split("\n").forEach((line, i) => {
        if (EMPLOY.test(line)) offenders.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
