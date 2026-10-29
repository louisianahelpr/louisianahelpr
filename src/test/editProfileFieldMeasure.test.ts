/**
 * App audit 2026-10-29 (A3-L2): at 1440 Edit profile's phone box ran 1102px
 * for ten digits (Area 990px). The page column stays full width (owner
 * 2026-10-21, src/lib/pageColumn.ts, guarded by onePageColumn.test.ts), so
 * the short fields carry their own FIELD measure: an unprefixed max-w on the
 * field, never a breakpoint page measure. Measured after at 1440: phone 352px;
 * 375 unchanged (phone 301px, the column's width).
 */
// @mutate src/components/profile/ProfileEditForm.tsx |             <div className={SHORT_FIELD_MEASURE}> |             <div>
// @mutate src/components/profile/ProfileEditForm.tsx |  gap-3 ${AREA_FIELD_MEASURE}`}> |  gap-3`}>
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { readSource } from "./helpers/walkSource";
import { AREA_FIELD_MEASURE, SHORT_FIELD_MEASURE } from "@/components/profile/ProfileEditForm";

const form = blankComments(readSource("src/components/profile/ProfileEditForm.tsx") ?? "");

/** The opening tag of the element that wraps the label for `id`. */
function wrapperOf(id: string): string {
  const at = form.indexOf(`<Label htmlFor="${id}"`);
  const open = form.lastIndexOf("<div", at);
  return at > 0 && open > 0 ? form.slice(open, form.indexOf(">", open) + 1) : "";
}

describe("Edit profile's short fields are sized to what they hold (A3-L2)", () => {
  it("the measures are field caps, never a breakpoint page measure", () => {
    for (const m of [SHORT_FIELD_MEASURE, AREA_FIELD_MEASURE]) {
      expect(m).toMatch(/^max-w-\[\d+(?:\.\d+)?rem\]$/);
    }
  });

  it("the phone field and the Area + ZIP row carry them", () => {
    const phone = wrapperOf("phone");
    expect(phone.length).toBeGreaterThan(4);
    expect(phone).toContain("SHORT_FIELD_MEASURE");
    const areaRow = form.slice(form.lastIndexOf("<div className={`grid", form.indexOf('<Label htmlFor="location"')), form.indexOf('<Label htmlFor="location"'));
    expect(areaRow).toContain("${AREA_FIELD_MEASURE}");
  });
});
