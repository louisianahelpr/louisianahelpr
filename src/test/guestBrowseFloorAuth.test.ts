import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// @mutate e2e/journeys/01-browse.spec.ts | headers: { apikey: ANON, Prefer: | headers: { apikey: ANON, Authorization: ANON, Prefer:

const browse = readFileSync(resolve(process.cwd(), "e2e/journeys/01-browse.spec.ts"), "utf8");
const fundedFloor = browse.match(/async function fundedFloor\(api: APIRequestContext\): Promise<number> \{[\s\S]*?\n\}/)?.[0] ?? "";

describe("guest browse floor request", () => {
  it("uses the publishable key only as an API key", () => {
    expect(fundedFloor).toMatch(/headers:\s*\{\s*apikey:\s*ANON\b/);
    expect(fundedFloor).not.toMatch(/\bAuthorization\s*:/);
  });
});
