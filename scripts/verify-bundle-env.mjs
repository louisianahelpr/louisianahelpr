#!/usr/bin/env node
/**
 * Post-build assertion: the bundle we are about to ship actually carries the
 * PRODUCTION Supabase config, and does not carry the STAGING one.
 *
 * WHY THIS EXISTS
 * ---------------
 * `.env` is gitignored, so CI has no copy. A build step with no `VITE_*` env
 * block resolves `import.meta.env.VITE_SUPABASE_URL` to undefined,
 * `createClient(undefined, undefined)` throws at MODULE SCOPE in
 * src/integrations/supabase/client.ts, and because App.tsx imports that
 * eagerly the throw lands before createRoot().render(<App/>). React never
 * mounts, the native splash auto-hides after 1.5s, and the app sits on
 * index.html's #boot-loader forever with no error surfaced anywhere.
 *
 * That shipped once already through .github/workflows/ios-beta.yml. This file
 * is the SINGLE definition of the check that was added there inline, so the
 * next release lane cannot be written without it — deploy.yml had exactly the
 * same hole for four months precisely because the fix lived as copy-pasteable
 * shell inside one workflow instead of as a script both could call.
 *
 * WHY GREP THE PROJECT REF AND NOT "supabase.co"
 * ----------------------------------------------
 * supabase-js contains the string "supabase.co" in its own code even when the
 * env vars are missing, so grepping for it passes on a broken bundle. The
 * project ref only appears if a real URL was baked in. The ref is public — it
 * is in every web bundle and in every network call the app makes — so naming
 * it here leaks nothing.
 *
 * WHY THE STAGING CHECK
 * ---------------------
 * `supabase/.temp/project-ref` points at staging, and a CLI reading the wrong
 * project has already produced one false conclusion in this repo. A release
 * binary built against staging credentials would install, boot, and look
 * completely correct while talking to the wrong database.
 *
 * Usage:  node scripts/verify-bundle-env.mjs [assetsDir]   (default dist/assets)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROD_PROJECT_REF = 'fncmgoasalhdgfwzhsqa';
export const STAGING_PROJECT_REF = 'okpxtpfvwtmbuxugqsws';

/**
 * @param {string} assetsDir directory of built JS assets
 * @param {string} label human name for the bundle, used in error text
 * @returns {string[]} list of failure messages (empty = pass)
 */
export function checkBundleEnv(assetsDir, label = assetsDir) {
  if (!existsSync(assetsDir)) {
    return [`${label}: no assets directory — nothing was built.`];
  }

  const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
  if (!jsFiles.length) return [`${label}: no JavaScript assets were emitted.`];

  let prodHits = 0;
  let stagingHits = 0;
  const stagingFiles = [];

  for (const file of jsFiles) {
    const source = readFileSync(join(assetsDir, file), 'utf8');
    if (source.includes(PROD_PROJECT_REF)) prodHits += 1;
    if (source.includes(STAGING_PROJECT_REF)) {
      stagingHits += 1;
      stagingFiles.push(file);
    }
  }

  const failures = [];

  if (prodHits === 0) {
    failures.push(
      `${label}: contains NO Supabase project URL across ${jsFiles.length} JS chunks.\n` +
        '  The app would throw at module scope and hang on the boot-loader forever —\n' +
        '  a white screen with no error, on every launch.\n' +
        '  Cause: the build step ran without VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY.\n' +
        '  Fix: give the build step those repo secrets (see ios-beta.yml "Build web bundle").',
    );
  }

  if (stagingHits > 0) {
    failures.push(
      `${label}: carries the STAGING project ref (${STAGING_PROJECT_REF}) in ` +
        `${stagingFiles.join(', ')}.\n` +
        '  A release binary built against staging installs and boots looking entirely\n' +
        '  correct while reading and writing the wrong database.\n' +
        '  Fix: point VITE_SUPABASE_URL at production before building a release.',
    );
  }

  return failures;
}

// CLI entry — only when executed directly, so importing this module is free.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const assetsDir = process.argv[2] ?? join(process.cwd(), 'dist', 'assets');
  const failures = checkBundleEnv(assetsDir);

  if (failures.length) {
    for (const failure of failures) {
      console.error(`::error::${failure.split('\n')[0]}`);
      console.error(`✗ ${failure}`);
    }
    process.exit(1);
  }

  console.log(`✓ ${assetsDir} carries the production Supabase config (and not staging).`);
}
