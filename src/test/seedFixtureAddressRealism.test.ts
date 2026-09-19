/**
 * A SEEDED JOB MAY NOT CARRY A TOWN WHERE AN ADDRESS BELONGS.
 *
 * Owner, 2026-09-19: "When i click directions, it gives directions to the town
 * but not the actual address."
 *
 * Nothing in the app was broken. `src/pages/postjob/jobSubmitHelpers.ts` writes
 * `"<street>, <city>, <state> <zip>"`; `DirectionsButton` hands that string to
 * `mapsSearchUrl()` (deliberately the ADDRESS, never the coordinates of
 * somebody's front door); `user_may_see_job_address` had already released the
 * full column to the viewer, and `JobAddressLine` prints it. The row the owner
 * tapped just had no street in it. Live on prod that day: 210 of 257 seeded
 * jobs said "Lafayette, LA" / "Baton Rouge, LA" and nothing more, because that
 * is what every seed generator wrote.
 *
 * THIS IS THE THIRD BUG REPORT IN ONE DAY manufactured by a fixture that does
 * not look like real data — the others were a contested job with no
 * `job_tracking` row ("the map is gone") and an `in_progress` job with no
 * confirmation stamps ("the tracker is broken"). A backfill fixes the rows that
 * exist; this fixes the class, by refusing to let a generator write a town
 * again.
 *
 * THE INVENTORY IS DERIVED FROM THE WORLD, not listed here: every file under
 * `scripts/` that writes a `jobs` row carrying `is_seed`. Add a new seed
 * generator and it is checked the moment it lands; the floors below exist so an
 * empty or broken scan fails loudly instead of passing vacuously (the class
 * `scripts/vacuity` calls (a)).
 *
 * @mutate scripts/audit/prod-seed.mjs | const SEED_JOB_ADDRESS = "2000 Johnston St, Lafayette, LA 70503" | const SEED_JOB_ADDRESS = "Lafayette, LA"
 * @mutate scripts/probes/mint-funded-seed-jobs.prod.mjs | location: "1011 Ryan St, Lake Charles, LA 70601" | location: "Lake Charles, LA"
 * @mutate scripts/probes/lib/seedAddresses.mjs | ["1125 Jackson St, Alexandria, LA 71301", 31.305, -92.452] | ["Alexandria, LA", 31.305, -92.452]
 * @mutate scripts/probes/completion-race.prod.mjs | location: "4412 Highland Rd, Baton Rouge, LA 70808" | location: "Baton Rouge, LA"
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { hasStreetAddress } from "@/components/activity/appliedJobCard/JobAddressLine";
// @ts-expect-error — plain .mjs script, no type declarations. Same convention as
// src/test/writeContract.test.ts importing scripts/audit/write-contract.mjs. Kept
// on ONE line because the directive must sit on the line TypeScript reports, and a
// multi-line import reports on its `from` clause. Importing the REAL module is the
// point of this guard: it proves the script's own transcription of hasStreetAddress
// answers identically to the component's, so a .d.ts stub would defeat the check.
import { ADDRESSES, cityKey, inLouisiana, hasStreetAddress as scriptHasStreetAddress } from "../../scripts/probes/lib/seedAddresses.mjs";

const REPO = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(mjs|js|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Every seed-job generator, found by what it DOES rather than by name: it
 * mentions `is_seed` and it writes a `jobs` row.
 */
