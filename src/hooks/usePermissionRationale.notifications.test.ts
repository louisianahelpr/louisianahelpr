/**
 * Audit 2026-10-29 A2-C24: the notifications sheet, which Browse also opens for someone looking for
 * work, spoke only to posters ("when a Helpr applies…"). Its body now covers both sides.
 *
 * @mutate src/hooks/usePermissionRationale.ts | Get notified about new jobs near you, messages, and updates on jobs you've posted or are working. | Get notified when a Helpr applies, sends a message, or marks your job complete.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(path.join(process.cwd(), "src/hooks/usePermissionRationale.ts"), "utf8");

describe("the notifications sheet speaks to Helprs and posters (A2-C24)", () => {
  it("names new jobs near you and both sides' jobs, not only applicants", () => {
    expect(src).toContain("Get notified about new jobs near you, messages, and updates on jobs you've posted or are working.");
    expect(src).not.toContain("Get notified when a Helpr applies");
  });
});
