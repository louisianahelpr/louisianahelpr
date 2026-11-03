/**
 * Q2091: nothing noticed if Apple's MapKit started needing WebAssembly for the
 * map itself, because csp-report drops MapKit's wasm-eval reports as noise
 * (Q1821) and Apple updates https://cdn.apple-mapkit.com/ti/csr/1.x.x/mk-csr.js
 * in place. scripts/probes/mapkit-wasm-scope.probe.mjs reads the live file
 * nightly (expiry-monitor.yml) and fails when the *.wasm names are not exactly
 * {astc-loader.wasm} or WebAssembly is used outside the module that names it.
 *
 * Measured 2026-11-02 on the live file (sha256 12182f57...043d, 456807 bytes):
 * green; planting "map-render.wasm" next to the real name, or a WebAssembly
 * call in the module after it (offset 347424) or before it (197980), each red.
 *
 * @mutate scripts/probes/mapkit-wasm-scope.probe.mjs | const outside = uses.filter((i) => i < from \|\| i >= to); | const outside = uses.filter(() => false);
 * @mutate scripts/probes/mapkit-wasm-scope.probe.mjs | if (JSON.stringify(wasmNames) !== JSON.stringify(EXPECTED_WASM)) { | if (wasmNames.length === 0) {
 * @mutate .github/workflows/expiry-monitor.yml |         run: node scripts/probes/mapkit-wasm-scope.probe.mjs | 
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapkitWasmVerdict } from "../../scripts/probes/mapkit-wasm-scope.probe.mjs";

// The shape of the real file: minified modules `Y(<id>,[deps],function(...){...})`,
// the middle one fetching astc-loader.wasm and compiling it.
const before = `Y(48,[],function(){return{a:1}});`;
const wasmModule =
  `Y(148,["exports"],\nfunction(k){var w="object"!==typeof WebAssembly?Promise.reject("WebAssembly not supported"):` +
  `WebAssembly.compileStreaming;k.kT=function(A){return w(fetch((A.Ox||"")+"astc-loader.wasm"))}});`;
const after = `Y(168,[],function(){return{pq:function(k){return k}}});`;
const real = before + wasmModule + after;

describe("MapKit's WebAssembly stays the hillshade decoder (Q2091)", () => {
  it("the real shape is green", () => {
    const v = mapkitWasmVerdict(real);
    expect(v.problems).toEqual([]);
    expect(v.uses).toBeGreaterThan(2);
  });

  it("a second .wasm name is red", () => {
    const v = mapkitWasmVerdict(real.replace(`"astc-loader.wasm"`, `"astc-loader.wasm"+"map-render.wasm"`));
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toContain("map-render.wasm");
  });

  it("the hillshade name gone is red", () => {
    expect(mapkitWasmVerdict(real.replace("astc-loader.wasm", "tiles.wasm")).ok).toBe(false);
  });

  it("WebAssembly used in the module after the decoder is red", () => {
    const v = mapkitWasmVerdict(before + wasmModule + after.replace("return k", "return WebAssembly.instantiate(k)"));
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toContain("outside the module");
  });

  it("WebAssembly used in the module before the decoder is red", () => {
    expect(mapkitWasmVerdict(before.replace("a:1", "a:WebAssembly") + wasmModule + after).ok).toBe(false);
  });

  it("the nightly runs the probe", () => {
    const wf = readFileSync(".github/workflows/expiry-monitor.yml", "utf8");
    expect(wf).toMatch(/^\s+run: node scripts\/probes\/mapkit-wasm-scope\.probe\.mjs\s*$/m);
  });
});
