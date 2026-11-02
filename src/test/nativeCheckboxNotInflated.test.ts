// @mutate src/components/rentals/RentPanel.tsx | <input type="checkbox" className="h-[18px] w-[18px] min-h-0 min-w-0 shrink-0" style={{ accentColor: "hsl(var(--primary))" }} checked | <input type="checkbox" checked
// @mutate src/components/admin/helprFault/HelprFaultFields.tsx | <input type="radio" className="h-4 w-4 min-h-0 min-w-0 shrink-0" style={{ accentColor: "hsl(var(--primary))" }} name="helpr-fault-kind" value="no_show" | <input type="radio" name="helpr-fault-kind" value="no_show"
// @mutate src/components/admin/AdminExceptionQueue.tsx | className="h-[18px] w-[18px] min-h-0 min-w-0 accent-[hsl(var(--primary))]" | className="h-[18px] w-[18px] accent-[hsl(var(--primary))]"
// @mutate src/components/admin/AdminIDVReview.tsx | className="h-[18px] w-[18px] min-h-0 min-w-0 accent-[hsl(var(--bark))]" | className="h-[18px] w-[18px] shrink-0 accent-[hsl(var(--bark))]"
/**
 * A NATIVE checkbox or radio sized with h-/w- utilities must also say min-h-*
 * and min-w-* (Q?idv-phone-row, 2026-10-17).
 *
 * index.css gives every input[type=checkbox|radio] a 44x44 min-height and
 * min-width floor (zero specificity, so any min-* utility wins). `h-4 w-4`
 * alone does not override a MIN, so the browser draws the box itself at 44px:
 * on /admin?view=idvreview at 375 the bulk-select box was an empty 44x44
 * white square (seen on prod as admin-e2e: ~/.lh-shots/reds-1017/shots/after-idv-375.png).
 * The fix is a 44px <label> around a box that keeps its own size
 * (`min-h-0 min-w-0`).
 *
 * Found by what it IS: every `<input` whose type is checkbox or radio across
 * src. KNOWN is the exact set still inflated when this landed; it fails both
 * ways (a new one, or a KNOWN one that was fixed and must be deleted).
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = path.resolve(__dirname, "../..");

// @two-way src/test/nativeCheckboxNotInflated.test.ts:fixed: delete from KNOWN
// Q2047 (B42, 10-31): the last four sized ones (credential license/insurance, exception bulk select, series dates) now
// sit in a 44px label with min-h-0 min-w-0 on the box.
// B42 (10-31, BUY-36 screen check): a BARE box (no class at all) is inflated the same way: at 375 the admin's "Was the
// report true?" radios were 44px browser-blue circles. The admin and rentals ones are fixed the same way.
const KNOWN = new Set<string>([]);

function scan() {
  const inflated: string[] = [];
  let inputs = 0;
  const files = walkSource([path.join(ROOT, "src")]).filter((p) => /\.tsx$/.test(p) && !/\.test\.tsx$/.test(p));
  for (const file of files) {
    const raw = readSource(file);
    if (raw === null) continue;
    const code = blankComments(raw);
    let n = 0;
    for (const m of code.matchAll(/<input\b([^>]*?)\/?>/gs)) {
      const attrs = m[1];
      if (!/\btype="(checkbox|radio)"/.test(attrs)) continue;
      inputs++;
      n++;
      const cls = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(attrs)?.slice(1).find((x) => x !== undefined) ?? "";
      // Sized or bare, a box without its own min-h/min-w is drawn at index.css's 44px floor.
      const hasMin = /(^|\s)min-h-/.test(cls) && /(^|\s)min-w-/.test(cls);
      if (!hasMin) inflated.push(`${path.relative(ROOT, file)}#${n}`);
    }
  }
  return { inflated, inputs };
}

describe("native checkboxes and radios are drawn at their own size, not the 44px touch floor", () => {
  const { inflated, inputs } = scan();
  it("finds the inputs (the parser works)", () => {
    expect(inputs).toBeGreaterThan(4);
  });
  it("no new inflated box", () => {
    expect(inflated.filter((k) => !KNOWN.has(k))).toEqual([]);
  });
  it("fixed: delete from KNOWN", () => {
    expect([...KNOWN].filter((k) => !inflated.includes(k))).toEqual([]);
  });
});
