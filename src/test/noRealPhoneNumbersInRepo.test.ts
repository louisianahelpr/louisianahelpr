/**
 * CLASS GUARD (NL-01, 2026-11-23): no real person's phone number in this
 * PUBLIC repo.
 *
 * The owner's personal cell sat in fastlane/metadata/review_information/
 * phone_number.txt (the App Review contact field) and was copied into a pglite
 * fixture. Owner rule: never publish her phone. The App Review phone now comes
 * from the APP_REVIEW_PHONE secret (fastlane/Fastfile stage_review_phone!), the
 * file is gitignored, and fixtures use the fictional 555 exchange.
 *
 * Inventory from source: every file git tracks (git ls-files), binaries and
 * the npm lockfile skipped. Comments are NOT blanked on purpose: a number in a
 * comment is just as public. A hit is a North American number written the way
 * people write phones: a +1 / 1- prefix, (area) parentheses, or separators
 * between all three groups. A bare 10-digit run is not read (timestamps, ids
 * and prices would drown it). Allowed: the fictional 555 exchange (NANP
 * reserves 555-0100..0199; the repo's other 555-xxxx fixtures are unassigned),
 * area code 555, an exchange starting 0 or 1 (not a valid NANP exchange), and
 * the public agency and business lines in PUBLIC_LINES, each with its source.
 */
// @mutate src/test/pglite/phoneAddedLater.pglite.mjs | VALUES ('55555555-0000-0000-0000-0000000000e1', '3375550142') | VALUES ('55555555-0000-0000-0000-0000000000e1', '1-211-2345678')
// @mutate fastlane/Fastfile |   UI.user_error!("APP_REVIEW_PHONE is not set |   return if true\n  UI.user_error!("APP_REVIEW_PHONE is not set
// @mutate .gitignore | \nfastlane/metadata/review_information/phone_number.txt\n | \n
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

/** Public government/agency lines quoted in specs (digits only), each found on the agency's own site. */
const PUBLIC_LINES: Record<string, string> = {
  "2252958420": "Louisiana Auctioneers Licensing Board, docs/specs/declutter-auctions.md (lalb.org)",
  "2259251923": "Louisiana Real Estate Commission, docs/specs/landlord-hub-prep.md",
  "2259253772": "LDAF egg program, docs/specs/local-shops-prep.md",
  "2252293341": "Freddie Lee Phillips auction school (Baton Rouge), a business line from the board's approved-schools list, docs/specs/declutter-auctions.md",
};

/** The planted value this guard's own @mutate and fixtures use: area code 211 is an N11 service code, never assigned, so it is no one's number. Allowed only in this file. */
const SELF_TEST = "2112345678";
const SELF = "src/test/noRealPhoneNumbersInRepo.test.ts";

const PHONE = /(?<![\w./=%#-])(\+?1[-. ]?)?(\()?([2-9]\d{2})(\))?([-. ]?)([2-9]\d{2})([-. ]?)(\d{4})(?![\w-])/g;

export function phoneHits(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PHONE)) {
    const [, prefix, open, area, close, sep1, exch, sep2, line] = m;
    const formatted = Boolean(prefix) || (open === "(" && close === ")") || (sep1 !== "" && sep2 !== "");
    if (!formatted) continue;
    if (open && !close) continue;
    if (exch === "555" || area === "555") continue;
    const digits = `${area}${exch}${line}`;
    if (PUBLIC_LINES[digits]) continue;
    out.push(digits);
  }
  return out;
}

function trackedRepoFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  return out.split("\0").filter(Boolean);
}

const SKIP = /(^|\/)package-lock\.json$|\.(png|jpe?g|gif|webp|ico|icns|pdf|mp4|mov|woff2?|ttf|otf|zip|gz|p12|keystore|jar|car|heic|avif)$/i;

describe("no real phone number in the public repo (NL-01)", () => {
  it("the detector catches every written form, and lets fictional/public numbers through", () => {
    const [a, x, l] = ["211", "234", "5678"];
    for (const s of [`1-${a}-${x}${l}`, `+1 ${a} ${x} ${l}`, `(${a}) ${x}-${l}`, `${a}-${x}-${l}`, `${a}.${x}.${l}`, `+1${a}${x}${l}`]) {
      expect(phoneHits(`call ${s} now`), s).toEqual([SELF_TEST]);
    }
    for (const s of ["(337) 555-0142", "337-555-0199", "555-123-4567", "20261123120000", `${a}${x}${l}`, "(225) 295-8420", "337-000-0000", `id-${a}-${x}-${l}x`]) {
      expect(phoneHits(`call ${s} now`), s).toEqual([]);
    }
  });

  it("no tracked file holds a real phone number", () => {
    const files = trackedRepoFiles().filter((f) => !SKIP.test(f));
    expect(files.length).toBeGreaterThan(5000);
    const offenders: string[] = [];
    let read = 0;
    for (const f of files) {
      const p = resolve(ROOT, f);
      if (!existsSync(p) || statSync(p).size > 4_000_000) continue;
      const buf = readFileSync(p);
      if (buf.includes(0)) continue;
      read += 1;
      const hits = phoneHits(buf.toString("utf8")).filter((h) => !(f === SELF && h === SELF_TEST));
      // Never print the number, not even a tail: the file and a count only.
      if (hits.length) offenders.push(`${f}: ${hits.length} phone number(s)`);
    }
    expect(read).toBeGreaterThan(5000);
    expect(offenders, "a real-looking phone number is tracked; use the 555-01xx fictional range or a secret").toEqual([]);
  });

  it("the App Review phone is staged from the secret, never tracked", () => {
    expect(existsSync(resolve(ROOT, "fastlane/metadata/review_information/phone_number.txt")) && trackedRepoFiles().includes("fastlane/metadata/review_information/phone_number.txt")).toBe(false);
    expect(readFileSync(resolve(ROOT, ".gitignore"), "utf8")).toMatch(/^fastlane\/metadata\/review_information\/phone_number\.txt$/m);
    const fastfile = readFileSync(resolve(ROOT, "fastlane/Fastfile"), "utf8");
    // The secret is read and an empty one stops the lane before anything else runs.
    expect(fastfile).toMatch(/def stage_review_phone!\(staged_metadata_dir\)\n {2}phone = ENV\["APP_REVIEW_PHONE"\]\.to_s\.strip\n {2}UI\.user_error!\("APP_REVIEW_PHONE is not set[^\n]*\) if phone\.empty\?\n/);
    // Both deliver lanes (metadata + release) stage it.
    expect(fastfile.match(/^\s+stage_review_phone!\(staged_metadata_dir\)$/gm)?.length).toBe(2);
    for (const wf of [".github/workflows/deploy.yml", ".github/workflows/ios-metadata.yml"]) {
      expect(readFileSync(resolve(ROOT, wf), "utf8"), wf).toMatch(/APP_REVIEW_PHONE: \$\{\{ secrets\.APP_REVIEW_PHONE \}\}/);
    }
  });
});
