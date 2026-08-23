#!/usr/bin/env node
/**
 * Build the App Store icon source from the transparent wrought-iron logo.
 *
 * Usage:
 *   node scripts/build-app-icon.mjs
 *
 * Source:      src/assets/helpr-logo-1024.png  (846×727, RGBA — transparent bg)
 * Destinations:
 *   public/app-icon-1024.png       — light: cool parchment background
 *   public/app-icon-1024-dark.png  — dark:  deep warm charcoal background
 *
 * Both outputs are exactly 1024×1024, no alpha (Apple rejects icons with
 * alpha). Feed `public/app-icon-1024.png` into
 * `scripts/generate-ios-icons.mjs` to regenerate the iOS AppIcon set.
 *
 * Design notes — keep the ornate wrought-iron "H" exactly as drawn:
 *  - The logo is scaled to ~800px wide and centered. ~78% of the 1024
 *    canvas keeps the corner scrollwork inside iOS's rounded-squircle
 *    mask so the detail is never clipped.
 *  - A soft, blurred, dimmed silhouette of the logo is dropped below the
 *    mark (~18px offset) so the iron looks like it physically rests on
 *    the surface — a contact shadow, not a flat sticker.
 *  - A faint radial vignette shades the background edges so the canvas
 *    isn't a dead-flat swatch.
 *  - The dark variant adds a warm radial glow behind the (near-black)
 *    iron so the mark doesn't vanish into the charcoal.
 *
 * Requires:    npm i -D sharp
 */

import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const SRC = join(repoRoot, 'src', 'assets', 'helpr-logo-1024.png');

const CANVAS = 1024;
// ~78% of the canvas — confident fill, but the corner scrollwork stays
// inside the iOS rounded-squircle safe zone.
const LOGO_WIDTH = 800;
// How far the contact shadow drops below the mark.
const SHADOW_OFFSET_Y = 18;
// Gaussian blur radius for the contact shadow.
const SHADOW_BLUR = 20;

if (!existsSync(SRC)) {
  console.error(`✗ Missing source: ${SRC}`);
  console.error('  Expected the transparent wrought-iron logo (846×727 RGBA).');
  process.exit(1);
}

/**
 * Resize the transparent logo to LOGO_WIDTH wide (fit:inside, aspect
 * preserved) and return { buffer, width, height }.
 */
