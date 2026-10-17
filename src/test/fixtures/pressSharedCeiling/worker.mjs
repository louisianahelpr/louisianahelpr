// One simulated press shard for pressSharedCeiling.test.ts: paces through the
// REAL sharedCeilingDecision against a leg directory shared with its sibling, on
// a fast fake minute, "sends" `burst` requests per cycle it is let through
// (a light shard, every > 1, sends 1 on all but every `every`-th cycle), and
// writes what it sent per minute.
//   node worker.mjs <module> <dir> <shard> <out> <ceiling> <burst> <every> <runMs> <minuteMs>
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [mod, dir, shard, out, ceiling, burst, every, runMs, minuteMs] = process.argv.slice(2);
const { sharedCeilingDecision } = await import(pathToFileURL(mod).href);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sent = {};
const end = Date.now() + Number(runMs);
let cycle = 0;
while (Date.now() < end) {
  // Its requests count in the minute the decision was taken for.
  const { waitMs, minute } = sharedCeilingDecision({ dir, shard, used: (m) => sent[m] ?? 0, ceiling: Number(ceiling), burst: Number(burst), minuteMs: Number(minuteMs) });
  if (waitMs > 0) { sleep(Math.min(waitMs, Number(minuteMs))); continue; }
  const n = ++cycle % Number(every) === 0 ? Number(burst) : 1;
  sent[minute] = (sent[minute] ?? 0) + n;
  sleep(1);
}
writeFileSync(out, JSON.stringify(sent));
