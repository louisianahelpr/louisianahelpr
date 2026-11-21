/**
 * Audit 11-20 night #15/#20/#21/#25 (owner 11-20): a poster's ID check is at
 * the OFFER, not at posting, and Declutter buying/selling never asks for ID.
 * No member-facing copy may state the old rule.
 *
 * @mutate src/lib/useIdCheckOnForViewer.ts | the first time you send a Helpr an offer, get hired | the first time you post a job, get hired
 */
import { describe, it, expect } from "vitest";
import { resolve, relative } from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const OLD_RULE = /ID[^.\n]{0,120}(when you post a job|before anyone posts|before they first post|before you post|first time you post a job)|first payout as a seller, at your first purchase|la primera vez que publica un trabajo|antes de publicar o (salir|ser contratado)/;
const files = walkSource([resolve(ROOT, "src")]).filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes("/src/test/"));

describe("ID copy: poster at offer, never at posting; no ID in Declutter buying or selling", () => {
  it("reads the app's source (floor)", () => {
    expect(files.length).toBeGreaterThan(1000);
  });
  it("catches the old sentences", () => {
    expect(OLD_RULE.test("We ask for your ID once: when you post a job, when you're hired")).toBe(true);
    expect(OLD_RULE.test("Photo ID checked before anyone posts or heads out.")).toBe(true);
    expect(OLD_RULE.test("Photo ID checked before anyone hires or heads out.")).toBe(false);
  });
  it("finds no copy stating the old rule", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readSource(f);
      if (!src) continue;
      const m = blankComments(src).match(OLD_RULE);
      if (m) offenders.push(`${relative(ROOT, f)}: ${m[0].slice(0, 120)}`);
    }
    expect(offenders).toEqual([]);
  });
});
