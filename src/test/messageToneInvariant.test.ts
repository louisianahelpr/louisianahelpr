import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { jobActionChipStyle } from "@/components/activity/JobActionRow";

/**
 * ONE MESSAGE, ONE COLOUR — enforced, not asserted.
 *
 * The owner rule, stated twice: "Message should be the same color for all
 * places." `JobActionRow.tsx` used to carry that rule as a COMMENT, over an
 * exported `messageButtonStyle` constant that claimed the six Message call
 * sites "read from this so they cannot drift apart again".
 *
 * Nothing imported it. Zero call sites. Meanwhile the chip row hardcoded the
 * identical triple beside a comment saying it "Matches messageButtonStyle
 * above", and the six real Message chips were split across `tone="info"` (x4)
 * and `tone="neutral"` (x2) — two tones that happened to resolve to the same
 * values, so the drift the comment promised to prevent had already happened
 * and was invisible because the two copies still agreed.
 *
 * That is the failure this file exists to stop: an invariant that lives only
 * in prose is not an invariant. `tone="message"` is now the single place
 * Message's colour is decided, and these assertions are what makes the
 * sentence above true tomorrow.
 *
 * It is a SOURCE scan rather than a render test on purpose. The rule is about
 * a set ("every Message chip in the app, and only Message chips"), and a
 * component test reads one element at a time — the same reason
 * `alarmColourInvariant` and `glossyPrimaryInvariant` read the tree.
 */

const ROOT = resolve(__dirname, "../..");

const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
    .filter((f) => existsSync(resolve(ROOT, f)));
}

/** Every `<JobActionChip … />` element in the file, as raw source. */
function chipElements(source: string): string[] {
  return source.match(/<JobActionChip\b[\s\S]*?\/>/g) ?? [];
}

const files = sourceFiles().map((rel) => ({
  rel,
  source: readFileSync(resolve(ROOT, rel), "utf8"),
}));

describe("Message wears exactly one tone, everywhere", () => {
  it("every Message chip passes tone=\"message\"", () => {
    const offenders: string[] = [];
    let messageChips = 0;

    for (const { rel, source } of files) {
      for (const chip of chipElements(source)) {
        if (!/\blabel="Message"/.test(chip)) continue;
        messageChips++;
        if (!/\btone="message"/.test(chip)) {
          offenders.push(`${rel}: <JobActionChip label="Message"> uses ${/\btone="([a-z]+)"/.exec(chip)?.[1] ?? "no tone"}`);
        }
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
    // A guard on the guard: if a refactor renames the chip or the label, this
    // test would silently pass over zero elements and stop protecting
    // anything. Six is the count as of the tone's introduction — posted card
    // (x3), disputed applied card, active applied card, confirmed applied
    // card. Adjust it deliberately when a Message chip is added or removed.
    expect(messageChips).toBeGreaterThanOrEqual(6);
  });

  it("the message tone is reserved for Message", () => {
    const offenders: string[] = [];

    for (const { rel, source } of files) {
      // Chips that take the tone by prop.
      for (const chip of chipElements(source)) {
        if (/\btone="message"/.test(chip) && !/\blabel="Message"/.test(chip)) {
          offenders.push(`${rel}: a non-Message chip passes tone="message"`);
        }
      }
      // Controls that draw their own <Button> and take the style directly
      // (ShareJobButton / SosShareButton / DirectionsButton do this). None of
      // them is Message, so none of them may borrow its tone.
      if (/jobActionChipStyle\(\s*"message"\s*\)/.test(source) && rel !== "src/components/activity/JobActionRow.tsx") {
        offenders.push(`${rel}: reads jobActionChipStyle("message") outside a Message chip`);
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no second copy of the Message triple is exported for call sites to read", () => {
    // The specific corpse this replaces. If it comes back, so does the class
    // of bug: a constant nobody imports, promising a guarantee it cannot give.
    // Comments are stripped first — JobActionRow.tsx names the deleted
    // constant on purpose, to say why it is gone.
    const revived = files.filter(({ source }) => /\bmessageButtonStyle\b/.test(stripComments(source)));
    expect(revived.map((f) => f.rel)).toEqual([]);
  });

  it("message, share and neutral are independent tones, not aliases", () => {
    // They resolve to the same olivewood triple TODAY — that is the 2026-08-24
    // branding call, not a shared value. The point of the assertion is the
    // shape: three separate switch cases, so recolouring one cannot recolour
    // the others. If they are ever folded into one shared constant, this test
    // still passes — which is why the JobActionRow comment says out loud not
    // to do it, and why the two tests above are the ones that carry the rule.
    const message = jobActionChipStyle("message");
    expect(message).toEqual({
      background: "hsl(var(--olivewood) / 0.08)",
      color: "hsl(var(--olivewood))",
      border: "0.5px solid hsl(var(--olivewood) / 0.22)",
    });
    // Not `toBe` — distinct objects. Same values, separate cases.
    expect(jobActionChipStyle("share")).not.toBe(message);
    expect(jobActionChipStyle("neutral")).not.toBe(message);
  });
});
