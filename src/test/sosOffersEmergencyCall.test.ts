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
// @mutate src/components/SosShareButton.tsx | href="tel:911" | href="#"
// @mutate src/components/SosShareButton.tsx | It does not alert us or emergency services. | Help is on the way.
// @mutate src/components/SosShareButton.tsx | title="Talk to Helpr" | title="Talk to Helpr Safety"
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

  // A control that only OPENS SosShareButton's own sheet (the sheet carries the tel:911 link and the line), so the
  // number is one tap away exactly as on the card. Each must still import SosShareButton and call its onOpen.
  const OPENS_THE_SOS_SHEET: Record<string, string> = {
    "src/components/job-card/jobStepMenu.tsx":
      "Lead 11-01 (B107): the job page draws SosShareButton's chip as an outlined row button whose onClick is the chip's own onOpen (src/test/jobPageSosIsSecondary.test.tsx)",
  };
  it.each(Object.keys(OPENS_THE_SOS_SHEET))("%s only opens SosShareButton's sheet", (rel) => {
    const m = sosModules.find((x) => x.rel === rel);
    expect(m, `${rel} no longer has an SOS control: drop it from OPENS_THE_SOS_SHEET`).toBeTruthy();
    expect(m!.code).toMatch(/import \{ SosShareButton \} from "@\/components\/SosShareButton"/);
    expect(m!.code).toMatch(/chip\.type === SosShareButton[\s\S]{0,400}onClick=\{onOpen\}/);
  });

  it.each(sosModules.filter((m) => !(m.rel in OPENS_THE_SOS_SHEET)).map((m) => [m.rel, m.code] as const))(
    "%s renders a tel:911 link and says sharing alerts nobody else",
    (_rel, code) => {
      expect(code).toMatch(/href=["']tel:911["']/);
      expect(code).toMatch(/does not alert us or emergency services/);
    },
  );
});

/**
 * Board 156 (truth rule, spec v2 §1.5): the "Are you safe?" sheet promises only
 * what the app does. There is no live-location feed to a safety team, no
 * "Helpr Safety" desk, no pause of the other person and no instant answer; a
 * share sends ONE position to the person you pick. Copy that names any of
 * those is a promise nobody keeps, on the screen someone opens when afraid.
 */
describe("board 156: the safety sheet promises only what exists", () => {
  const code = blankComments(readFileSync(join(SRC, "components", "SosShareButton.tsx"), "utf8"));
  const strings = [...code.matchAll(/"([^"\\]*)"|>([^<>{}]+)</g)].map((m) => (m[1] ?? m[2] ?? "").trim()).filter(Boolean);

  it("reads its own copy", () => {
    expect(strings.length).toBeGreaterThan(10);
    expect(strings).toContain("Are you safe?");
  });

  it.each([/Helpr Safety/i, /live location/i, /paused by/i, /right away|reply now|, now\b/i])("no string matches %s", (re) => {
    expect(strings.filter((s) => re.test(s))).toEqual([]);
  });
});

