/**
 * VN-27 (owner, 2026-09-14): "remove the grey background from the location".
 *
 * The press-to-map location control on the activity card meta row wore a
 * resting tinted fill and border, so it read as a grey box beside plain
 * date/time text. At rest it must carry no background or border class; the
 * hover/active feedback and the 44px hit-area overhang stay.
 *
 * WHAT THIS CAN AND CANNOT SEE. jsdom computes no layout and resolves no
 * Tailwind, so `getComputedStyle(chip).backgroundColor` here is `""` no matter
 * what the class says. This is therefore a CLASS CONTRACT check and nothing
 * more: it proves no resting `bg-*`/`border*` utility is on the element, not
 * that the painted pixel is transparent. A grey box arriving by some other
 * route — an inline `style`, a parent's `[&>button]:bg-…`, a plain CSS rule in
 * index.css — is invisible to it. The `style` attribute is checked too, since
 * that one IS readable in jsdom and is the nearest escape hatch.
 *
 * Fails on the original `border border-[…] bg-[hsl(var(--olivewood)/0.06)]`.
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
    // Any UNPREFIXED fill or border utility — `bg-…`, bare `border`,
    // `border-[…]` AND `border-olivewood/20`, which the first version of this
    // regex (`border$|border-\[`) let through. Variants (`hover:`, `active:`,
    // `dark:`) are not resting chrome and are required below.
    const resting = classes.filter((c) => /^(bg-|border($|-|_))/.test(c));
    expect(resting, `resting chrome on the location chip: ${resting.join(" ")}`).toEqual([]);
    // The one appearance fact jsdom CAN read: an inline background or border
    // would reinstate the grey box without touching a single class.
    const inline = chip.getAttribute("style") ?? "";
    expect(inline, `inline chrome on the location chip: ${inline}`).not.toMatch(
      /(^|;)\s*(background|border)/,
    );
    for (const keep of ["py-2", "-my-2", "px-1", "-mx-1"]) {
      expect(classes, `lost hit-area class ${keep}`).toContain(keep);
    }
    expect(classes.some((c) => c.startsWith("hover:bg-")), "lost hover feedback").toBe(true);
    expect(classes.some((c) => c.startsWith("active:")), "lost press feedback").toBe(true);
  });
});

// @mutate src/components/activity/JobCardMetaRow.tsx | px-1 -mx-1 rounded-ds-sm hover:bg- | px-1 -mx-1 rounded-ds-sm border border-[hsl(var(--olivewood)/0.18)] bg-[hsl(var(--olivewood)/0.06)] hover:bg-
//
// The two escape hatches the FIRST version of this guard could not see, each
// registered so the widened checks above stay load-bearing. A named border
// utility slipped past `border$|border-\[`, and an inline background was not
// looked at at all — both put the grey box back with every assertion green.
// @mutate src/components/activity/JobCardMetaRow.tsx | rounded-ds-sm hover:bg- | rounded-ds-sm border-2 border-olivewood hover:bg-
// @mutate src/components/activity/JobCardMetaRow.tsx | hold for the map`} | hold for the map`} style={{ background: "hsl(var(--olivewood) / 0.06)" }}
