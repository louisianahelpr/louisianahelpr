// The gift guides' lists as a shopper reads them, for the guides' content tests (big batch 1120).
//
// Since the 1120 merges (src/content/giftGuideMerges.mjs) a merged guide's chunk holds its old guides as sections
// (`sectionId` = the old slug; "top-picks" = the merged guide's own picks). Every per-guide rule the content tests
// check (who a gift is for, its kind, the Louisiana section, the 25 cap) belongs to the section's own old guide, so
// these helpers hand each section back under its old slug, and a merged guide's own picks under its own slug.
// A chunk without sections (a store page, an unmerged guide) is itself.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "./trackedFiles";
import { MERGED_INTO } from "../../content/giftGuideMerges.mjs";

const DIR = "src/content/giftGuidePicks";

type WithSection = { sectionId?: string };

/** One chunk's picks split into lists: [listSlug, picks][] (its own slug for picks with no section or "top-picks"). */
export function splitChunk<T extends WithSection>(slug: string, picks: T[]): [string, T[]][] {
  const by = new Map<string, T[]>();
  for (const p of picks) {
    const k = p.sectionId && p.sectionId !== "top-picks" ? p.sectionId : slug;
    by.set(k, [...(by.get(k) ?? []), p]);
  }
  if (!by.has(slug) && by.size === 0) by.set(slug, []);
  return [...by.entries()];
}

const cache = new Map<string, Record<string, unknown[]>>();

/** Every list, keyed by its (old) guide slug: the chunks read once, each merged chunk split into its sections. */
export function sectionChunks<T extends WithSection>(root = process.cwd()): Record<string, T[]> {
  if (!cache.has(root)) {
    const dir = join(root, DIR);
    const out: Record<string, unknown[]> = {};
    for (const f of readdirSync(dir).filter((x: string) => x.endsWith(".json"))) {
      const slug = f.slice(0, -5);
      const picks = JSON.parse(readFileSync(join(dir, f), "utf8")).picks as WithSection[];
      for (const [k, list] of splitChunk(slug, picks)) out[k] = list;
    }
    cache.set(root, out);
  }
  return cache.get(root) as Record<string, T[]>;
}

/** One (old) guide's list: its section of the merged guide, or its own chunk; [] when it has none. */
export function sectionPageOf<T extends WithSection>(slug: string, root = process.cwd()): T[] {
  const into = MERGED_INTO[slug];
  if (into) {
    const file = join(root, DIR, `${into.parent}.json`);
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")).picks as T[]).filter((p) => p.sectionId === slug) : [];
  }
  const file = join(root, DIR, `${slug}.json`);
  if (!existsSync(file)) return [];
  const picks = JSON.parse(readFileSync(file, "utf8")).picks as T[];
  return picks.some((p) => p.sectionId) ? picks.filter((p) => !p.sectionId || p.sectionId === "top-picks") : picks;
}
