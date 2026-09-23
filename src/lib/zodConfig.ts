/**
 * Zod runs jitless (Q83, 2026-09-23).
 *
 * Zod v4 probes `new Function("")` (util.allowsEval) the first time an object
 * schema is built, to decide whether to JIT its parser. Our CSP has no
 * `unsafe-eval`, so every page logged one blocked-eval CSP report: harmless,
 * but noise in every CSP report stream. With `jitless`, zod never evaluates
 * the probe (`jit && allowsEval.value` short-circuits) and uses its plain
 * parser. It must run before any schema is built, so every module that
 * imports zod imports this first (src/test/zodIsJitless.test.ts).
 */
import { config } from "zod";

config({ jitless: true });
