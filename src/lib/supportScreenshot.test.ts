// @mutate src/lib/supportScreenshot.ts | candidate.startsWith(`${reporterId}/support/`) && | true &&
import { describe, expect, it } from "vitest";
import {
  splitSupportScreenshot,
  supportScreenshotPath,
  withSupportScreenshot,
} from "./supportScreenshot";

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("support ticket screenshot line", () => {
  it("round-trips the path the writer stores", () => {
    const path = supportScreenshotPath(ME, "png", 1700000000000);
    const desc = withSupportScreenshot("It broke", path);
    expect(splitSupportScreenshot(desc, ME)).toEqual({ body: "It broke", path });
  });

  it("stores no line when there is no screenshot", () => {
    expect(withSupportScreenshot("It broke", null)).toBe("It broke");
    expect(splitSupportScreenshot("It broke", ME)).toEqual({ body: "It broke", path: null });
  });

  it("refuses a path outside the reporter's own support folder", () => {
    for (const p of [
      `${OTHER}/support/1.png`,
      `${OTHER}/credentials/id.png`,
      `${ME}/credentials/id.png`,
      `${ME}/support/../../${OTHER}/id.png`,
      `${ME}/support/%2e%2e/%2E%2e/${OTHER}/credentials/id.png`,
      `${ME}/support/1.png/../../../${OTHER}/id.png`,
      `${ME}/support/1.png?x=1`,
      "https://x.supabase.co/storage/v1/object/sign/user-documents/a.png?token=t",
    ]) {
      const desc = `Hi\n\nScreenshot: ${p}`;
      expect(splitSupportScreenshot(desc, ME), p).toEqual({ body: desc, path: null });
    }
  });

  it("offers no path on a ticket whose reporter is gone", () => {
    const desc = withSupportScreenshot("Hi", supportScreenshotPath(ME, "png", 1));
    expect(splitSupportScreenshot(desc, null)).toEqual({ body: desc, path: null });
  });
});
