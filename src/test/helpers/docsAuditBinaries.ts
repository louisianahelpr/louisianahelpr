// Q1306: what counts as binary audit output under docs/audit, and the tracked
// files that match. Its own module so the guard's @mutate (in
// src/test/docsAuditBinaries.test.ts) can break the detector without also
// matching the comment that names it.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const REPO = resolve(__dirname, "../../..");
export const AUDIT_BINARY = /\.(png|jpe?g|gif|webp|avif|heic|bmp|tiff?|mp4|mov|webm|zip|gz|tgz|pdf)$/i;

/** Every path git tracks under docs/audit (the index, not the disk). */
export function trackedAuditFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", "docs/audit"], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 26 })
    .split("\0")
    .filter(Boolean);
}
