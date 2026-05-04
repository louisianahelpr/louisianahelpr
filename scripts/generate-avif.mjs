#!/usr/bin/env node
// Generate AVIF variants for every .webp under src/assets/ (top-level
// only, no recursion). Skips files that already have a matching .avif.
//
// AVIF is ~25% smaller than WebP at equivalent perceptual quality and is
// supported in every browser we ship to (Safari 16+, Chrome 85+, FF 93+).
// Adding it via <picture><source type="image/avif"> means modern browsers
// pick AVIF and the rest fall back to webp transparently.
//
// Usage:  npm run images:avif
// CI:     this should run as part of build prep when new webps land.

import { readdir, stat, access } from "node:fs/promises";
import { join, dirname, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { constants as FS } from "node:fs";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, "..", "src", "assets");

// AVIF effort 6 = good size/CPU balance. Quality 60 = visually lossless
// for photographic content; tighten to 50 if you want smaller files
// at the cost of some banding in skies.
const AVIF_OPTIONS = { quality: 60, effort: 6, chromaSubsampling: "4:2:0" };

async function fileExists(path) {
  try {
    await access(path, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const entries = await readdir(ASSETS_DIR);
  const webps = entries.filter((n) => n.endsWith(".webp"));

  if (webps.length === 0) {
    console.log("No .webp files found in src/assets/. Nothing to do.");
    return;
  }

  let generated = 0;
  let skipped = 0;

  for (const name of webps) {
    const webpPath = join(ASSETS_DIR, name);
    const avifPath = join(ASSETS_DIR, parse(name).name + ".avif");

    if (await fileExists(avifPath)) {
      skipped++;
      continue;
    }

    const start = Date.now();
    await sharp(webpPath).avif(AVIF_OPTIONS).toFile(avifPath);

    const [webpSize, avifSize] = await Promise.all([
      stat(webpPath).then((s) => s.size),
      stat(avifPath).then((s) => s.size),
    ]);
    const reduction = (((webpSize - avifSize) / webpSize) * 100).toFixed(1);
    const ms = Date.now() - start;

    console.log(
      `  ${name.padEnd(40)} ${(webpSize / 1024).toFixed(1).padStart(6)} KB webp  →  ` +
        `${(avifSize / 1024).toFixed(1).padStart(6)} KB avif  (-${reduction}%, ${ms}ms)`,
    );
    generated++;
  }

  console.log(
    `\n✅ Generated ${generated} AVIF variant${generated === 1 ? "" : "s"}` +
      (skipped > 0 ? `, skipped ${skipped} already existing` : "") + ".",
  );
}

main().catch((err) => {
  console.error("\n❌ AVIF generation failed:", err);
  process.exit(1);
});
