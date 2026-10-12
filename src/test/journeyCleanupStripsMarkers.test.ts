/**
 * Q1505 CLASS GUARD: a journey that appends its run marker to a shared seed
 * field builds on, and restores, the seed value with every marker stripped,
 * never the raw before-image.
 *
 * 2026-10-07: 03-account appended ` Journey <run>.` to the seed Helpr's bio
 * and restored `before.bio`. One run whose cleanup never finished left
 * "Journey eq8jng." behind, every later run restored that polluted text, and
 * a run in flight stacked a second marker. The longer bio made /user/<helper>
 * 27px taller than its skeleton (a false loading-state breach).
 *
 * Inventory: every tracked e2e/ .ts file. A `.fill(` template that carries a
 * journey marker and interpolates another value must interpolate one declared
 * from withoutJourneyMarkers(); such a file must never write `field: before.field`.
 *
 * @mutate e2e/journeys/03-account.spec.ts | data: restorable ? { bio: seedBio, avatar_url: restorable } : { bio: seedBio }, | data: restorable ? { bio: before.bio, avatar_url: restorable } : { bio: before.bio },
 * @mutate e2e/journeys/03-account.spec.ts | await about.fill(`${seedBio ?? ""} ${journeyMarker(RUN)}`.trim()); | await about.fill(`${before.bio ?? ""} ${journeyMarker(RUN)}`.trim());
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { execFileSync } from "node:child_process";
import { journeyMarker, withoutJourneyMarkers } from "../../e2e/journeys/journeyMarkers";

const ROOT = resolve(__dirname, "../..");

/** Offences in one file's source (comments already blanked). */
function offences(code: string): string[] {
  const out: string[] = [];
  const cleaned = new Set([...code.matchAll(/\bconst\s+(\w+)\s*=\s*withoutJourneyMarkers\(/g)].map((m) => m[1]));
  let appends = false;
  for (const m of code.matchAll(/\.fill\(\s*`([^`]*)`/g)) {
    const body = m[1];
    if (!/journeyMarker\(|Journey \$\{/.test(body)) continue;
    for (const i of body.matchAll(/\$\{\s*([\w.]+)/g)) {
      const root = i[1].split(".")[0];
      if (root === "RUN" || root === "journeyMarker") continue;
      appends = true;
      if (!cleaned.has(root)) out.push(`.fill appends a journey marker to \${${i[1]}}, not a withoutJourneyMarkers() value`);
    }
  }
  if (appends) for (const w of code.matchAll(/\b(\w+)\s*:\s*before\.(\w+)\b/g)) if (w[1] === w[2]) out.push(`restores the raw before-image: ${w[0]}`);
  return out;
}

describe("journeys restore seed fields without run markers (Q1505)", () => {
  const files = execFileSync("git", ["ls-files", "e2e"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".ts"));

  it("reads the e2e tree, including the 03-account append", () => {
    // Inventory floor: 03-account is the one append-edit on 2026-10-12.
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("e2e/journeys/03-account.spec.ts");
  });

  it("no e2e file builds on or restores a raw before-image around a run marker", () => {
    const bad = files.flatMap((f) => offences(blankComments(readFileSync(resolve(ROOT, f), "utf8"))).map((o) => `${f}: ${o}`));
    expect(bad).toEqual([]);
  });

  it("the check flags both halves of the 2026-10-07 shape", () => {
    const broken = "const before = await read();\nawait about.fill(`${before.bio} ${journeyMarker(RUN)}`);\npatch({ bio: before.bio });";
    expect(offences(broken)).toEqual([
      ".fill appends a journey marker to ${before.bio}, not a withoutJourneyMarkers() value",
      "restores the raw before-image: bio: before.bio",
    ]);
  });

  it("withoutJourneyMarkers strips every trailing marker and nothing else", () => {
    expect(withoutJourneyMarkers("Seed sentence. Journey eq8jng. Journey y9w0f6.")).toBe("Seed sentence.");
    expect(withoutJourneyMarkers(`Seed sentence. ${journeyMarker("abc123")}`)).toBe("Seed sentence.");
    expect(withoutJourneyMarkers("A Journey to remember.")).toBe("A Journey to remember.");
    expect(withoutJourneyMarkers(null)).toBeNull();
  });
});
