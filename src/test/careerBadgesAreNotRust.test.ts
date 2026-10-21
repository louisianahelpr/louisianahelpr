// Rust is money only (spec v2 §1.1). The career-milestone chips on a public
// profile (board 40) take their tint from careerLadder colours, and
// "Neighborhood Pro" was rust (lead, 2026-10-21, from a /user/:id shot).
// @mutate src/lib/careerLadder.ts |     color: "hsl(var(--bark))", |     color: "hsl(var(--burnt-sienna))",
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const SRC = blankComments(readFileSync(resolve(__dirname, "../lib/careerLadder.ts"), "utf8"));

describe("career milestone chips are never rust", () => {
  it("no milestone colour is a money token", () => {
    const colors = [...SRC.matchAll(/\bcolor:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(colors.length).toBeGreaterThan(5);
    expect(colors.filter((c) => /--burnt-sienna|--money|--sienna|--rust/.test(c))).toEqual([]);
  });
});
