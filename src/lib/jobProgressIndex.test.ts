/**
 * STATUS_IDX (src/lib/jobProgressIndex.ts) must name the tracker's STATUSES in order:
 * deriveCurrentStatusIdx reads a tracking status by STATUS_IDX instead of STATUSES since the
 * split that keeps the tracker out of the chat card's first screen (2026-10-29, bootReach).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { STATUS_IDX } from "@/lib/jobProgressIndex";

const src = readFileSync(path.join(process.cwd(), "src/components/JobTracking.tsx"), "utf8");

describe("STATUS_IDX matches the tracker's steps", () => {
  it("every step's key sits at its STATUS_IDX index", () => {
    const start = src.indexOf("const STATUSES: TrackerStep[] = [");
    const body = src.slice(start, src.indexOf("\n];", start));
    const keys = [...body.matchAll(/\bkey:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(5);
    expect(keys).toEqual(Object.keys(STATUS_IDX));
  });
});
