/**
 * The owner's 11-24 guide trim (scripts/giftGuideTrim1124.mjs): the 28 picks she approved taking off For Her (17), For Him
 * (5) and For Kids (6), from the trim review (~/.lh-shots/guide-trim-1124/labels.json). The list below is copied from her
 * approved IDs and the links on the page at trim time, not from the module, so the check is two-way. Kept with a store
 * switch instead: Her R13 YETI Daytrip, Him R20 Carhartt Paxton, Him R30 LaCrosse Burly.
 * @mutate scripts/giftGuideHer1121.mjs | return rankByPrice(trim1124(HER_GUIDE, rows)).map( | return rankByPrice(rows).map(
 * @mutate scripts/giftGuideHimKids1121.mjs |   rankByPrice(trim1124(slug, rows)).map( |   rankByPrice(rows).map(
 * @mutate scripts/giftGuideTrim1124.mjs |   ["Kids R9", "kids", shopmy("p-109731941"), | // ["Kids R9", "kids", shopmy("p-109731941"),
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { her1121Picks } from "../../scripts/giftGuideHer1121.mjs";
import { him1121Picks, kids1121Picks } from "../../scripts/giftGuideHimKids1121.mjs";
import { TRIM_1124_ROWS } from "../../scripts/giftGuideTrim1124.mjs";
import { CHUNK_PICK_COUNTS } from "@/content/giftGuidePicks";
import { tagKey } from "@/content/giftGuideKidsFilter";

type Pick = { name: string; href: string; brand?: string };
const chunk = (slug: string) => (JSON.parse(readFileSync(`src/content/giftGuidePicks/${slug}.json`, "utf8")) as { picks: Pick[] }).picks;
const built: Record<string, Pick[]> = { her: her1121Picks() as Pick[], him: him1121Picks() as Pick[], kids: kids1121Picks() as Pick[] };
const amz = (asin: string) => `https://www.amazon.com/dp/${asin}?tag=louisianahelpr-20`;
const sm = (pin: string) => `https://go.shopmy.us/p-${pin}`;

/** [ID, guide, link]. Her R1, R2 and Him R32 had moved store since the 2:52 AM snapshot, so these are the new links. */
const TRIMMED: [string, string, string][] = [
  ["Her R1", "her", "https://mavely.app.link/TptnXLe0j8b"], ["Her R2", "her", sm("110118320")], ["Her R3", "her", amz("B00GSH0KR2")],
  ["Her R4", "her", amz("B0C7LTPXBV")], ["Her R6", "her", amz("B0HKS18NW2")], ["Her R10", "her", sm("109200757")],
  ["Her R11", "her", amz("B0CDF7GJ4Y")], ["Her R12", "her", amz("B0HKYH5TF2")], ["Her R17", "her", amz("B0DWHDM15Q")],
  ["Her R19", "her", amz("0935032029")], ["Her R20", "her", amz("B0GP2R8TBS")], ["Her R21", "her", amz("B09X55PDB7")],
  ["Her R22", "her", amz("B0G3948RG8")], ["Her R23", "her", amz("B0F41DGFXT")], ["Her R24", "her", amz("B0H2CSG4SZ")],
  ["Her R25", "her", amz("B0FXBBD5GS")], ["Her R26", "her", amz("B0DN245D58")],
  ["Him R25", "him", amz("B0CNCYJHG5")], ["Him R29", "him", amz("B0HDDLPQV5")], ["Him R31", "him", amz("B0G4XRP464")],
  ["Him R32", "him", "https://walmrt.us/4zZkihX"], ["Him R33", "him", amz("B0F53HMTX5")],
  ["Kids R1", "kids", amz("B0H9ZZGK8W")], ["Kids R2", "kids", amz("B0HGX9TVW6")], ["Kids R3", "kids", amz("B0DCVF7YNW")],
  ["Kids R4", "kids", amz("B0D6RMZ3D1")], ["Kids R7", "kids", amz("B0F1N2MPND")], ["Kids R9", "kids", sm("109731941")],
];

describe("owner 11-24 guide trim", () => {
  it("the module lists exactly her 28 approved IDs, at the links on the page at trim time", () => {
    expect(TRIMMED.length).toBe(28);
    expect(TRIM_1124_ROWS.map(([id, guide, href]) => [id, guide, href])).toEqual(TRIMMED);
  });

  it("none of the 28 is on its guide (page file and builder), and the counts are Her 229, Him 205, Kids 167 (2026-11-24)", () => {
    for (const [id, guide, href] of TRIMMED) {
      for (const list of [chunk(guide), built[guide]]) expect(list.some((p) => p.href === href), `${id} ${href}`).toBe(false);
    }
    const counts = { her: 229, him: 205, kids: 167 };
    for (const [g, n] of Object.entries(counts)) {
      expect(chunk(g).length, g).toBe(n);
      expect(built[g].length, g).toBe(n);
      expect(CHUNK_PICK_COUNTS[g], g).toBe(n);
    }
  });

  it("the three she kept are still on the page", () => {
    expect(chunk("her").filter((p) => p.name.startsWith("YETI Daytrip")).length).toBe(1);
    expect(chunk("him").filter((p) => p.name.startsWith("Carhartt Paxton")).length).toBe(1);
    expect(chunk("him").filter((p) => p.name.startsWith("LaCrosse Burly")).length).toBe(1);
  });

  it("no 'shop similar' record or kids filter tag is left for a trimmed pick", () => {
    const dupes = (JSON.parse(readFileSync("src/content/giftGuideDupes.json", "utf8")) as { dupes: { for: { href?: string } }[] }).dupes;
    const tags = (JSON.parse(readFileSync("src/content/giftGuideKidsTags.json", "utf8")) as { tags: Record<string, unknown> }).tags;
    expect(Object.keys(tags).length).toBeGreaterThan(100);
    for (const [id, guide, href] of TRIMMED) {
      expect(dupes.some((d) => d.for.href === href), `dupe ${id}`).toBe(false);
      if (guide === "kids") expect(tags[tagKey(href)], `tag ${id}`).toBeUndefined();
    }
  });
});
