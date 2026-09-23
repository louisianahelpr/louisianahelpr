/**
 * GUARD (Q257): `ai-job-builder`'s system prompt and tool schema must
 *  (a) name the FULL, current category list — `src/lib/categoryHues.ts` is the
 *      single source of truth (see its own header comment: the map/card
 *      palettes drifted for exactly this reason before), and the function's
 *      hard-coded copies had silently fallen behind it (missing storm_prep,
 *      events);
 *  (b) tell the model to target a title well under the form's exact 32-char
 *      hard cap, not skim it — a model that aims at "max 32" reliably
 *      produces titles that need truncating (reproduced live with
 *      gemini-3.6-flash generating 33 chars against a "max 32" instruction,
 *      per the comment a few lines below the truncation code in index.ts);
 *  (c) state the canonical-noun rule (the person doing the job is always
 *      "Helpr", capitalized) so generated copy doesn't drift from house style
 *      the way the app's own UI once did (src/test/helprNotHelperInCopy.test.ts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { categoryHues } from "@/lib/categoryHues";

const ROOT = resolve(__dirname, "../../..");
const SOURCE = readFileSync(resolve(ROOT, "supabase/functions/ai-job-builder/index.ts"), "utf8");
const CANONICAL_CATEGORIES = Object.keys(categoryHues);

describe("ai-job-builder prompt: canonical category list", () => {
  it("categoryHues.ts still has more than a token handful of categories", () => {
    // Inventory floor: this suite reads categoryHues as its source of truth,
    // so an accidentally emptied map must not make every per-category
    // assertion below vacuously pass.
    expect(CANONICAL_CATEGORIES.length).toBeGreaterThan(9);
  });

  it("the tool-schema `enum` names every canonical category key, and nothing else", () => {
    const m = SOURCE.match(/enum:\s*\[([^\]]+)\]/);
    expect(m, "could not find the category `enum: [...]` array in ai-job-builder/index.ts").not.toBeNull();
    const listed = m![1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
    expect(new Set(listed), "tool-schema category enum has drifted from categoryHues.ts").toEqual(
      new Set(CANONICAL_CATEGORIES),
    );
  });

  it("the system prompt's human-readable category list names every canonical key", () => {
    const m = SOURCE.match(/recommended category from:\s*([^\n]+)/i);
    expect(m, "could not find the 'recommended category from: ...' line in the system prompt").not.toBeNull();
    const listed = m![1].split(",").map((s) => s.trim());
    const missing = CANONICAL_CATEGORIES.filter((c) => !listed.includes(c));
    expect(missing, `system prompt category list is missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("storm_prep and events are specifically present (the historical gap)", () => {
    expect(CANONICAL_CATEGORIES).toEqual(expect.arrayContaining(["storm_prep", "events"]));
    expect(SOURCE).toMatch(/storm_prep/);
    expect(SOURCE).toMatch(/\bevents\b/);
  });
});

describe("ai-job-builder prompt: title target is under the 32-char hard cap", () => {
  it("instructs the model to target a title shorter than the exact 32-char cap", () => {
    // Accepts any explicit target number strictly less than 32, stated in the
    // system prompt's title guidance — not just "max 32 chars" restated.
    const m = SOURCE.match(/target\s+(\d+)\s*chars?\s+or\s+fewer/i);
    expect(m, "system prompt has no 'target N chars or fewer' title guidance").not.toBeNull();
    const target = Number(m![1]);
    expect(target, "title target must be strictly under the 32-char hard cap, not equal to it").toBeLessThan(32);
  });
});

describe("ai-job-builder prompt: canonical-noun rule", () => {
  it("states the canonical-noun rule for the person doing the job", () => {
    expect(SOURCE).toMatch(/CANONICAL NOUNS/);
    expect(SOURCE).toMatch(/"Helpr"/);
  });
});

// @mutate supabase/functions/ai-job-builder/index.ts | enum: ["cleaning", "yard_work", "moving", "errands", "handyman", "painting", "delivery", "pet_care", "assembly", "storm_prep", "events", "other"], | enum: ["cleaning", "yard_work", "moving", "errands", "handyman", "painting", "delivery", "pet_care", "assembly", "other"],
