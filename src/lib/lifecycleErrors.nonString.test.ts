import { describe, expect, it } from "vitest";
import { lifecycleErrorMessage } from "./lifecycleErrors";

// @mutate src/lib/lifecycleErrors.ts | const raw = typeof message === "string" ? message : ""; | const raw = (message ?? "") as string;
describe("lifecycleErrorMessage never throws on an odd error shape", () => {
  it("returns null for a non-string message instead of throwing", () => {
    expect(lifecycleErrorMessage({ message: 42 })).toBeNull();
    expect(lifecycleErrorMessage({ message: { nested: true } })).toBeNull();
  });
  it("still reads a string message", () => {
    expect(lifecycleErrorMessage(null)).toBeNull();
    expect(lifecycleErrorMessage({ message: "" })).toBeNull();
  });
});
