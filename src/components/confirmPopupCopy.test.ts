import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Owner wording decisions, 2026-09-14 (pop-up, visual-notes follow-ups).
 *
 * The Helpr's Mark Job Complete confirm read "Request Your Payout?" with a
 * "Yes, I'm Done" button: the card says Mark Job Complete, the popup it
 * opens talked about money. Now "Mark This Job Complete?" / "Mark Complete".
 *
 * Read from source because the strings live in JSX props deep inside
 * components that need a job, a session and a tracker to render.
 */
const src = (f: string) => readFileSync(resolve(__dirname, f), "utf8");

describe("Mark Job Complete confirm popup", () => {
  const tracking = src("JobTracking.tsx");

  it("asks to mark the job complete, not to request a payout", () => {
    expect(tracking).toContain('title="Mark This Job Complete?"');
    expect(tracking).toContain('primaryLabel="Mark Complete"');
    expect(tracking).not.toContain("Request Your Payout?");
    expect(tracking).not.toMatch(/Yes, I['’]m Done/);
  });
});
