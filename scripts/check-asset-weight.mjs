#!/usr/bin/env node
/**
 * Guard against committing heavy binaries.
 *
 * WHY THIS EXISTS
 * A disk audit on 2026-09-13 found 322 MB of media in git history that exists in
 * NO commit's tree at HEAD — 2,383 blobs of art that was added, iterated on, and
 * deleted, leaving every revision behind in the pack forever. `size-pack` was
 * 350.89 MiB for a repo whose working tree carries 9.8 MB of media. The worst
 * offenders were a single hero image committed six times:
 *
 *   src/assets/hero-illustration-v5.jpg   13.4 MB across 6 revisions
 *   assets/splash.png                      6.0 MB across 2
 *   src/assets/hero-porch-garden-2000.webp 5.1 MB
 *   src/assets/hero-new-3.jpg              4.1 MB
 *   public/pwa-192x192.png                 3.4 MB
 *
 * Deleting the files reclaimed nothing: only a history rewrite can, and that
 * needs a force-push past every live worktree. The cheap moment to stop this is
 * before the blob enters the pack, which is what this does.
 *
 * WHY IT CHECKS THE DIFF, NOT THE TREE
 * Thirteen files already exceed the caps — six are legitimate (1024px app icons
 * are genuinely ~645 KB) and seven are audit screenshots already committed. A
 * whole-tree gate would be red on arrival and immediately disabled, which is
 * worse than no gate. So it judges only what a commit ADDS or MODIFIES, and
 * `--all` reports the existing set without failing.
 *
 * WHY THE CAP VARIES BY DESTINATION
 * A byte in src/assets/ ships inside every app bundle and every user's download;
 * a byte in docs/ only costs the clone. The caps reflect that, rather than
 * pretending one number fits an app icon and a screenshot.
 *
 * Usage:
 *   node scripts/check-asset-weight.mjs                 # staged changes (pre-commit)
 *   node scripts/check-asset-weight.mjs --base <ref>    # changes vs a ref (CI)
 *   node scripts/check-asset-weight.mjs --all           # report existing, never fails
 */

import { execFileSync } from "node:child_process";
import { statSync, existsSync } from "node:fs";

const BINARY = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|mp4|mov|webm|pdf|ico|ttf|otf|woff2?|zip|gz|mp3|wav|psd|sketch)$/i;

// Caps in KB, first matching prefix wins. Ordered most specific first.
const CAPS = [
  // Ships in the JS bundle: every byte is downloaded by every user.
  ["src/assets/", 250],
  // Native + web assets. Deliberately NOT a loose cap: the handful of icons that
  // genuinely need ~645 KB are named in ALLOWLIST instead, so a slack cap here
  // cannot be used as a side door for the next 699 KB image.
  ["ios/App/App/Assets.xcassets/", 300],
  ["android/app/src/main/res/", 300],
  ["public/", 300],
  // App Store Connect review material, uploaded not bundled.
  ["scripts/asc/assets/", 300],
  ["fastlane/", 300],
  // Audit evidence: should be cropped or optimised, never a raw retina dump.
  ["docs/", 300],
];
const DEFAULT_CAP = 300;

// Exact paths permitted to exceed their cap, each with the reason it must.
// Add here only for a file that ships to users and cannot be smaller.
const ALLOWLIST = new Map([
  ["public/app-icon-1024.png", "1024px PWA/App Store icon — Apple rejects recompression artefacts"],
  ["public/app-icon-1024-dark.png", "1024px dark-variant icon, same constraint"],
  ["ios/App/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png", "App Store marketing icon, exact size required"],
  ["scripts/asc/assets/review-screenshot.png", "App Store review screenshot, dimensions fixed by ASC"],
  // Shipped web assets already in the tree at 300-350 KB. Both are genuine
  // compression candidates (an OG image and a splash icon should be well under
  // 300 KB), but re-encoding them changes what users see, so it needs a visual
  // check and an owner call rather than a silent rewrite by a size guard.
  ["public/helpr-splash-icon.png", "338KB, shipped splash icon — compression candidate, needs a visual check first"],
  ["public/og-image-square.png", "321KB, shipped Open Graph image — compression candidate, needs a visual check first"],
]);

const args = process.argv.slice(2);
const mode = args.includes("--all") ? "all" : "diff";
const baseIdx = args.indexOf("--base");
const base = baseIdx >= 0 ? args[baseIdx + 1] : null;

const git = (a) => execFileSync("git", a, { encoding: "utf8" });

const capFor = (p) => {
  for (const [prefix, kb] of CAPS) if (p.startsWith(prefix)) return kb;
  return DEFAULT_CAP;
};

let files;
if (mode === "all") {
  files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
} else if (base) {
  // Added or modified only: a deletion never adds a blob.
  files = git(["diff", "--name-only", "--diff-filter=AM", `${base}...HEAD`]).split("\n").filter(Boolean);
} else {
  files = git(["diff", "--cached", "--name-only", "--diff-filter=AM"]).split("\n").filter(Boolean);
}

const offenders = [];
for (const f of files) {
  if (!BINARY.test(f) || !existsSync(f)) continue;
  const kb = Math.round(statSync(f).size / 1024);
  const cap = capFor(f);
  if (kb <= cap) continue;
  if (ALLOWLIST.has(f)) continue;
  offenders.push({ f, kb, cap });
}

if (mode === "all") {
  console.log(`Existing tracked binaries over their cap: ${offenders.length}`);
  for (const { f, kb, cap } of offenders.sort((a, b) => b.kb - a.kb)) {
    console.log(`  ${String(kb).padStart(6)}KB  (cap ${cap}KB)  ${f}`);
  }
  console.log("\nReport only — --all never fails. Caps apply to new and modified files.");
  process.exit(0);
}

if (offenders.length === 0) {
  console.log(`check-asset-weight: OK (${files.length} changed file(s), no oversized binary)`);
  process.exit(0);
}

console.error("check-asset-weight: FAIL — oversized binary would enter git history\n");
for (const { f, kb, cap } of offenders.sort((a, b) => b.kb - a.kb)) {
  console.error(`  ${f}\n    ${kb}KB, cap ${cap}KB for this path\n`);
}
console.error(`Git keeps every revision of a binary forever: 322MB of this repo's pack is
already art that no commit still references, and only a history rewrite can
reclaim it. Before committing, either:

  - compress it (pngquant / cwebp / squoosh); a screenshot is usually 10x smaller
    as an optimised png, and audit evidence should be cropped to the defect
  - keep it out of git: audit artefacts belong in the run's uploaded artifact,
    not the tree
  - if it genuinely must ship at this size, add it to ALLOWLIST in
    scripts/check-asset-weight.mjs with the reason it cannot be smaller
`);
process.exit(1);
