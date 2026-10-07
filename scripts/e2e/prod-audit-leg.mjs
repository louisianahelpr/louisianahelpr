/**
 * Q889: the spec files one prod-audit leg runs (e2e/prod-audit/legs.json),
 * printed space-separated for `npx playwright test --project=prod-audit <files>`.
 * Fails on an unknown leg or a listed file that does not exist, so a leg never
 * silently runs nothing (Playwright with no file arguments would run them ALL).
 *
 *   node scripts/e2e/prod-audit-leg.mjs a
 *
 * Guard: src/test/prodAuditLegs.test.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const LEGS_PATH = path.join(ROOT, "e2e", "prod-audit", "legs.json");

export function legFiles(leg, legs = JSON.parse(readFileSync(LEGS_PATH, "utf8"))) {
  const files = legs[leg];
  if (!Array.isArray(files) || files.length === 0) throw new Error(`prod-audit-leg: no leg "${leg}" in e2e/prod-audit/legs.json`);
  return files.map((f) => `e2e/prod-audit/${f}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = legFiles(process.argv[2]);
  const missing = files.filter((f) => !existsSync(path.join(ROOT, f)));
  if (missing.length) {
    console.error(`prod-audit-leg: listed but missing: ${missing.join(", ")}`);
    process.exit(1);
  }
  process.stdout.write(files.join(" "));
}
