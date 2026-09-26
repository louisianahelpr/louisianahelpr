#!/usr/bin/env node
/**
 * Rebuild a loading-states measurements.json from a loading-states-refresh
 * job log (the "Print the measurement into the log" step, branch dispatches
 * only). For a session that cannot reach the artifact host: the log is served
 * by the GitHub API, the artifact by Azure blob storage.
 *
 *   node scripts/audit/measurement-from-log.mjs <job.log> [out.json]
 *
 * Refuses unless the decoded file's sha256 equals the one the job printed.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const [, , logPath, out = "docs/audit/loading-states/measurements.json"] = process.argv;
if (!logPath) {
  console.error("usage: node scripts/audit/measurement-from-log.mjs <job.log> [out.json]");
  process.exit(2);
}
const lines = readFileSync(logPath, "utf8").split(/\r?\n/);
const begin = lines.findIndex((l) => /LSM-BEGIN [0-9a-f]{64}/.test(l));
const end = lines.findIndex((l, i) => i > begin && /LSM-END/.test(l));
if (begin < 0 || end < 0) {
  console.error("no LSM-BEGIN / LSM-END block in that log");
  process.exit(1);
}
const want = /LSM-BEGIN ([0-9a-f]{64})/.exec(lines[begin])[1];
const b64 = lines.slice(begin + 1, end).map((l) => /LSM: (\S+)/.exec(l)?.[1] ?? "").join("");
let json;
try {
  json = gunzipSync(Buffer.from(b64, "base64"));
} catch (e) {
  console.error(`the LSM block does not decompress (${e.code ?? e.message}): the log is truncated or altered; not writing`);
  process.exit(1);
}
const got = createHash("sha256").update(json).digest("hex");
if (got !== want) {
  console.error(`sha256 mismatch: log says ${want}, decoded ${got}; not writing`);
  process.exit(1);
}
JSON.parse(json.toString("utf8"));
writeFileSync(out, json);
console.log(`wrote ${out} (${json.length} bytes, sha256 ${got})`);
