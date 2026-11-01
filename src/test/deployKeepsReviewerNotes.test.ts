/**
 * The iOS deploy never overwrites the App Review notes (App Store readiness sweep, B48 10-31).
 *
 * deploy.yml's "Generate changelog" step copied the recent commit subjects (git log) over
 * fastlane/metadata/review_information/notes.txt, on every lane. The release lane stages that folder for deliver
 * (allowed_metadata_entries includes review_information), so App Review got a commit list instead of the notes
 * that explain the demo account, the in-person payments and the background location use. TestFlight's "What to
 * Test" already reads the changelog through CHANGELOG_PATH (Fastfile changelog_text).
 *
 * @mutate .github/workflows/deploy.yml |           # TestFlight "What to Test" reads CHANGELOG_PATH (Fastfile changelog_text). Never copy it over |           cp fastlane/changelog.txt fastlane/metadata/review_information/notes.txt\n          #
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankHashComments } from "./helpers/blankNonCode";

const deploy = blankHashComments(readFileSync(".github/workflows/deploy.yml", "utf8"));
const fastfile = blankHashComments(readFileSync("fastlane/Fastfile", "utf8"));
const notes = readFileSync("fastlane/metadata/review_information/notes.txt", "utf8");

describe("the deploy keeps the App Review notes", () => {
  it("reads the real workflow and the real notes", () => {
    expect(deploy).toMatch(/fastlane ios \$\{\{ steps\.resolve\.outputs\.lane \}\}/);
    expect(notes.length).toBeGreaterThan(500);
  });

  it("the release lane uploads review_information, so nothing in the deploy may write into it", () => {
    expect(fastfile).toMatch(/allowed_metadata_entries = %w\[[^\]]*review_information/);
    expect(deploy).not.toMatch(/metadata\/review_information/);
  });

  it("TestFlight still gets the changelog through CHANGELOG_PATH", () => {
    expect(deploy).toMatch(/CHANGELOG_PATH: \$\{\{ steps\.changelog\.outputs\.path \}\}/);
    expect(fastfile).toMatch(/changelog:\s+changelog_text/);
  });
});
