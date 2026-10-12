/**
 * VirtualList's `listAriaLabel` names the list (role="list" + aria-label) and
 * marks each row wrapper role="listitem"; without it the container stays a
 * plain div. /admin?view=people passes "People", which is also the name the
 * button-geometry sweep's EXEMPT_PARENTS matches (a11y-webkit-prod run
 * 38181875379, 2026-10-12: its cards are 74 vs 66px by design; see
 * e2e/happy-path/buttonGeometry.ts).
 *
 * @mutate src/components/VirtualList.tsx |   return label ? { role: "list", "aria-label": label } : {}; |   return {};
 * @mutate src/components/admin/AdminUsers.tsx |           listAriaLabel="People" |           listAriaLabel={undefined}
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { VirtualList } from "@/components/VirtualList";
import { blankComments } from "./helpers/blankNonCode";

describe("VirtualList names its list when asked", () => {
  it("listAriaLabel makes the container a named list", () => {
    render(<VirtualList items={["a", "b"]} getKey={(s) => s} renderItem={(s) => <span>{s}</span>} listAriaLabel="People" />);
    expect(screen.getByRole("list", { name: "People" })).toBeInTheDocument();
  });

  it("without it, no list role is claimed", () => {
    render(<VirtualList items={["a"]} getKey={(s) => s} renderItem={(s) => <span>{s}</span>} />);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("the admin people list passes the name the geometry exemption matches", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../components/admin/AdminUsers.tsx"), "utf8"));
    expect(src).toMatch(/listAriaLabel="People"/);
    const geo = readFileSync(resolve(__dirname, "../../e2e/happy-path/buttonGeometry.ts"), "utf8");
    expect(geo).toContain(`sel: '[role="list"][aria-label="People"]'`);
  });
});
