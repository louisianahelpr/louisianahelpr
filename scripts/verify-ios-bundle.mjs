#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { checkBundleEnv } from './verify-bundle-env.mjs';

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

// What must NOT ship in a Capacitor bundle is the WORKBOX runtime that
// vite-plugin-pwa generates for web builds — not `sw.js` as such.
//
// `public/sw.js` is a deliberate, hand-written minimal app-shell worker (see
// its header) that is registered by src/main.tsx and is SUPPOSED to be in the
// native bundle; VitePWA merely overwrites it in dist/ for web builds. This
// list used to name 'sw.js' outright, so the guard failed a correct bundle —
// invisibly, because the iOS CI lane has been manual-only since April and the
// local fastlane lane never invokes this script.
//
// The workbox filename is hash-suffixed and changes whenever the dependency
// does (it was pinned to one build's 'workbox-05fa8657.js'), so it is matched
// by pattern rather than by an exact name that silently goes stale.
const forbiddenFiles = ['registerSW.js'];
const forbiddenPatterns = [/^workbox-[a-f0-9]+\.js(\.map)?$/];
const present = readdirSync(iosPublic);
const stale = [
  ...forbiddenFiles.filter((file) => existsSync(join(iosPublic, file))),
  ...present.filter((f) => forbiddenPatterns.some((re) => re.test(f))),
];
if (stale.length) {
  fail(
    `iOS bundle contains vite-plugin-pwa web artifacts: ${stale.join(', ')}. ` +
    `Build with npm run build:ios (sets VITE_CAPACITOR_BUILD=1, which disables VitePWA).`,
  );
}

// The hand-written worker is allowed, but the WORKBOX-generated one is not —
// and both are called sw.js. Tell them apart by content: only the generated
// one pulls in the workbox runtime.
const swPath = join(iosPublic, 'sw.js');
// Match a RUNTIME marker, not the word "workbox" — the hand-written worker
// explains in its own header comment how it relates to the Workbox one, so a
// bare /workbox/i test flags the correct file.
const WORKBOX_RUNTIME = /workbox-[a-f0-9]{6,}\.js|importScripts\s*\(/;
if (existsSync(swPath) && WORKBOX_RUNTIME.test(readFileSync(swPath, 'utf8'))) {
  fail(
    'iOS bundle ships the WORKBOX-generated sw.js rather than the minimal ' +
    'app-shell worker from public/sw.js. dist/ was produced by a plain ' +
    '`npm run build`; rebuild with `npm run build:ios` before `npx cap sync ios`.',
  );
}

const assetsDir = join(iosPublic, 'assets');
if (!existsSync(assetsDir)) fail('Missing iOS bundled assets directory.');
const jsAssets = readdirSync(assetsDir).filter((file) => file.endsWith('.js'));
if (!jsAssets.length) fail('No JavaScript assets were copied into the iOS bundle.');

// Sourcemaps must never ride into the .ipa. `cap sync` copies dist/ wholesale
// and dist/ holds a .map per chunk (`sourcemap: "hidden"` in vite.config.ts),
// so without `npm run strip:ios-sourcemaps` that is ~20 MB of files no runtime
// ever reads — "hidden" emits no `//# sourceMappingURL=` comment, and Sentry
// symbolicates from UPLOADED maps, not from the copy on the device. Fail loudly
// if the strip step is ever dropped from a sync path.
const strayMaps = readdirSync(assetsDir).filter((file) => /\.(js|css)\.map$/.test(file));
if (strayMaps.length) {
  fail(
    `iOS bundle ships ${strayMaps.length} sourcemap(s) (e.g. ${strayMaps[0]}). ` +
    'They add ~20 MB to every App Store download and are never read at runtime. ' +
    'Run `npm run strip:ios-sourcemaps` after `npx cap sync ios`.',
  );
}

// The bundle that is ACTUALLY about to be packaged into the .ipa carries a
// working Supabase config. The release lanes already assert this against
// dist/ right after the build; this repeats it one step from the archive,
// against the copy `cap sync` produced, so a stale or half-synced
// ios/App/App/public cannot slip a boot-dead bundle past the earlier check.
// Same shared definition — see scripts/verify-bundle-env.mjs for why an
// env-less bundle is catastrophic and why this greps the project ref.
const envFailures = checkBundleEnv(assetsDir, 'iOS bundle (ios/App/App/public/assets)');
if (envFailures.length) fail(envFailures.join('\n'));

const iconSize = statSync(appIcon).size;
if (iconSize < 100_000) fail('iOS marketing icon looks too small; expected the full Helpr green/white icon.');

console.log(`✓ iOS bundle is fresh: ${jsAssets.length} JS chunks, no PWA cache registration, Helpr icon present.`);