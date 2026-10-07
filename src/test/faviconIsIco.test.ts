/**
 * Q965 — /favicon.ico is an actual ICO file.
 *
 * It was a bare 48x48 PNG renamed .ico (`file public/favicon.ico` -> "PNG image
 * data", and the same bytes served from www, measured 2026-10-07). Browsers
 * and crawlers that request /favicon.ico by convention expect the ICO
 * container (header 00 00 01 00). Now an ICO holding the same artwork at 16,
 * 32 and 48 px.
 *
 * The bug's own shape, a PNG at that path, must fail it: the mutation points
 * the guard at public/favicon-32.png.
 * @mutate src/test/faviconIsIco.test.ts | "public/favicon.ico"));\n | "public/favicon-32.png"));\n
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("public/favicon.ico is an ICO container (Q965)", () => {
  const bytes = readFileSync(join(process.cwd(), "public/favicon.ico"));

  it("has the ICO header and at least one image", () => {
    expect(bytes.length).toBeGreaterThan(100);
    expect([...bytes.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    expect(bytes.readUInt16LE(4)).toBeGreaterThanOrEqual(1);
  });

  it("is not a bare PNG", () => {
    expect(bytes.subarray(1, 4).toString("latin1")).not.toBe("PNG");
  });
});
