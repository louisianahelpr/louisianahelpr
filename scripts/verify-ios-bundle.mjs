#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const iosPublic = join(root, 'ios', 'App', 'App', 'public');
const appIcon = join(root, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'icon-1024.png');
const indexHtml = join(iosPublic, 'index.html');

const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

if (!existsSync(iosPublic)) fail('Missing ios/App/App/public. Run npm run build:ios && npx cap sync ios.');
if (!existsSync(indexHtml)) fail('Missing iOS bundled index.html.');
if (!existsSync(appIcon)) fail('Missing iOS marketing app icon.');

const html = readFileSync(indexHtml, 'utf8');
if (html.includes('/registerSW.js') || html.includes('registerSW.js')) {
  fail('iOS bundle still registers the PWA service worker; build with npm run build:ios.');
}

const forbiddenFiles = ['sw.js', 'sw.js.map', 'workbox-05fa8657.js', 'workbox-05fa8657.js.map', 'registerSW.js'];
const stale = forbiddenFiles.filter((file) => existsSync(join(iosPublic, file)));
if (stale.length) fail(`iOS bundle contains stale web-cache files: ${stale.join(', ')}`);

const assetsDir = join(iosPublic, 'assets');
if (!existsSync(assetsDir)) fail('Missing iOS bundled assets directory.');
const jsAssets = readdirSync(assetsDir).filter((file) => file.endsWith('.js'));
if (!jsAssets.length) fail('No JavaScript assets were copied into the iOS bundle.');

const iconSize = statSync(appIcon).size;
if (iconSize < 100_000) fail('iOS marketing icon looks too small; expected the full Helpr green/white icon.');

console.log(`✓ iOS bundle is fresh: ${jsAssets.length} JS chunks, no PWA cache registration, Helpr icon present.`);