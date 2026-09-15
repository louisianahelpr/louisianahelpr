/**
 * VN-27 (owner, 2026-09-14): "remove the grey background from the location".
 *
 * The press-to-map location control on the activity card meta row wore a
 * resting tinted fill and border, so it read as a grey box beside plain
 * date/time text. At rest it must carry no background or border class; the
 * hover/active feedback and the 44px hit-area overhang stay.
 *
 * jsdom has no layout or Tailwind, so this asserts the class contract. Fails on
 * the original `border border-[…] bg-[hsl(var(--olivewood)/0.06)]` string.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobCardMetaRow } from "./JobCardMetaRow";

describe("JobCardMetaRow location chip at rest (VN-27)", () => {
  it("has no resting fill or border, but keeps hit area and press feedback", () => {
    render(
      <JobCardMetaRow
        dateNeeded="2026-09-15"
        startTime={null}
        location="215 E Main St, Lafayette, LA 70501"
        locationPressToMap
      />,
    );
    const chip = screen.getByRole("button", { name: /Lafayette — tap to expand this job/ });
    const classes = [...chip.classList];
    const resting = classes.filter((c) => /^(bg-|border$|border-\[)/.test(c));
    expect(resting, `resting chrome on the location chip: ${resting.join(" ")}`).toEqual([]);
    for (const keep of ["py-2", "-my-2", "px-1", "-mx-1"]) {
      expect(classes, `lost hit-area class ${keep}`).toContain(keep);
    }
    expect(classes.some((c) => c.startsWith("hover:bg-")), "lost hover feedback").toBe(true);
    expect(classes.some((c) => c.startsWith("active:")), "lost press feedback").toBe(true);
  });
});
