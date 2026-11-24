#!/usr/bin/env node
/**
 * Rewrites the Kids picks chunk after a Kids pick moves to its themed guide (scripts/giftGuideKidsThemeMoves1124.mjs),
 * by hand-edit like scripts/theme-guide-import.mjs (never scripts/gift-guide-picks.mjs, which rewrites ~45 unrelated
 * files from the Desktop research): src/content/giftGuidePicks/kids.json = kids1121Picks() (the generator's own Kids
 * step), its CHUNK_PICK_COUNTS entry, then the search index. theme-guide-import.mjs runs it after every import, so a
 * waiting move (Minecraft ...) applies the moment its theme is live.
 *
 *   node scripts/kids-theme-moves.mjs
 *
 * Guard: src/test/giftGuideKidsThemeRow1124.test.tsx.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { kids1121Picks } from "./giftGuideHimKids1121.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (...p) => join(ROOT, ...p);

export function writeKidsChunk() {
  const picks = kids1121Picks();
  writeFileSync(rel("src/content/giftGuidePicks/kids.json"), `${JSON.stringify({ picks })}\n`);
  const file = rel("src/content/giftGuidePicks.ts");
  const src = readFileSync(file, "utf8");
  const re = /(export const CHUNK_PICK_COUNTS(?:: [^=]+)? = )(.*?);\n/;
  const m = src.match(re);
  if (!m) throw new Error("CHUNK_PICK_COUNTS not found");
  const counts = { ...JSON.parse(m[2]), kids: picks.length };
  writeFileSync(file, src.replace(re, () => `${m[1]}${JSON.stringify(counts)};\n`));
  return picks.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`kids-theme-moves: Kids now ${writeKidsChunk()} picks`);
  execFileSync("node", [rel("scripts/gift-guide-search-index.mjs")], { stdio: "inherit" });
}
