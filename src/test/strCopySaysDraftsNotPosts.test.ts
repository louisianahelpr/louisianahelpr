/**
 * Host Automation's words match what the sync does (Q768, seen on prod
 * 2026-10-12 at 375 while proving Q1119): str-ical-sync DRAFTS a cleaning job
 * for each checkout (a notice that opens Post a Job pre-filled; nothing posted,
 * nothing charged), but the empty state still promised "Helpr automatically
 * posts a cleaning job" and the footnote "Cleaning jobs are created for
 * checkouts up to 7 days out". A host reading that would wait for a cleaner who
 * was never booked.
 *
 * Class: every user-facing string in the Host Automation screen (StrSettings
 * and src/pages/profile/strSettings/*) — read with comments blanked — makes no
 * auto-post / auto-create claim.
 *
 * @mutate src/pages/profile/StrSettings.tsx | Helpr fills in a cleaning job for you to post | Helpr automatically posts a cleaning job
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const DIR = join(ROOT, "src/pages/profile/strSettings");
const FILES = [join(ROOT, "src/pages/profile/StrSettings.tsx"), ...readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).map((f) => join(DIR, f))];

/** Claims the draft-only sync does not keep. */
const CLAIMS = [/automatically posts?/i, /auto-?posts?\b/i, /jobs? (?:are|is|get|gets) (?:created|posted)/i, /\bcreates (?:a )?cleaning jobs?/i, /posts? a cleaning job/i];

describe("Host Automation says drafts, never auto-posts", () => {
  it("reads the whole screen", () => {
    // Floor: StrSettings + AddCalendarForm + ConnectionCard + helpers today.
    expect(FILES.length).toBeGreaterThan(3);
  });

  it("no user-facing string claims Helpr posts or creates the cleaning job", () => {
    const hits: string[] = [];
    for (const f of FILES) {
      const src = blankComments(readFileSync(f, "utf8"));
      // String literals and JSX text: anything between quotes/backticks or between > and <.
      const texts = [...src.matchAll(/"([^"\n]{12,})"|`([^`]{12,})`|>([^<>{}]{12,})</g)].map((m) => (m[1] ?? m[2] ?? m[3]).replace(/\s+/g, " "));
      for (const t of texts) for (const c of CLAIMS) if (c.test(t)) hits.push(`${f.slice(ROOT.length + 1)}: "${t.trim().slice(0, 120)}"`);
    }
    expect(hits).toEqual([]);
  });

  it("the empty state and the footnote say what does happen", () => {
    const s = blankComments(readFileSync(FILES[0], "utf8"));
    expect(s).toMatch(/fills in a cleaning job for you to post/);
    expect(s).toMatch(/Nothing is posted or charged until you post it\./);
  });
});
