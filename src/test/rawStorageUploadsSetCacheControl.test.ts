/**
 * Q349 class — every RAW Storage upload in this repo sends Cache-Control.
 *
 * Storage stores an object uploaded over plain HTTP WITHOUT a cache-control
 * header as `Cache-Control: no-cache`, so every view of it is a fresh download.
 * storage-js never does this (it always sends `max-age=3600`, its
 * DEFAULT_FILE_OPTIONS), but a hand-written `fetch` to /storage/v1/object/...
 * does, and that is the shape of the one real `no-cache` avatar Q349 found
 * (written by service role, owner_id NULL). Measured 2026-09-26: 5 raw uploads
 * in the repo, 4 without the header (scripts/audit/prod-seed.mjs twice, one
 * of them sending the invalid value "3600"; the message-attachments probe; the
 * prod-audit harness; the privacy spec).
 *
 * A raw upload is recognised by its `x-upsert` header, which only a direct
 * Storage object write sends.
 *
 * Q655 widened it: scripts/e2e/settleForward.mjs POSTed proof photos with no
 * x-upsert header and no cache-control, so the first test never saw it and 63
 * proof-photos objects were stored `no-cache`. The second test finds every raw
 * write by its URL instead (a POST/PUT to /storage/v1/object/<bucket>/<path>),
 * and requires a year on the image buckets, whose keys are unique per upload.
 */
// @mutate scripts/audit/prod-seed.mjs | "Content-Type": "image/png", "x-upsert": "true", "cache-control": "max-age=3600" }, | "Content-Type": "image/png", "x-upsert": "true" },
// @mutate scripts/e2e/settleForward.mjs | "Content-Type": "image/png", "cache-control": "max-age=31536000" }, | "Content-Type": "image/png" },
// @mutate scripts/probes/message-attachments-authz.prod.mjs | "x-upsert": "false", "cache-control": "max-age=31536000" });\nconst sign | "x-upsert": "false", "cache-control": "max-age=3600" });\nconst sign
// @mutate e2e/prod-audit/harness.ts | "x-upsert": "false", "cache-control": "max-age=3600" } | "x-upsert": "false" }
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");

/** Buckets whose keys are unique per upload: the Q655 done-when buckets. */
const YEAR_BUCKETS = new Set(["job-photos", "proof-photos", "message-attachments"]);

function scanned() {
  return walkSource(
    ["scripts", "e2e", "supabase/functions", "src"].map((d) => resolve(ROOT, d)),
    [".ts", ".tsx", ".mjs", ".js"],
  ).filter((f) => !/\.test\.tsx?$/.test(f));
}

/** The text of the call starting at `open` (the `(`), through its matching `)`. */
function callText(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

// An object write URL: /storage/v1/object/<bucket>/<path>, not one of the
// read/admin sub-routes (list, sign, public, authenticated, info, move, copy).
const OBJECT_URL = /\/storage\/v1\/object\/(?!(?:list|sign|public|authenticated|info|move|copy|upload)\/)([a-z0-9-]+|\$\{[^}]+\})\/[^`"'\s]*/g;
// The call the URL is the first argument of, opened on the same line.
const CALL_OPEN = /(?:\bfetch|\.post|\.put|\bcall)\(\s*(?:["'](?:POST|PUT)["']\s*,\s*)?[^()\n]*$/;

function rawWrites() {
  const out: { where: string; bucket: string; call: string }[] = [];
  for (const f of scanned()) {
    const src = blankComments(readFileSync(f, "utf8"));
    for (const m of src.matchAll(OBJECT_URL)) {
      const at = m.index ?? 0;
      const prefix = src.slice(src.lastIndexOf("\n", at) + 1, at);
      const open = CALL_OPEN.exec(prefix);
      if (!open) continue; // a string compared or tested, not a request
      const call = callText(src, at - prefix.length + open.index + open[0].indexOf("("));
      const isWrite = /\.(post|put)\($/.test(prefix.slice(open.index, open.index + open[0].indexOf("(") + 1))
        || /^\(\s*["'](POST|PUT)["']/.test(call)
        || /method\s*:\s*["'](POST|PUT)["']/.test(call);
      if (!isWrite) continue;
      out.push({ where: `${relative(ROOT, f)}:${src.slice(0, at).split("\n").length}`, bucket: m[1], call });
    }
  }
  return out;
}

describe("raw Storage uploads set Cache-Control (Q349)", () => {
  // Every such header set in the repo is written on one line; a multi-line one
  // would be seen by its x-upsert line only, so keep them on one line.
  it("every header set carrying x-upsert also carries cache-control: max-age=…", () => {
    const files = scanned();
    const sites: { where: string; ok: boolean }[] = [];
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      src.split("\n").forEach((text, i) => {
        if (!/["']x-upsert["']\s*:/.test(text)) return;
        sites.push({ where: `${relative(ROOT, f)}:${i + 1}`, ok: /["']cache-control["']\s*:\s*["']max-age=\d+["']/i.test(text) });
      });
    }
    // Floor: the five measured on 2026-09-26. Far fewer means the scan broke.
    expect(sites.length).toBeGreaterThanOrEqual(5);
    expect(sites.filter((s) => !s.ok).map((s) => s.where), "raw Storage upload without cache-control: stored as no-cache").toEqual([]);
  });

  it("every raw object write sends cache-control; image buckets send a year (Q655)", () => {
    const writes = rawWrites();
    // Floor: 8 raw object writes measured on 2026-09-28. Far fewer means the scan broke.
    expect(writes.length).toBeGreaterThanOrEqual(8);
    const bad = writes
      .filter((w) => {
        const cc = /["']cache-control["']\s*:\s*["']max-age=(\d+)["']/i.exec(w.call);
        if (!cc) return true;
        return YEAR_BUCKETS.has(w.bucket) && cc[1] !== "31536000";
      })
      .map((w) => `${w.where} (${w.bucket})`);
    expect(bad, "raw Storage write without cache-control, or an image bucket cached under a year").toEqual([]);
  });
});
