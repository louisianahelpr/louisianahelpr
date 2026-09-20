#!/usr/bin/env node
/**
 * check-loading-state-shape — the CI check for the whole CLASS of the owner's
 * 2026-09-19 report: "a lot of them jump and are not consistent with their info."
 *
 * Standing order: every owner-reported bug ships with a check for its class,
 * built from the app's own inventory, shown RED on the original defect.
 *
 * WHAT IT ASSERTS
 *
 *   1. INVENTORY IS ALIVE. `scripts/loading-state-inventory.mjs` scans `src/`
 *      for placeholders by what they ARE (a `<Skeleton>`, an `animate-pulse`,
 *      an `animate-spin`, a `*Skeleton`/`*Fallback` component, a `<Suspense>`
 *      boundary, an `isLoading` branch) and every kind must clear its floor.
 *      A scan broken by a refactor fails LOUDLY instead of passing on an empty
 *      set — the failure mode that let five guards stay green for months.
 *
 *   2. EVERY ROUTE WAS MEASURED. The route catalog is parsed out of
 *      `src/App.tsx`, never hand-listed, so a route added tomorrow is missing
 *      from the evidence and this check says so. Inventory minus measured must
 *      be empty.
 *
 *   3. NO SKELETON LIES ABOUT SIZE. For every measured cluster, the row the
 *      placeholder reserves and the row that actually lands must agree within
 *      ROW_BUDGET px. That is the JUMP.
 *
 *   4. NO SKELETON LIES ABOUT SHAPE. The same cluster must deliver the row
 *      COUNT it drew, and the same number of avatars/media. That is the
 *      "not consistent with their info".
 *
 * WHY IT READS A MEASUREMENT FILE. Neither defect is visible in source: a
 * skeleton that looks right in JSX is routinely 12px shorter than its content,
 * and a `p-3` card standing in for a `py-2.5` hairline row reads fine until
 * something measures both. The evidence is produced by
 * `scripts/audit/measure-loading-states.mjs` against PROD with the shared test
 * accounts (no mock mode, ever) and committed, exactly like the other audit
 * evidence in `docs/audit/`.
 *
 * BASELINE. `docs/audit/loading-states/baseline.json` lists the clusters that
 * were already wrong when this check was written. It may only SHRINK: an entry
 * that no longer breaches is itself a failure, so it cannot rot into a
 * permanent excuse.
 *
 *   node scripts/check-loading-state-shape.mjs
 *   node scripts/check-loading-state-shape.mjs --json
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { counts, checkFloors, inventory } from "./loading-state-inventory.mjs";
import { deriveRouteSet } from "./audit/press-every-control.mjs";

const REPO = resolve(import.meta.dirname, "..");
const EVIDENCE = resolve(REPO, "docs/audit/loading-states/measurements.json");
const BASELINE = resolve(REPO, "docs/audit/loading-states/baseline.json");

/**
 * How far a placeholder row may differ from the row that replaces it.
 *
 * 8px, not 0: a row whose content wraps to a second line genuinely cannot be
 * predicted, and sub-pixel rounding on a 2x screenshot costs a pixel either
 * way. Anything past 8px is a visible step — the owner's own report is a feed
 * whose bones sit 12px taller than its cards.
 */
export const ROW_BUDGET = 8;

/** A cluster's stable identity across runs. */
export const clusterKey = (r, i) => `${r.persona} ${r.url} #${i}`;

