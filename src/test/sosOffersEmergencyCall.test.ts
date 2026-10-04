/**
 * TS-007 (HIGH): "no 911/emergency path exists anywhere in the app". The SOS
 * control only hands one GPS fix to the OS share sheet: it alerts nobody but
 * the contact the user picks. Q366 put SOS on both sides of an active job; the
 * emergency number was still missing.
 *
 * CLASS: every module that renders an SOS control (an `aria-label` starting
 * "SOS") must also offer a real `tel:911` link in code (comments blanked, so a
 * note that mentions 911 does not count), and must say that sharing does not
 * alert emergency services.
 */
// @mutate src/components/SosShareButton.tsx | <a href="tel:911" aria-label="Call 911"> | <a href="#" aria-label="Call 911">
// @mutate src/components/SosShareButton.tsx | It does not alert us or emergency services. | Help is on the way.
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const SOS_LABEL = /aria-label=["'{`]+SOS\b/;

describe("TS-007: every SOS control offers the emergency number", () => {
  const sosModules = walk(SRC)
    .map((p) => ({ rel: relative(ROOT, p), code: blankComments(readFileSync(p, "utf8")) }))
    .filter((m) => SOS_LABEL.test(m.code));

  it("finds the SOS control(s) in source", () => {
    expect(sosModules.map((m) => m.rel)).toContain("src/components/SosShareButton.tsx");
    expect(sosModules.length).toBeGreaterThan(0);
  });

  it.each(sosModules.map((m) => [m.rel, m.code] as const))(
    "%s renders a tel:911 link and says sharing alerts nobody else",
    (_rel, code) => {
      expect(code).toMatch(/href=["']tel:911["']/);
      expect(code).toMatch(/does not alert us or emergency services/);
    },
  );
});