async function makeScaledLogo() {
  const buffer = await sharp(SRC)
    .resize(LOGO_WIDTH, LOGO_WIDTH, {
      fit: 'inside',
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();
  const meta = await sharp(buffer).metadata();
  return { buffer, width: meta.width, height: meta.height };
}

/**
 * Build a soft contact shadow from the logo's alpha silhouette:
 * recolor every opaque pixel to a dim dark tone, then blur it.
 */
async function makeContactShadow(logoBuffer) {
  // Tint the silhouette dark by replacing RGB while preserving the alpha
  // shape, then knock the alpha down so the shadow reads as soft, not a
  // hard black cutout.
  return sharp(logoBuffer)
    .composite([
      {
        input: {
          create: {
            width: 1,
            height: 1,
            channels: 4,
            // #14161A — hsl(220 14% 9%), the dark-mode `--parchment` in
            // src/index.css. Cool-neutral, matching the canvas hue; a
            // warm-biased shadow would re-introduce the cream cast.
            background: { r: 0x14, g: 0x16, b: 0x1a, alpha: 1 },
          },
        },
        tile: true,
        blend: 'in', // keep dst alpha, take src color → tinted silhouette
      },
    ])
    .blur(SHADOW_BLUR)
    // Dim the whole shadow so it's a subtle contact shadow.
    .ensureAlpha()
    .linear([1, 1, 1, 0.42], [0, 0, 0, 0]) // scale alpha to ~42%
    .png()
    .toBuffer();
}

/**
 * A 1024×1024 radial-vignette overlay SVG: transparent center fading to
 * a faint tint at the edges. `edgeAlpha` is the max edge opacity (0–1).
 */
function vignetteSvg(edgeRgb, edgeAlpha) {
  const { r, g, b } = edgeRgb;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">
      <defs>
        <radialGradient id="v" cx="50%" cy="50%" r="72%">
          <stop offset="0%"  stop-color="rgb(${r},${g},${b})" stop-opacity="0"/>
          <stop offset="62%" stop-color="rgb(${r},${g},${b})" stop-opacity="0"/>
          <stop offset="100%" stop-color="rgb(${r},${g},${b})" stop-opacity="${edgeAlpha}"/>
        </radialGradient>
      </defs>
      <rect width="${CANVAS}" height="${CANVAS}" fill="url(#v)"/>
    </svg>`,
  );
}

/**
 * A warm radial glow SVG sized to the canvas: bright warm center fading
 * to transparent. Used behind the near-black iron on the dark variant so
 * the mark stays legible against the charcoal.
 */
function glowSvg(glowRgb, centerAlpha) {
  const { r, g, b } = glowRgb;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">
      <defs>
        <radialGradient id="g" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stop-color="rgb(${r},${g},${b})" stop-opacity="${centerAlpha}"/>
          <stop offset="55%" stop-color="rgb(${r},${g},${b})" stop-opacity="${centerAlpha * 0.4}"/>
          <stop offset="100%" stop-color="rgb(${r},${g},${b})" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${CANVAS}" height="${CANVAS}" fill="url(#g)"/>
    </svg>`,
  );
}

/**
 * Composite one icon variant and write it out (no alpha).
 *
 * @param {object} opts
 * @param {string} opts.outPath        absolute destination path
 * @param {{r,g,b}} opts.background    flat canvas background color
 * @param {{r,g,b}} opts.vignetteRgb   edge-tint color for the vignette
 * @param {number}  opts.vignetteAlpha edge-tint max opacity (0–1)
 * @param {{r,g,b}=} opts.glowRgb      optional warm glow color (dark variant)
 * @param {number=}  opts.glowAlpha    glow center opacity (0–1)
 * @param {string}   opts.label        log label
 */
async function buildVariant({
  outPath,
  background,
  vignetteRgb,
  vignetteAlpha,
  glowRgb,
  glowAlpha,
  label,
}) {
  const { buffer: logo, width: lw, height: lh } = await makeScaledLogo();
  const shadow = await makeContactShadow(logo);
  const shadowMeta = await sharp(shadow).metadata();

  // Center the logo on the canvas.
  const logoLeft = Math.round((CANVAS - lw) / 2);
  const logoTop = Math.round((CANVAS - lh) / 2);

  // Center the (blurred → slightly larger) shadow, then offset it down.
  const shadowLeft = Math.round((CANVAS - shadowMeta.width) / 2);
  const shadowTop =
    Math.round((CANVAS - shadowMeta.height) / 2) + SHADOW_OFFSET_Y;

  const layers = [];

  // 1. Warm glow behind the mark (dark variant only).
  if (glowRgb) {
    layers.push({ input: glowSvg(glowRgb, glowAlpha ?? 0.3), top: 0, left: 0 });
  }
  // 2. Contact shadow, offset below the mark.
  layers.push({ input: shadow, top: shadowTop, left: shadowLeft });
  // 3. The wrought-iron logo itself — untouched.
  layers.push({ input: logo, top: logoTop, left: logoLeft });
  // 4. Radial vignette on top so the edge tint reads over everything.
  layers.push({
    input: vignetteSvg(vignetteRgb, vignetteAlpha),
    top: 0,
    left: 0,
  });

  await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { ...background, alpha: 1 },
    },
  })
    .composite(layers)
    .flatten({ background }) // composite onto an opaque background
    .removeAlpha() // strip the alpha channel — Apple rejects icons with alpha
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  console.log(`  ✓ ${label}  →  ${outPath}`);
}

console.log(`Building app icon variants from ${SRC}…`);

// Light variant — cool parchment background (#F1F2F4).
//
// This MUST stay the same hex the app's other launch surfaces already
// use: the Capacitor SplashScreen + StatusBar backgroundColor
// (capacitor.config.ts), the `theme-color` meta in index.html, and
// theme_color/background_color in public/manifest.webmanifest. It is
// `--parchment`, hsl(220 14% 95%), in src/index.css. Matching it is the
// whole point — the springboard icon hands off to the splash, and any
// mismatch shows as a tint jump on every cold start.
//
// (Was #F0E7D6 warm cream, authored before the palette migrated
// warm→cool in 9bdb3283e; the icon simply never followed.)
await buildVariant({
  outPath: join(repoRoot, 'public', 'app-icon-1024.png'),
  background: { r: 0xf1, g: 0xf2, b: 0xf4 },
  // Edge vignette: #E2E4E9 — `--sand`, hsl(220 14% 90%), the cool-neutral
  // token that replaced the warm tan #D6C7AD in the same migration.
  vignetteRgb: { r: 0xe2, g: 0xe4, b: 0xe9 },
  vignetteAlpha: 0.13,
  label: 'light  (parchment #F1F2F4)',
});

// Dark variant — deep warm charcoal background (#24251C) with a warm
// radial glow so the near-black iron stays visible.
await buildVariant({
  outPath: join(repoRoot, 'public', 'app-icon-1024-dark.png'),
  background: { r: 0x24, g: 0x25, b: 0x1c },
  // Edge vignette: go darker still at the corners.
  vignetteRgb: { r: 0x0e, g: 0x0f, b: 0x0a },
  vignetteAlpha: 0.14,
  // Warm amber glow behind the mark.
  glowRgb: { r: 0xb4, g: 0x8e, b: 0x4e },
  glowAlpha: 0.34,
  label: 'dark   (charcoal #24251C)',
});

console.log('\nDone. Next: run `node scripts/generate-ios-icons.mjs`.');