function generatorFiles(): string[] {
  return walk(path.join(REPO, "scripts"))
    .filter((f) => {
      const src = fs.readFileSync(f, "utf8");
      return src.includes("is_seed") && /["'`]jobs["'`]|jobs\?|rest\("jobs/.test(src);
    })
    .map((f) => path.relative(REPO, f))
    .sort();
}

/**
 * Walk out from `idx` to the object literal that encloses it.
 *
 * Needed because a bare `location:` scan cannot tell a JOB's location from a
 * PROFILE's — `scripts/audit/prod-seed.mjs` writes both, and a profile
 * legitimately stores "Lafayette, LA" because a profile is a person, not a
 * doorstep. The enclosing object is the honest discriminator: a job row carries
 * `category` / `budget` / `date_needed` / `payment_status` / `customer_id`, and
 * the profile patch carries none of them.
 */
function enclosingObject(src: string, idx: number): string {
  let depth = 0;
  let start = idx;
  for (let i = idx; i >= 0; i--) {
    const c = src[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }
  depth = 0;
  let end = src.length;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  return src.slice(start, end);
}

const JOB_KEYS = /\b(category|budget|date_needed|payment_status|customer_id|parish)\s*:/;

type Found = { file: string; location: string; latitude?: number; longitude?: number };

/**
 * Every job location a seed generator can write, with the coordinates it writes
 * beside it.
 *
 * `location:` may name a constant rather than a literal (prod-seed.mjs keeps
 * one `SEED_JOB_ADDRESS` for all four of its job rows), so a single level of
 * `const X = "…"` indirection is resolved in the same file.
 *
 * It may also FORWARD one that has already been counted: mint-funded's
 * `location: l.location` copies the entry out of its own `LISTINGS` catalogue,
 * every member of which this scan already read as a literal. A member
 * expression is therefore accepted only when its file also yielded a literal —
 * otherwise it is an unread location, not a re-read one.
 *
 * Anything else is reported through `unresolved` and fails the inventory
 * assertion rather than being silently skipped: a scan that quietly drops what
 * it cannot read is the vacuous kind.
 */
function jobLocations(): { found: Found[]; unresolved: string[] } {
  const found: Found[] = [];
  const unresolved: string[] = [];
  for (const rel of generatorFiles()) {
    const src = fs.readFileSync(path.join(REPO, rel), "utf8");
    const forwarded: string[] = [];
    for (const m of src.matchAll(/\blocation\s*:\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)?|"[^"]*"|'[^']*'|`[^`]*`)/g)) {
      const obj = enclosingObject(src, m.index!);
      if (!JOB_KEYS.test(obj)) continue; // a profile's location, not a job's
      const raw = m[1];
      if (!/^["'`]/.test(raw) && raw.includes(".")) {
        forwarded.push(`${rel}: location: ${raw}`);
        continue;
      }
      const konst = /^["'`]/.test(raw)
        ? null
        : new RegExp(`\\b(?:const|let|var)\\s+${raw}\\s*=\\s*"([^"]*)"`).exec(src);
      const value: string | null = /^["'`]/.test(raw) ? raw.slice(1, -1) : (konst ? konst[1] : null);
      if (value === null) { unresolved.push(`${rel}: location: ${raw}`); continue; }
      const lat = /\blatitude\s*:\s*(-?\d+(?:\.\d+)?)/.exec(obj);
      const lng = /\blongitude\s*:\s*(-?\d+(?:\.\d+)?)/.exec(obj);
      found.push({
        file: rel,
        location: value,
        latitude: lat ? Number(lat[1]) : undefined,
        longitude: lng ? Number(lng[1]) : undefined,
      });
    }
    // A forward is only a forward if this file actually declared something to
    // forward. If it declared nothing, that `X.location` is a location this
    // scan never read, and saying so is the whole point of `unresolved`.
    if (forwarded.length && !found.some((f) => f.file === rel)) unresolved.push(...forwarded);
  }
  return { found, unresolved };
}

describe("seed generators write addresses, not towns", () => {
  // THE FLOOR. Six generators and thirteen job locations existed on
  // 2026-09-19. A scan that finds fewer has broken, not improved.
  const FILE_FLOOR = 5;
  const LOCATION_FLOOR = 10;

  it("finds the seed generators and their job locations (non-empty inventory)", () => {
    const files = generatorFiles();
    expect(files.length).toBeGreaterThanOrEqual(FILE_FLOOR);
    const { found, unresolved } = jobLocations();
    expect(unresolved, `unresolved job location(s):\n${unresolved.join("\n")}`).toEqual([]);
    expect(found.length).toBeGreaterThanOrEqual(LOCATION_FLOOR);
    // And the discriminator works: at least one generator also writes a
    // NON-job location (prod-seed.mjs's profile patch), so a scan that gave up
    // and took every `location:` would be caught by the profile city failing
    // the street-address assertion below.
    const prodSeed = fs.readFileSync(path.join(REPO, "scripts/audit/prod-seed.mjs"), "utf8");
    expect(prodSeed).toMatch(/location:\s*"Lafayette, LA"/);
  });

  it("every job location a seed generator can write is a street address", () => {
    const { found } = jobLocations();
    const towns = found.filter((f) => !hasStreetAddress(f.location));
    expect(
      towns,
      "a seeded job whose `location` is only a town sends Directions to the middle " +
        "of the parish, and reads to the owner as a broken app:\n" +
        towns.map((t) => `  ${t.file}: ${JSON.stringify(t.location)}`).join("\n"),
    ).toEqual([]);
  });

  it("every city a generator uses has a repair address, and every coordinate pair is in Louisiana", () => {
    const { found } = jobLocations();
    const missing = found
      .map((f) => cityKey(f.location))
      .filter((k): k is string => !!k)
      .filter((k) => !(k in ADDRESSES));
    // Inventory minus checked must be empty: a generator that reaches a city
    // the repair tool has never heard of leaves rows nothing can fix.
    expect(missing, `no ADDRESSES entry for: ${[...new Set(missing)].join(", ")}`).toEqual([]);

    const offState = found.filter(
      (f) => f.latitude !== undefined && f.longitude !== undefined && !inLouisiana(f.latitude, f.longitude),
    );
    expect(offState.map((f) => `${f.file}: ${f.location}`)).toEqual([]);
  });
});

describe("the repair catalogue is real and self-consistent", () => {
  const entries = Object.entries(ADDRESSES) as [string, [string, number, number][]][];

  it("is non-empty and every entry is a street address in the city it is filed under", () => {
    expect(entries.length).toBeGreaterThanOrEqual(8);
    const flat = entries.flatMap(([city, list]) => list.map((e) => [city, ...e] as const));
    expect(flat.length).toBeGreaterThanOrEqual(15);
    for (const [city, address] of flat) {
      expect(hasStreetAddress(address), `${address} is not a street address`).toBe(true);
      expect(cityKey(address), `${address} is filed under ${city}`).toBe(city);
    }
  });

  it("every catalogue point is in Louisiana", () => {
    for (const [, list] of entries) {
      for (const [address, lat, lng] of list) {
        expect(inLouisiana(lat, lng), `${address} at ${lat},${lng} is outside Louisiana`).toBe(true);
      }
    }
  });

  it("the script's transcription of hasStreetAddress answers exactly as the card's does", () => {
    // The operator script cannot import the TSX component, so it copies the
    // predicate. A copy that drifts would repair rows the card still refuses to
    // print. Cases span both clauses (digit in the first segment; a comma at
    // all) and the shapes prod actually held.
    const cases = [
      "215 E Main St, New Iberia, LA 70560",
      "Lafayette, LA",
      "Baton Rouge, LA",
      "100 Audit Way, Baton Rouge, LA 99999",
      "70503",
      "",
      "Apt 4, Lafayette, LA",
      "PO Box 12, Houma, LA 70360",
      null,
      undefined,
    ];
    for (const c of cases) {
      expect(scriptHasStreetAddress(c), `disagreement on ${JSON.stringify(c)}`).toBe(hasStreetAddress(c));
    }
  });
});
