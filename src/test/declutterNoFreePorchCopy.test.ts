/**
 * Owner 11-20 (item page polish follow-up): Declutter says "Porch pickup", never "Free porch pickup" (EN) or
 * "Recogida gratis en el porche" (ES), anywhere a member reads it: the item page, cards, checkout, emails and notices.
 * Reads every tracked app source file (src/, supabase/functions/) as text, comments blanked, so a word in code or a
 * dictionary string counts and a note in a comment does not.
 *
 * @mutate src/lib/i18n/enItemPage.ts |   "ip.porchPickup": "Porch pickup", |   "ip.porchPickup": "Free porch pickup",
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const BANNED = /free porch pickup|recogida gratis en el porche/i;

describe("Declutter copy says Porch pickup, never Free porch pickup (owner 11-20)", () => {
  it("no app source or edge function shows the old words", () => {
    const files = [...trackedFiles("src"), ...trackedFiles("supabase/functions")].filter(
      (f) => /\.(ts|tsx|mjs|js)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"),
    );
    expect(files.length).toBeGreaterThan(1000);
    const hits = files.filter((f) => BANNED.test(blankComments(readFileSync(resolve(REPO, f), "utf8"))));
    expect(hits).toEqual([]);
  });

  it("the item page's meta row draws ip.porchPickup, 'Porch pickup' / 'Recogida en el porche'", async () => {
    const { enItemPage } = await import("@/lib/i18n/enItemPage");
    const { esItemPage } = await import("@/lib/i18n/esItemPage");
    expect(enItemPage["ip.porchPickup"]).toBe("Porch pickup");
    expect(esItemPage["ip.porchPickup"]).toBe("Recogida en el porche");
  });
});
