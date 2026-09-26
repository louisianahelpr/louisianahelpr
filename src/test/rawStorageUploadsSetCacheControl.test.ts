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
 */
// @mutate scripts/audit/prod-seed.mjs | "Content-Type": "image/png", "x-upsert": "true", "cache-control": "max-age=3600" }, | "Content-Type": "image/png", "x-upsert": "true" },
// @mutate e2e/prod-audit/harness.ts | "x-upsert": "false", "cache-control": "max-age=3600" } | "x-upsert": "false" }
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");

describe("raw Storage uploads set Cache-Control (Q349)", () => {
  // Every such header set in the repo is written on one line; a multi-line one
  // would be seen by its x-upsert line only, so keep them on one line.
  it("every header set carrying x-upsert also carries cache-control: max-age=…", () => {
    const files = walkSource(
      ["scripts", "e2e", "supabase/functions", "src"].map((d) => resolve(ROOT, d)),
      [".ts", ".tsx", ".mjs", ".js"],
    ).filter((f) => !/\.test\.tsx?$/.test(f));
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
});
