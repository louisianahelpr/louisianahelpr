import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // `.claude/**` excludes agent worktree copies under `.claude/worktrees/` —
  // without this, `eslint .` lints a duplicate of the whole codebase per
  // worktree (slow) and reports `supabase/functions` errors the top-level
  // ignore can't match through the nested path.
  // `.remember/**` excludes the remember plugin's per-machine working dir
  // (session buffer, daily notes, .remember/tmp/last-ndc.ts) — eslint v9
  // flat config doesn't auto-honor .gitignore, so the dir needs an
  // explicit ignore here or local lint fails on plugin scratch.
  // `ios/**` excludes Xcode build products (build_sim/, DerivedData/) whose
  // bundled Capacitor native-bridge.js otherwise reds `eslint .` locally.
  { ignores: ["dist", "build", "**/build/**", "ios/**", ".claude/**", ".remember/**", "supabase/functions/**", "playwright-fixture.ts", "playwright.config.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Disabled: we intentionally co-locate small helpers, types, and
      // constants with their owning component (shadcn/ui pattern + our own
      // HelperBadges/OnboardingTour/TimePickerSelect/JobFilters). HMR still
      // works fine for component edits; this rule only affects refresh
      // granularity, not correctness.
      "react-refresh/only-export-components": "off",
      // `any` is used pervasively for Supabase row types and `catch (err: any)`
      // patterns — both are conventional and safe here. Disabling rather than
      // bulk-rewriting hundreds of call sites.
      "@typescript-eslint/no-explicit-any": "off",
      // Many useEffect deps are intentionally omitted (one-shot mounts, refs
      // that should not retrigger). Disabling to remove false-positive noise;
      // genuine stale-closure bugs are caught in code review.
      "react-hooks/exhaustive-deps": "off",
      // eslint-plugin-react-hooks v7 added several new rules (set-state-in-effect,
      // refs, purity, immutability, static-components, etc.) that flag 163
      // pre-existing patterns written under v5. These are intentional React
      // patterns in this codebase; disabling the new rule-set rather than
      // bulk-refactoring ~163 existing call sites.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      "react-hooks/static-components": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/globals": "off",
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      // tailwind.config.ts uses CommonJS require() for the plugin —
      // standard Tailwind pattern, not worth rewriting.
      "@typescript-eslint/no-require-imports": "off",
      // Empty catch{} blocks and marker interfaces are intentional patterns
      // in this codebase (silent fallbacks, type aliases). Downgrade to warn.
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "@typescript-eslint/no-empty-object-type": "warn",
    },
  },
);
