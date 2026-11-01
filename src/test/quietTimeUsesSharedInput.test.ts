/**
 * The quiet-hours "From / to" time fields are the shared Input at its standard height (lead decision 10-31 for the
 * shared-control sweep; B44). They were a hand-made 11px pill (`px-2 py-1 text-ds-11`, 35px tall). Measured on
 * /profile?tab=notifications (headless Chromium, mocked session): 375 -> 48px tall, 149 wide, no horizontal overflow
 * (the two fields already wrapped onto two lines at 375 before, at the same x); 1440 -> 48px, one line.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

// @mutate src/components/notificationPreferences/QuietTimeInput.tsx |       <Input |       <input
// @mutate src/components/notificationPreferences/QuietTimeInput.tsx |         className="w-auto min-w-0 font-mono tabular-nums" |         className="h-9 w-auto min-w-0 font-mono tabular-nums"

const src = blankComments(readFileSync(resolve(__dirname, "../components/notificationPreferences/QuietTimeInput.tsx"), "utf8"));

describe("quiet-hours time field", () => {
  it("is the shared Input with no size of its own but its width", () => {
    expect(src).toMatch(/import \{ Input \} from "@\/components\/ui\/input"/);
    expect(src).not.toMatch(/<input\b/);
    const tags = [...src.matchAll(/<Input\b[\s\S]*?\/>/g)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) {
      expect(t).toMatch(/type="time"/);
      expect(t).not.toMatch(/\b(?:min-)?h-(?:\d|\[)|\bpy-|\btext-ds-|\brounded-/);
    }
  });
});
