/**
 * Whole-repo `vitest run` takes the machine-wide gate lock, so a plain
 * `npx vitest run` from a terminal or agent waits its turn instead of piling
 * up (2026-09-13: three at once put an 8GB Mac at load 58 and stalled every
 * lane). Scoped runs (file filters), watch mode, CI and runs already under
 * `npm run test:unit` (LH_GATE_LOCK_HELD) skip it.
 */
// @ts-expect-error — plain .mjs helper without type declarations
import { acquireGateLock, releaseGateLock } from "../../scripts/gateLock.mjs";

export function isWholeRepoRun(argv: string[]): boolean {
  const i = argv.findIndex((a) => a === "run");
  if (i === -1) return false; // watch mode would hold the lock forever
  const rest = argv.slice(i + 1);
  for (let k = 0; k < rest.length; k++) {
    const a = rest[k];
    if (a.startsWith("-")) {
      // flags that take a separate value: skip it
      if (!a.includes("=") && /^--(reporter|outputFile|project|config|root|dir|shard|pool|environment)$/.test(a)) k++;
      continue;
    }
    return false; // a positional file filter
  }
  return true;
}

export default async function setup() {
  if (!isWholeRepoRun(process.argv)) return;
  console.log("[gate-lock] whole-repo vitest run: acquiring the gate lock…");
  await acquireGateLock();
  return () => releaseGateLock();
}