/** Every breach in a measurement set, as {key, kind, detail}. */
export function breaches(results) {
  const out = [];
  for (const r of results) {
    if (r.status !== "measured") continue;
    (r.clusters ?? []).forEach((c, i) => {
      const key = clusterKey(r, i);
      if (!c.realBox) return; // nothing landed there; reported separately
      if (c.deltaRowH != null && Math.abs(c.deltaRowH) > ROW_BUDGET) {
        out.push({ key, kind: "jump", detail: `row ${c.rowH[0]}px → ${c.rowH[1]}px (${c.deltaRowH > 0 ? "+" : ""}${c.deltaRowH}px)` });
      }
      if (c.rows?.[0] !== c.rows?.[1]) {
        out.push({ key, kind: "rows", detail: `${c.rows[0]} placeholder row(s) → ${c.rows[1]} real row(s)` });
      }
      if (Math.abs((c.media?.[0] ?? 0) - (c.media?.[1] ?? 0)) > 1) {
        out.push({ key, kind: "media", detail: `${c.media[0]} avatar/media bone(s) → ${c.media[1]} real` });
      }
    });
  }
  return out;
}

function main() {
  const problems = [];
  const json = process.argv.includes("--json");

  // 1. the inventory must be alive
  const hits = inventory();
  const c = counts(hits);
  for (const f of checkFloors(c)) problems.push(`INVENTORY: ${f}`);

  // 2. the evidence must exist and cover every route the app declares
  if (!existsSync(EVIDENCE)) {
    console.error(
      `No loading-state evidence at ${EVIDENCE.replace(REPO + "/", "")}.\n` +
      "Produce it with:  BASE=http://127.0.0.1:4173 node scripts/audit/measure-loading-states.mjs",
    );
    process.exit(1);
  }
  const ev = JSON.parse(readFileSync(EVIDENCE, "utf8"));
  const results = ev.results ?? [];

  const declared = new Set(
    deriveRouteSet({ seedJobId: "x", helperId: "x", customerId: "x", adminViews: [] })
      .filter((r) => !r.redirect && !r.personas.every((p) => p === "admin"))
      .map((r) => r.url.replace(/\/jobs\/[^/?]+/, "/jobs/:id").replace(/\/user\/[^/?]+/, "/user/:id")),
  );
  const measured = new Set(
    results.map((r) => r.url.replace(/\/jobs\/[^/?]+/, "/jobs/:id").replace(/\/user\/[^/?]+/, "/user/:id")),
  );
  const uncovered = [...declared].filter((u) => !measured.has(u));
  if (uncovered.length) {
    problems.push(`COVERAGE: ${uncovered.length} route(s) in src/App.tsx were never measured: ${uncovered.slice(0, 8).join(", ")}${uncovered.length > 8 ? " …" : ""}`);
  }

  // 3 + 4. size and shape, against a baseline that may only shrink
  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { allow: [] };
  const allow = new Set((base.allow ?? []).map((a) => `${a.key}|${a.kind}`));
  const found = breaches(results);
  const seen = new Set();
  for (const b of found) {
    const id = `${b.key}|${b.kind}`;
    seen.add(id);
    if (!allow.has(id)) problems.push(`${b.kind.toUpperCase()}: ${b.key} — ${b.detail}`);
  }
  // A baseline entry that no longer breaches is stale and must be removed, or
  // the list rots into a permanent excuse the way every unshrinkable one has.
  const stale = [...allow].filter((id) => !seen.has(id));
  if (stale.length) {
    problems.push(`BASELINE: ${stale.length} entr(ies) no longer breach and must be deleted from docs/audit/loading-states/baseline.json: ${stale.slice(0, 6).join(", ")}`);
  }

  if (json) {
    console.log(JSON.stringify({ counts: c, breaches: found, uncovered, stale, problems }, null, 2));
  } else {
    console.log(`inventory: ${hits.length} loading-state sites across ${c.files} files`);
    console.log(`evidence:  ${results.length} surfaces, ${results.filter((r) => r.status === "measured").length} measured (${ev.base}, ${ev.at})`);
    console.log(`breaches:  ${found.length} (${allow.size} baselined)\n`);
    for (const p of problems) console.log("  ✗ " + p);
  }

  if (problems.length) {
    console.error(`\n${problems.length} loading-state problem(s).`);
    process.exit(1);
  }
  console.log("✓ every measured placeholder matches the size and shape of what replaces it");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
