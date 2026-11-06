#!/usr/bin/env bash
# The paths whose changes actually change the deployed site. ONE list, used by
# both scripts/vercel-ignore.sh (whether Vercel builds a push) and
# .github/workflows/prod-freshness.yml (which commit prod must be serving), so
# the two can never disagree about whether a docs-only push "should" deploy.
# The build's post-processors (every `node scripts/<x>.mjs` in package.json's
# "build", and their local imports) change dist/ too, so they ship: on
# 2026-11-05 the rail fix in scripts/inline-shell-css.mjs (#4170) was skipped
# by prod-deploy as "no deploy path changed". Guard: buildScriptsAreDeployPaths.
printf '%s\n' \
  src public api index.html \
  vite.config.ts tailwind.config.ts postcss.config.js postcss.config.cjs \
  tsconfig.json tsconfig.app.json components.json \
  package.json package-lock.json vercel.json \
  scripts/check-csp-inline-scripts.mjs scripts/csp scripts/inline-shell-css.mjs \
  scripts/build-og-shell.mjs scripts/prerender-static-pages.mjs scripts/strip-web-sourcemaps.mjs \
  ':(exclude)src/test' ':(exclude,glob)**/*.test.ts' ':(exclude,glob)**/*.test.tsx'
