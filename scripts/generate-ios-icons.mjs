#!/usr/bin/env node
/**
 * Generate the full iOS AppIcon.appiconset from a single 1024×1024 PNG source.
 *
 * Usage:
 *   node scripts/generate-ios-icons.mjs
 *
 * Source:      public/app-icon-1024.png  (no alpha, no rounded corners)
 * Destination: ios/App/App/Assets.xcassets/AppIcon.appiconset/
 *
 * Requires:    npm i -D sharp
 */

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const SRC = join(repoRoot, 'public', 'app-icon-1024.png');
const OUT = join(
  repoRoot,
  'ios', 'App', 'App',
  'Assets.xcassets', 'AppIcon.appiconset'
);

if (!existsSync(SRC)) {
  console.error(`✗ Missing source: ${SRC}`);
  console.error('  Place a 1024×1024 PNG (no alpha, no rounded corners) there.');
  process.exit(1);
}

if (!existsSync(join(repoRoot, 'ios', 'App'))) {
  console.error('✗ ios/App not found. Run `npx cap add ios` first.');
  process.exit(1);
}

// All iOS icon sizes Apple expects (in pixels) for iPhone, iPad, and Marketing.
const icons = [
  // iPhone notification, settings, spotlight, app
  { size: 40,   name: 'icon-20@2x.png',   idiom: 'iphone',     sizeStr: '20x20',     scale: '2x' },
  { size: 60,   name: 'icon-20@3x.png',   idiom: 'iphone',     sizeStr: '20x20',     scale: '3x' },
  { size: 58,   name: 'icon-29@2x.png',   idiom: 'iphone',     sizeStr: '29x29',     scale: '2x' },
  { size: 87,   name: 'icon-29@3x.png',   idiom: 'iphone',     sizeStr: '29x29',     scale: '3x' },
  { size: 80,   name: 'icon-40@2x.png',   idiom: 'iphone',     sizeStr: '40x40',     scale: '2x' },
  { size: 120,  name: 'icon-40@3x.png',   idiom: 'iphone',     sizeStr: '40x40',     scale: '3x' },
  { size: 120,  name: 'icon-60@2x.png',   idiom: 'iphone',     sizeStr: '60x60',     scale: '2x' },
  { size: 180,  name: 'icon-60@3x.png',   idiom: 'iphone',     sizeStr: '60x60',     scale: '3x' },
  // iPad
  { size: 20,   name: 'icon-20.png',      idiom: 'ipad',       sizeStr: '20x20',     scale: '1x' },
  { size: 40,   name: 'icon-20@2x-ipad.png', idiom: 'ipad',    sizeStr: '20x20',     scale: '2x' },
  { size: 29,   name: 'icon-29.png',      idiom: 'ipad',       sizeStr: '29x29',     scale: '1x' },
  { size: 58,   name: 'icon-29@2x-ipad.png', idiom: 'ipad',    sizeStr: '29x29',     scale: '2x' },
  { size: 40,   name: 'icon-40.png',      idiom: 'ipad',       sizeStr: '40x40',     scale: '1x' },
  { size: 80,   name: 'icon-40@2x-ipad.png', idiom: 'ipad',    sizeStr: '40x40',     scale: '2x' },
  { size: 76,   name: 'icon-76.png',      idiom: 'ipad',       sizeStr: '76x76',     scale: '1x' },
  { size: 152,  name: 'icon-76@2x.png',   idiom: 'ipad',       sizeStr: '76x76',     scale: '2x' },
  { size: 167,  name: 'icon-83.5@2x.png', idiom: 'ipad',       sizeStr: '83.5x83.5', scale: '2x' },
  // App Store Marketing
  { size: 1024, name: 'icon-1024.png',    idiom: 'ios-marketing', sizeStr: '1024x1024', scale: '1x' },
];

await mkdir(OUT, { recursive: true });

console.log(`Generating ${icons.length} iOS icons from ${SRC}…`);
for (const icon of icons) {
  await sharp(SRC)
    .resize(icon.size, icon.size, { fit: 'cover' })
    .removeAlpha()        // Apple rejects icons with alpha
    .flatten({ background: '#1FA678' })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, icon.name));
  console.log(`  ✓ ${icon.name}  (${icon.size}×${icon.size})`);
}

// Contents.json that Xcode reads
const contents = {
  images: icons.map(i => ({
    size: i.sizeStr,
    idiom: i.idiom,
    filename: i.name,
    scale: i.scale,
  })),
  info: { version: 1, author: 'xcode' },
};
await writeFile(
  join(OUT, 'Contents.json'),
  JSON.stringify(contents, null, 2),
);
console.log(`  ✓ Contents.json`);
console.log(`\nDone. Open ios/App/App.xcworkspace in Xcode to verify the icon set.`);
