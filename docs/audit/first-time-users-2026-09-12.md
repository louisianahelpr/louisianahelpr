# First-time user walk — 2026-09-12 (WIP, paused by owner)

Status: PAUSED at orientation. Harness built, one step observed. Nothing below is a finding yet.

## Setup (to resume)

- Worktree: `.claude/worktrees/agent-ab081703e8d015858`, `node_modules` symlinked to main checkout, `.env` copied.
- Bundle built (`npm run build`, VITE_SUPABASE_* from playwright.config.ts). Preview server: `npx vite preview --port 4412 --strictPort --host 127.0.0.1` (path-derived port for this worktree).
- Harness: `e2e/happy-path/zz-persona-lib.ts` (`Walk.step` = screenshot + innerText + visible controls + errorScreens check + stuck/blank check) and `e2e/happy-path/zz-persona-1.spec.ts` (orientation dumps: guest Post-a-Job / Get Started / Browse taps; authed customer + helper route dumps). Output: scratchpad `shots/<persona>/NN-name.{png,txt}`.
- Run: `LH_BROWSER_LOCK_WAIT_MIN=40 npx playwright test e2e/happy-path/zz-persona-1.spec.ts --project=happy-path --workers=1`. Lock waits on other sessions were 5+ minutes; batch many steps per run.

## Observed so far

- Landing `/` at 375: clean, no error screen, no horizontal scroll. Hero, "Post a Job" (primary) and "Browse Jobs" (secondary) CTAs; "Log In" / "Get Started" in header. A homeowner would tap "Post a Job" — next step to observe.

## Personas (not started)

1. Homeowner Lafayette gutters <$150 — 2. Student odd jobs Baton Rouge — 3. STR host recurring cleaner — 4. Bad job, refund — 5. Senior large text, tomorrow's helper + message — 6. Returning user, earnings/payout.
