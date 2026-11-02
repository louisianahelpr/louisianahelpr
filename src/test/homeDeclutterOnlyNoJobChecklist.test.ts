/**
 * A3-82 (audit 11-01): a Declutter-only member (listings or a purchase, no job or application) got the "Get your
 * first job" checklist and the Jobs pay explainer above Next up. useHomeSummary now says when the member uses
 * Declutter (any listing of theirs, any cart line either side: the reads Home already makes), and Home shows the
 * first-job checklist only to a member new to the app on BOTH counts.
 * Also (lead 11-01, the owner's "Remove you take home"): the Helpr delivery view's figure stands alone.
 *
 * @mutate src/pages/home/HomeDashboard.tsx | {firstJob?.isNew && !summary.usesDeclutter && <FirstJobHome | {firstJob?.isNew && <FirstJobHome
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts |       usesDeclutter: items.length > 0 \|\| (cart.data ?? []).length > 0, |       usesDeclutter: false,
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |           <span className="sr-only">Your pay</span> |           <span className="text-ds-15 font-semibold">You take home</span>
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = (rel: string) => blankComments(readFileSync(resolve(__dirname, "../..", rel), "utf8"));

describe("a Declutter-only member never gets the Jobs first-job checklist (A3-82)", () => {
  it("Home gates FirstJobHome on the summary's usesDeclutter", () => {
    const home = read("src/pages/home/HomeDashboard.tsx");
    const gates = home.match(/<FirstJobHome\b/g) ?? [];
    expect(gates.length).toBe(1);
    expect(home).toContain("{firstJob?.isNew && !summary.usesDeclutter && <FirstJobHome");
  });

  it("usesDeclutter reads the member's listings and cart, the reads Home already makes", () => {
    const sum = read("src/pages/home/homeDashboard/useHomeSummary.ts");
    expect(sum).toContain("usesDeclutter: items.length > 0 || (cart.data ?? []).length > 0,");
    expect(sum).toMatch(/const items = declutter\.data \?\? \[\];/);
  });

  it("the Helpr delivery view's figure has no 'You take home' label (a screen reader hears 'Your pay')", () => {
    const v = read("src/components/declutter/DeclutterDeliveryViews.tsx");
    expect(v.length).toBeGreaterThan(1000);
    expect(v).not.toMatch(/You take home/);
    expect(v).toContain('<span className="sr-only">Your pay</span>');
  });
});
