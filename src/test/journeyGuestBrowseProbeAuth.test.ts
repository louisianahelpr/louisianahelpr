import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const browse = readFileSync(join(process.cwd(), "e2e/journeys/01-browse.spec.ts"), "utf8");

describe("guest browse floor probe", () => {
  it("sends the publishable key only as apikey, not as a bearer token", () => {
    const probe = /async function fundedFloor[\s\S]*?\n\}/.exec(browse)?.[0];

    expect(probe, "fundedFloor probe is missing").toBeTruthy();
    expect(probe).toMatch(/headers:\s*\{\s*apikey:\s*ANON\b/);
    expect(probe).not.toMatch(/\bAuthorization\s*:/);
  });
});
