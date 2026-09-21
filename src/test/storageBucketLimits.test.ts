// CLASS CHECK for authz-rls H-003 (2026-09-15): a PUBLIC storage bucket with
// no `file_size_limit` and no `allowed_mime_types` is an unbounded, arbitrary-
// type, world-readable file host. `job-photos` shipped that way; `marketing-
// media` and `social-posts` had the same gap. This test derives every bucket's
// FINAL declared state from the migrations (the `public` flag has been flipped
// back and forth, so we replay the writes in timestamp order rather than trust
// any single statement) and fails if any bucket that ends up public lacks
// either limit.
//
// Migration-derived, not live-catalog: this session may only issue anon-key
// GETs, and the lead verifies the same properties against prod before landing.
// A from-scratch replay of the migrations is exactly what deploys to prod, so
// the declared final state is the right source of truth for a CI guard.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(__dirname, "..", "..", "supabase", "migrations");

interface BucketState {
  isPublic: boolean;
  hasSize: boolean;
  hasMime: boolean;
}

/** Split `s` on top-level occurrences of `sep`, ignoring separators inside
 * single-quoted strings, parentheses, or square brackets (ARRAY[...]). */
function splitTopLevel(s: string, sep = ","): string[] {
  const out: string[] = [];
  let depthParen = 0;
  let depthBracket = 0;
  let inStr = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === "'") {
        // '' is an escaped quote inside a string literal.
        if (s[i + 1] === "'") { cur += s[++i]; } else { inStr = false; }
      }
      continue;
    }
    if (c === "'") { inStr = true; cur += c; continue; }
    if (c === "(") depthParen++;
    else if (c === ")") depthParen--;
    else if (c === "[") depthBracket++;
    else if (c === "]") depthBracket--;
    if (c === sep && depthParen === 0 && depthBracket === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

/** The top-level `( ... )` groups inside a VALUES clause. */
function parenGroups(s: string): string[] {
  const groups: string[] = [];
  let depth = 0;
  let inStr = false;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "'") { if (s[i + 1] === "'") i++; else inStr = false; }
      continue;
    }
    if (c === "'") { inStr = true; continue; }
    if (c === "(") { if (depth === 0) start = i + 1; depth++; }
    else if (c === ")") { depth--; if (depth === 0 && start >= 0) groups.push(s.slice(start, i)); }
  }
  return groups;
}

const unquote = (v: string) => v.trim().replace(/^'(.*)'$/s, "$1");
const isNonNull = (v: string) => v.trim().toLowerCase() !== "null" && v.trim() !== "";

/** Apply every `INSERT INTO storage.buckets` and `UPDATE storage.buckets` in a
 * migration file to the running state map. */
function applyMigration(sql: string, state: Map<string, BucketState>): void {
  const ensure = (id: string): BucketState => {
    let b = state.get(id);
    if (!b) { b = { isPublic: false, hasSize: false, hasMime: false }; state.set(id, b); }
    return b;
  };

  // INSERT INTO storage.buckets (cols) VALUES (...)[, (...)] [ON CONFLICT ...]
  const insertRe = /insert\s+into\s+storage\.buckets\s*\(([^)]*)\)\s*values\s*([\s\S]*?)(?:on\s+conflict|;)/gi;
  for (const m of sql.matchAll(insertRe)) {
    const cols = m[1].split(",").map((c) => c.trim().toLowerCase());
    const idIdx = cols.indexOf("id");
    const pubIdx = cols.indexOf("public");
    const sizeIdx = cols.indexOf("file_size_limit");
    const mimeIdx = cols.indexOf("allowed_mime_types");
    for (const group of parenGroups(m[2])) {
      const fields = splitTopLevel(group);
      if (idIdx < 0 || idIdx >= fields.length) continue;
      const id = unquote(fields[idIdx]);
      if (!id) continue;
      const b = ensure(id);
      if (pubIdx >= 0 && pubIdx < fields.length) {
        b.isPublic = fields[pubIdx].trim().toLowerCase() === "true";
      }
      if (sizeIdx >= 0 && sizeIdx < fields.length && isNonNull(fields[sizeIdx])) b.hasSize = true;
      if (mimeIdx >= 0 && mimeIdx < fields.length && isNonNull(fields[mimeIdx])) b.hasMime = true;
    }
  }

  // UPDATE storage.buckets SET <set> WHERE <where>;  (also matches inside DO $$ blocks)
  const updateRe = /update\s+storage\.buckets\s+set\s+([\s\S]*?)\s+where\s+([\s\S]*?);/gi;
  for (const m of sql.matchAll(updateRe)) {
    const setClause = m[1];
    const whereClause = m[2];
    const ids = [...whereClause.matchAll(/'([^']+)'/g)].map((x) => x[1]);
    if (ids.length === 0) continue;
    const pub = setClause.match(/public\s*=\s*(true|false)/i);
    const size = setClause.match(/file_size_limit\s*=\s*([^,]+)/i);
    const mime = setClause.match(/allowed_mime_types\s*=\s*([^,]+)/i);
    for (const id of ids) {
      const b = ensure(id);
      if (pub) b.isPublic = pub[1].toLowerCase() === "true";
      if (size && isNonNull(size[1])) b.hasSize = true;
      if (mime && isNonNull(mime[1])) b.hasMime = true;
    }
  }
}

