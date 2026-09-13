#!/usr/bin/env bash
# The paths whose changes actually change the deployed site. ONE list, used by
# both scripts/vercel-ignore.sh (whether Vercel builds a push) and
# .github/workflows/prod-freshness.yml (which commit prod must be serving), so
# the two can never disagree about whether a docs-only push "should" deploy.
printf '%s\n' \
  src public api index.html \
  vite.config.ts tailwind.config.ts postcss.config.js postcss.config.cjs \
  tsconfig.json tsconfig.app.json components.json \
  package.json package-lock.json vercel.json \
  ':(exclude)src/test' ':(exclude,glob)**/*.test.ts' ':(exclude,glob)**/*.test.tsx'
