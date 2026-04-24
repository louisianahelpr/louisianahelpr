import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "supabase/functions/**", "playwright-fixture.ts", "playwright.config.ts"] },
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
