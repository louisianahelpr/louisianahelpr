#!/usr/bin/env node
/**
 * Owner report → failing test FIRST (working-forwards change 3, owner 2026-09-12).
 *
 *   npm run repro -- --slug zip-check-missing --route /complete-profile \
 *     --selector "#zipCode" --persona customer --note "missing the check even though the zip is entered"
 *
 * Writes e2e/happy-path/repro/<slug>.spec.ts: it opens the route as that persona
 * at 375 and 1440, locates the owner's element, screenshots it, and carries a
 * placeholder assertion that FAILS until someone writes the real one. The order
 * is the point: the test is red on the reported bug before the fix exists, and
 * it then guards the bug's class in CI (the happy-path project runs this dir).
 */
import { writeFileSync, existsSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const { slug, route, selector } = args;
const persona = args.persona ?? "anon";
const note = (args.note ?? "").replace(/\*\//g, "* /");
if (!slug || !route || !selector || !/^[a-z0-9-]+$/.test(slug)) {
  console.error('usage: npm run repro -- --slug <kebab> --route </path> --selector "<css>" [--persona anon|customer|helper] [--note "<owner words>"]');
  process.exit(2);
}
if (!["anon", "customer", "helper"].includes(persona)) { console.error("persona must be anon|customer|helper"); process.exit(2); }
const out = `e2e/happy-path/repro/${slug}.spec.ts`;
if (existsSync(out)) { console.error(`${out} exists`); process.exit(1); }

const who = persona === "helper" ? "FAKE_HELPER" : "FAKE_CUSTOMER";
const date = new Date().toISOString().slice(0, 10);
writeFileSync(out, `/**
 * Owner report, ${date}: "${note}"
 * Route: ${route}   Element: ${selector}   Persona: ${persona}
 *
 * Written BEFORE the fix. Replace the placeholder assertion with one that
 * measures the reported defect, run it and watch it FAIL, then fix the app and
 * watch it pass. Then widen it to the whole class (every screen with the same
 * shape) — see CLAUDE.md "Prevent, don't chase".
 */
import { test, expect, ${who}, installSupabaseMocks, seedAuthedSession } from "../fixtures";

for (const width of [375, 1440]) {
  test(\`${slug} @ \${width}\`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
${persona === "anon"
  ? "    await installSupabaseMocks(page, { seed: true });"
  : `    await seedAuthedSession(context, ${who}, baseURL ?? "");\n    await installSupabaseMocks(page, { user: ${who}, seed: true });`}
    await page.goto(${JSON.stringify(route)});
    const el = page.locator(${JSON.stringify(selector)}).first();
    await expect(el).toBeVisible({ timeout: 20_000 });
    await el.screenshot({ path: test.info().outputPath(\`${slug}-\${width}.png\`) });

    // PLACEHOLDER — fails on purpose. Replace with the measurement of the bug.
    expect(false, "write the assertion for: ${note.replace(/"/g, "'").replace(/`/g, "'")}").toBe(true);
  });
}
`);
console.log(`wrote ${out} — make it measure the bug, see it fail, then fix.`);
