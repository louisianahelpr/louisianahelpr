#!/usr/bin/env node
/**
 * Q2091: MapKit's WebAssembly is still only the hillshade texture decoder.
 *
 * csp-report drops every `wasm-eval` report from
 * https://cdn.apple-mapkit.com/ti/csr/ as noise (Q1821,
 * supabase/functions/csp-report/report.ts). That rule was justified against
 * mk-csr.js 1.37.9 build 26.32 (sha256 12182f57...043d), whose only
 * WebAssembly is astc-loader.wasm, used for hillshade. Apple updates the
 * 1.x.x URL in place, so if a later build needs WebAssembly for the map
 * itself, the CSP blocks it and the noise rule hides the report.
 *
 * This probe fetches the live file and fails when:
 *   - the set of `*.wasm` names is not exactly {astc-loader.wasm}; or
 *   - `WebAssembly` appears outside the module that names astc-loader.wasm.
 * Modules are the minified `X(<id>,[deps],function` definitions; measured
 * 2026-11-02 on the build above: 3 modules, the wasm one at 299225..347404,
 * every one of the 6 `WebAssembly` uses inside it.
 *
 * Read-only: one GET to Apple's public CDN. Run nightly by expiry-monitor.yml.
 * Guard: src/test/mapkitWasmScope.test.ts.
 */
import { pathToFileURL } from "node:url";

export const MAPKIT_CSR_URL = "https://cdn.apple-mapkit.com/ti/csr/1.x.x/mk-csr.js";
export const EXPECTED_WASM = ["astc-loader.wasm"];

const MODULE_START = /(?<![\w$.])[A-Za-z_$][\w$]{0,2}\(\d+,\[[^\]]*\],\s*function\b/g;

/** @param {string} source */
export function mapkitWasmVerdict(source) {
  const problems = [];
  const wasmNames = [...new Set([...source.matchAll(/[\w.-]+\.wasm\b/g)].map((m) => m[0]))].sort();
  if (JSON.stringify(wasmNames) !== JSON.stringify(EXPECTED_WASM)) {
    problems.push(`wasm names are [${wasmNames.join(", ")}], expected exactly [${EXPECTED_WASM.join(", ")}]`);
  }
  const uses = [...source.matchAll(/\bWebAssembly\b/g)].map((m) => m.index ?? 0);
  const named = source.indexOf(EXPECTED_WASM[0]);
  if (uses.length > 0) {
    if (named < 0) {
      problems.push(`WebAssembly is used ${uses.length} time(s) and no module names ${EXPECTED_WASM[0]}`);
    } else {
      const starts = [...source.matchAll(MODULE_START)].map((m) => m.index ?? 0);
      const from = Math.max(0, ...starts.filter((i) => i <= named));
      const after = starts.filter((i) => i > named);
      const to = after.length ? Math.min(...after) : source.length;
      const outside = uses.filter((i) => i < from || i >= to);
      if (outside.length) {
        problems.push(`WebAssembly is used ${outside.length} time(s) outside the module that names ${EXPECTED_WASM[0]} (offsets ${outside.slice(0, 5).join(", ")})`);
      }
    }
  }
  return { ok: problems.length === 0, wasmNames, uses: uses.length, problems };
}

async function main() {
  const res = await fetch(MAPKIT_CSR_URL);
  if (!res.ok) {
    console.error(`::error::MapKit probe could not read ${MAPKIT_CSR_URL}: HTTP ${res.status}`);
    process.exit(1);
  }
  const source = await res.text();
  if (source.length < 10_000) {
    console.error(`::error::MapKit probe read only ${source.length} bytes from ${MAPKIT_CSR_URL}; not the library`);
    process.exit(1);
  }
  const v = mapkitWasmVerdict(source);
  console.log(`mk-csr.js: ${source.length} bytes, wasm names [${v.wasmNames.join(", ")}], ${v.uses} WebAssembly use(s)`);
  if (!v.ok) {
    for (const p of v.problems) console.error(`::error::MapKit WebAssembly changed: ${p}. csp-report's wasm-eval noise rule (Q1821) may now hide a broken map; re-check it.`);
    process.exit(1);
  }
  console.log("MapKit's WebAssembly is still only the hillshade decoder.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`::error::MapKit probe failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
