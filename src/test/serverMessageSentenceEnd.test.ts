// @mutate src/lib/endSentence.ts | return /[?!]$/.test(trimmed) ? trimmed : `${trimmed}.`; | return `${trimmed}.`;
// @mutate src/hooks/useFundExistingJob.ts | ${endSentence(message)} The job | ${message}. The job
/**
 * A SERVER MESSAGE ENDING "?" OR "!" NEVER GETS ". " BOLTED ON (Q34).
 *
 * The press sweep saw "…?. Please try again." — our copy appended ". " to a
 * server sentence that had already ended. Two call sites did it by hand
 * (useJobSubmit, useFundExistingJob). Both now close the sentence with
 * endSentence(); this test pins the helper and scans src/ for the class: an
 * interpolated message/error/reason immediately followed by ". <Capital>".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { endSentence } from "@/lib/endSentence";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const CLASS = /\$\{\s*[A-Za-z_.?]*(?:msg|Msg|message|Message|error|Error|reason|Reason)[A-Za-z_.?]*\s*\}\. [A-Z]/g;

const sourceFiles = (): string[] =>
  execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\./.test(f));

describe("server messages end their own sentence", () => {
  it("endSentence keeps ? and !, adds a missing period, trims stray ones", () => {
    expect(endSentence("Card declined?")).toBe("Card declined?");
    expect(endSentence("Slow down!")).toBe("Slow down!");
    expect(endSentence("Card declined")).toBe("Card declined.");
    expect(endSentence("Card declined.. ")).toBe("Card declined.");
    expect(endSentence("")).toBe("");
  });

  it("no interpolated message is followed by a hand-written '. '", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(500);
    const hits = files.flatMap((f) => {
      const code = blankComments(readFileSync(resolve(ROOT, f), "utf8"));
      return [...code.matchAll(CLASS)].map((m) => `${f}:${code.slice(0, m.index).split("\n").length}: ${m[0]}`);
    });
    expect(hits, "use endSentence(message) instead of `${message}. `").toEqual([]);
  });

  it("the scan is RED on the original shape", () => {
    const planted = "toast.error(`Couldn't start payment: ${errorMsg}. Please try again.`);";
    expect([...planted.matchAll(CLASS)]).toHaveLength(1);
  });
});
