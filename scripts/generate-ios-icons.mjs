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
import { mkdir, rm, writeFile } from 'node:fs/promises';
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

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

console.log(`Generating ${icons.length} iOS icons from ${SRC}…`);
for (const icon of icons) {
  await sharp(SRC)
    .resize(icon.size, icon.size, { fit: 'cover' })
    // Order matters: flatten FIRST (composite any alpha onto an opaque
    // background), THEN removeAlpha (drop the now-redundant channel).
    // Reversed, removeAlpha discards the alpha channel outright and
    // flatten becomes a no-op — so a source that ever gained
    // transparency would silently render whatever solid colour is named
    // here across the whole icon. This previously read
    // `.removeAlpha().flatten({ background: '#1FA678' })` — a teal-green
    // that belongs to no current brand token and matched nothing else in
    // the app.
    //
    // #F1F2F4 is `--parchment` (hsl(220 14% 95%) in src/index.css) and is
    // the exact background public/app-icon-1024.png is built on, so this
    // fallback is invisible even if it ever engages.
    .flatten({ background: '#F1F2F4' })
    .removeAlpha()        // Apple rejects icons with alpha
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

// ─────────────────────────────────────────────────────────────────────
// Alternate App Icon (notification-thumbnail friendly, iOS 10.3+)
//
// If `public/app-icon-alt.svg` (or `.png`) exists, render the iPhone +
// iPad sizes Apple looks for in `CFBundleAlternateIcons`. These MUST be
// loose PNG files in the app bundle root — not in Assets.xcassets — so
// they go to `ios/App/App/AlternateIcons/<basename><scale>.png`.
//
// Naming follows Apple's rule: the base name in CFBundleIconFiles is
// `AppIcon-Fleur` and Xcode auto-appends `@2x.png` / `@3x.png` based
// on the device's scale at runtime. We emit the iPhone + iPad sizes
// the runtime actually reads (60pt, plus 20/29/40 for notifications,
// settings, spotlight). We DO NOT need the 1024 marketing render here;
// the alt icon doesn't ship to App Store Connect.
// ─────────────────────────────────────────────────────────────────────
const ALT_BASENAME = 'AppIcon-Fleur';
const ALT_SVG = join(repoRoot, 'public', 'app-icon-alt.svg');
const ALT_PNG = join(repoRoot, 'public', 'app-icon-alt-1024.png');
const ALT_OUT = join(repoRoot, 'ios', 'App', 'App', 'AlternateIcons');

const altSrc = existsSync(ALT_SVG) ? ALT_SVG
             : existsSync(ALT_PNG) ? ALT_PNG
             : null;

if (!altSrc) {
  console.log('\n(no alternate icon — skipping; place public/app-icon-alt.svg or .png to enable)');
} else {
  // Sizes Apple's runtime expects when CFBundleAlternateIcons is declared.
  // No 1x/iPad-1x — alt icons are runtime-only, modern devices only.
  const altIcons = [
    // iPhone — required for the Springboard tap target + notif/settings/spotlight
    { size: 40,  name: `${ALT_BASENAME}-20@2x.png`  },
    { size: 60,  name: `${ALT_BASENAME}-20@3x.png`  },
    { size: 58,  name: `${ALT_BASENAME}-29@2x.png`  },
    { size: 87,  name: `${ALT_BASENAME}-29@3x.png`  },
    { size: 80,  name: `${ALT_BASENAME}-40@2x.png`  },
    { size: 120, name: `${ALT_BASENAME}-40@3x.png`  },
    { size: 120, name: `${ALT_BASENAME}@2x.png`     },  // 60pt @2x — primary
    { size: 180, name: `${ALT_BASENAME}@3x.png`     },  // 60pt @3x — primary
    // iPad (also 76pt + 83.5pt for iPad Pro)
    { size: 152, name: `${ALT_BASENAME}-76@2x~ipad.png`   },
    { size: 167, name: `${ALT_BASENAME}-83.5@2x~ipad.png` },
  ];

  await rm(ALT_OUT, { recursive: true, force: true });
  await mkdir(ALT_OUT, { recursive: true });

  console.log(`\nGenerating ${altIcons.length} alternate icons from ${altSrc}…`);
  for (const icon of altIcons) {
    await sharp(altSrc)
      .resize(icon.size, icon.size, { fit: 'cover' })
      // flatten before removeAlpha — see the note in the main loop above.
      .flatten({ background: '#54583E' })  // Bark plate, matches the SVG
      .removeAlpha()
      .png({ compressionLevel: 9 })
      .toFile(join(ALT_OUT, icon.name));
    console.log(`  ✓ ${icon.name}  (${icon.size}×${icon.size})`);
  }

  // Drop a README in AlternateIcons/ with the one-time Xcode wiring step.
  const altReadme = `# Alternate App Icons (auto-generated)

These PNGs are emitted by \`scripts/generate-ios-icons.mjs\` from
\`public/app-icon-alt.svg\` (or \`public/app-icon-alt-1024.png\` if SVG
isn't present). Do not hand-edit — re-run the script after touching
the source.

## One-time Xcode wiring (only needed the first time the AlternateIcons
## folder is added to the project)

1. Open \`ios/App/App.xcworkspace\` in Xcode.
2. In the project navigator, drag this entire \`AlternateIcons\` folder
   onto the \`App\` group.
3. In the dialog, choose **"Create folder references"** (the blue
   folder icon) — NOT "Create groups". This makes Xcode treat the
   contents as a bundle resource without re-managing each PNG.
4. Confirm the folder shows up in the App target's
   **Build Phases → Copy Bundle Resources**.

After that, every \`npx cap sync ios\` + \`npm run build:ios\` will pick
up the latest renders automatically.

## Runtime switching (JS layer)

Install \`@capacitor-community/native-app-icon\` to call:

    import { NativeAppIcon } from '@capacitor-community/native-app-icon';
    await NativeAppIcon.change({ name: 'AppIcon-Fleur' });
    // Restore primary:
    await NativeAppIcon.reset();

Don't bundle that plugin until you actually wire a UI surface for it
(e.g. Settings → Theme). For the first ship the alt icon is dormant
— present in the bundle, wired in Info.plist, but only switchable via
the plugin once it's installed.

## Sizes

| File | px | iOS context |
|---|---|---|
| AppIcon-Fleur@2x.png | 120 | Springboard 60pt @2x |
| AppIcon-Fleur@3x.png | 180 | Springboard 60pt @3x |
| AppIcon-Fleur-20@2x.png | 40 | Notification 20pt @2x |
| AppIcon-Fleur-20@3x.png | 60 | Notification 20pt @3x |
| AppIcon-Fleur-29@2x.png | 58 | Settings 29pt @2x |
| AppIcon-Fleur-29@3x.png | 87 | Settings 29pt @3x |
| AppIcon-Fleur-40@2x.png | 80 | Spotlight 40pt @2x |
| AppIcon-Fleur-40@3x.png | 120 | Spotlight 40pt @3x |
| AppIcon-Fleur-76@2x~ipad.png | 152 | iPad Springboard 76pt @2x |
| AppIcon-Fleur-83.5@2x~ipad.png | 167 | iPad Pro Springboard 83.5pt @2x |
`;
  await writeFile(join(ALT_OUT, 'README.md'), altReadme);
  console.log(`  ✓ README.md`);
}

console.log(`\nDone. Open ios/App/App.xcworkspace in Xcode to verify the icon set.`);
