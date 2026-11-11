/**
 * Audit 11-10 W5 F478: the staged photo's red remove X was drawn 44px wide, half over the 80px thumbnail and bigger
 * than it looked (shot chat-photo-sent-P-375-light). The button set `w-5 h-5` but no min-size, so the global 44px
 * button floor (index.css, `:where(button…) { min-height: 44px; min-width: 44px }`) won. It is now a 28px disc at the
 * thumbnail's top-right corner with its own explicit 28px min-size, and keeps a 44px hit target as an ::after halo.
 *
 * @mutate src/components/RichMessageInput.tsx | h-7 w-7 min-h-[28px] min-w-[28px] rounded-full bg-destructive | h-7 w-7 rounded-full bg-destructive
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const code = blankComments(readFileSync(join(__dirname, "..", "components", "RichMessageInput.tsx"), "utf8"));

describe("F478: the staged photo's remove X is a 28px disc at the corner", () => {
  const button = /<button\s+onClick=\{clearStaged\}\s+className="([^"]*)"/.exec(code);
  const cls = button?.[1] ?? "";

  it("finds the remove button", () => {
    expect(button).toBeTruthy();
  });
  it("states a 28px min-size, so the 44px button floor cannot inflate it", () => {
    expect(cls.split(/\s+/)).toContain("min-h-[28px]");
    expect(cls.split(/\s+/)).toContain("min-w-[28px]");
    expect(cls).toMatch(/\bh-7\b/);
    expect(cls).toMatch(/\bw-7\b/);
  });
  it("sits at the thumbnail corner and keeps a 44px halo for the finger", () => {
    expect(cls).toMatch(/\B-top-2\b/);
    expect(cls).toMatch(/\B-right-2\b/);
    expect(cls).toMatch(/after:h-11/);
    expect(cls).toMatch(/after:w-11/);
  });
});
