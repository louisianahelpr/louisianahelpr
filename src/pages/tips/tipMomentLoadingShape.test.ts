// Q2018 (owner, instant feel: skeletons on every loading screen). The tip
// moment showed a centred HelprSpinner while its read was pending; it now draws
// bones in the loaded header's shape (title, amount, job line), the part both
// the Helpr and the tipper see.
// @mutate src/pages/tips/TipMoment.tsx | <Skeleton className="h-10 w-28 rounded-ds-sm" /> | <HelprSpinner />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const src = blankComments(readFileSync(join(process.cwd(), "src/pages/tips/TipMoment.tsx"), "utf8"));

describe("the tip moment loads in its own shape (Q2018)", () => {
  it("the pending branch draws header bones, never the spinner", () => {
    const start = src.indexOf("if (q.isPending)");
    expect(start).toBeGreaterThan(0);
    const end = src.indexOf("if (q.isError)", start);
    expect(end).toBeGreaterThan(start);
    const pending = src.slice(start, end);
    const bones = pending.match(/<Skeleton\b/g) ?? [];
    expect(bones.length).toBeGreaterThan(2);
    expect(pending).not.toMatch(/HelprSpinner|animate-spin/);
    expect(pending).toMatch(/role="status"/);
  });
});