/** Replay the migrations (optionally excluding one filename) into a final
 * per-bucket state map. */
function computeState(excludeFile?: string): Map<string, BucketState> {
  const state = new Map<string, BucketState>();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (f === excludeFile) continue;
    applyMigration(readFileSync(resolve(MIGRATIONS_DIR, f), "utf8"), state);
  }
  return state;
}

const THIS_FIX = "20260915055517_storage_bucket_limits.sql";

function offendingPublicBuckets(state: Map<string, BucketState>): string[] {
  return [...state.entries()]
    .filter(([, b]) => b.isPublic && (!b.hasSize || !b.hasMime))
    .map(([id]) => id)
    .sort();
}

describe("storage bucket size/MIME caps (authz-rls H-003 class check)", () => {
  const state = computeState();

  it("parser actually sees the buckets (guards against a check that cannot fail)", () => {
    // If the parser silently found nothing, every downstream assertion would
    // pass vacuously — so pin the buckets we know must be present and public.
    expect(state.get("job-photos")?.isPublic).toBe(true);
    expect(state.get("avatars")?.isPublic).toBe(true);
    expect(state.get("marketing-media")?.isPublic).toBe(true);
  });

  const publicBuckets = [...state.entries()]
    .filter(([, b]) => b.isPublic)
    .map(([id]) => id)
    .sort();

  it.each(publicBuckets)(
    "public bucket '%s' declares both a file_size_limit and allowed_mime_types",
    (id) => {
      const b = state.get(id)!;
      expect(b.hasSize, `${id} has no file_size_limit`).toBe(true);
      expect(b.hasMime, `${id} has no allowed_mime_types`).toBe(true);
    },
  );

  /*
   * PRIVATE BUCKETS TOO — the gap this guard had.
   *
   * It judged only buckets that end up `public`, so four private ones sat at
   * `file_size_limit = NULL, allowed_mime_types = NULL` on prod for months and
   * this file was green the whole time: application-attachments, id-documents,
   * proof-photos, user-documents. Measured live 2026-09-21.
   *
   * "Private" bounds WHO CAN READ, not what can be written. Any authenticated
   * caller holding an INSERT policy could upload an executable, or a file large
   * enough to eat the free-tier storage quota. And `message-attachments` is
   * private and DOES carry both caps, so the inconsistency was an oversight
   * rather than a decision about private buckets.
   *
   * Capped by 20260921092104 at 10 MB — twice the 5 MB every one of these
   * surfaces already enforces in the browser, so nothing legitimate breaks.
   */
  it("no bucket is left uncapped, private ones included", () => {
    const uncapped = [...state.entries()]
      .filter(([, b]) => !b.hasSize || !b.hasMime)
      .map(([id, b]) => `${id} (${b.isPublic ? "public" : "private"}, size=${b.hasSize}, mime=${b.hasMime})`);
    expect(
      uncapped,
      "a bucket with no size limit and no MIME allow-list accepts a file of ANY size and ANY type " +
        "from anyone holding an INSERT policy. Private only bounds who can READ it.",
    ).toEqual([]);
  });

  it("no public bucket is left uncapped", () => {
    expect(offendingPublicBuckets(state)).toEqual([]);
  });

  it("is able to fail: without this migration, job-photos/marketing-media/social-posts are uncapped", () => {
    // Proves the guard is not vacuous — it goes RED on the pre-fix tree.
    const before = offendingPublicBuckets(computeState(THIS_FIX));
    expect(before).toContain("job-photos");
    expect(before).toContain("marketing-media");
    expect(before).toContain("social-posts");
  });
});

// PROVEN RED 2026-09-21: dropping job-photos' file_size_limit fails both
// "public bucket 'job-photos' declares both …" and "no public bucket is left
// uncapped" with + ["job-photos"].
// SOURCE-TEXT PIN, stated at the top of this file and worth restating: it
// replays MIGRATIONS. A bucket whose limits are changed in the Supabase
// dashboard, or a bucket created outside a migration, is invisible to it.
// @mutate supabase/migrations/20260915055517_storage_bucket_limits.sql | SET file_size_limit  = 50 * 1024 * 1024, | SET file_size_limit  = NULL,
