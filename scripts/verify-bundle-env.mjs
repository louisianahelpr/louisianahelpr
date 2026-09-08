#!/usr/bin/env node
/**
 * Post-build assertion: the bundle we are about to ship actually carries the
 * PRODUCTION Supabase config, and carries no OTHER project's.
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
 * WHY THE WRONG-PROJECT CHECK
 * ---------------------------
 * There is one database (CLAUDE.md: "THERE IS NO STAGING"), so ANY project ref
 * in the bundle other than prod means the build read the wrong `.env` or the
 * wrong CI secret. That binary would install, boot, and look completely
 * correct while reading and writing a database nobody is watching.
 *
 * Retiring staging made this check MORE load-bearing, not less. It used to be
 * a blacklist of one known-bad ref; a blacklist only catches the mistake
 * someone already made. It is now an allowlist of exactly one ref, so it also
 * catches a fork, a branch database, a personal scratch project, or a
 * resurrected staging — none of which were enumerable in advance.
 *
 * Usage:  node scripts/verify-bundle-env.mjs [assetsDir]   (default dist/assets)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROD_PROJECT_REF = 'fncmgoasalhdgfwzhsqa';

/**
 * Retired 2026-09-07. Kept ONLY so the failure message can name it: a bundle
 * carrying this ref means a stale `.env` or a stale CI secret survived the
 * retirement, and that diagnosis is worth far more than "unexpected ref".
 */
export const RETIRED_STAGING_PROJECT_REF = 'okpxtpfvwtmbuxugqsws';

// A Supabase project ref is exactly 20 lowercase alphanumerics. Verified
// 2026-09-06: the only 20-char `*.supabase.co` string anywhere in src/,
// public/ or node_modules/ is prod's, so this cannot fire on a dependency's
// own doc text the way a looser `supabase.co` match would.
const PROJECT_REF_URL = /\b([a-z0-9]{20})\.supabase\.co/g;

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
  /** @type {Map<string, string[]>} ref -> files it appears in */
  const foreignRefs = new Map();

  for (const file of jsFiles) {
    const source = readFileSync(join(assetsDir, file), 'utf8');
    if (source.includes(PROD_PROJECT_REF)) prodHits += 1;

    PROJECT_REF_URL.lastIndex = 0;
    for (const [, ref] of source.matchAll(PROJECT_REF_URL)) {
      if (ref === PROD_PROJECT_REF) continue;
      const files = foreignRefs.get(ref) ?? [];
      if (!files.includes(file)) files.push(file);
      foreignRefs.set(ref, files);
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

  for (const [ref, files] of foreignRefs) {
    const retired =
      ref === RETIRED_STAGING_PROJECT_REF
        ? '\n  That is the RETIRED staging project (removed 2026-09-07). A stale `.env`\n' +
          '  or a stale CI secret outlived it.'
        : '';
    failures.push(
      `${label}: carries a NON-PRODUCTION Supabase project ref (${ref}) in ` +
        `${files.join(', ')}.${retired}\n` +
        '  There is one database. A release built against any other project installs and\n' +
        '  boots looking entirely correct while reading and writing the wrong data.\n' +
        `  Fix: point VITE_SUPABASE_URL at production (${PROD_PROJECT_REF}) before building a release.`,
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

  console.log(
    `✓ ${assetsDir} carries the production Supabase config (${PROD_PROJECT_REF}) and no other project's.`,
  );
}
