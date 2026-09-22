/**
 * A SIGNED URL IS A TICKET, NOT AN ADDRESS — the class guard for "stored a
 * token, rendered it months later, got a broken image".
 *
 * `supabase.storage.from(<private bucket>).createSignedUrl(path, ttl)` returns
 * a URL whose `?token=` is a JWT with an `exp` baked into it. Writing that
 * string into a database column stores a value that is CORRECT on the day it
 * is written and 400s forever after `exp`. Nothing fails at write time,
 * nothing fails at read time, and the only symptom is an empty box with its
 * alt text showing — the shape of the owner's 2026-09-21 report.
 *
 * The repo already knows the right pattern and wrote it down in a migration:
 *
 *   'Storage path within the user-documents bucket …, NOT a full URL.
 *    Resolve via supabase.storage.from("user-documents").createSignedUrl(path,
 *    ttl) at display time. Bucket is private as of 2026-05-05.'
 *   — supabase/migrations/20260505220000_split_avatars_bucket_private_user_documents.sql
 *
 * Store the PATH; mint the ticket when someone is actually looking.
 *
 * ── WHY THE TTL IS THE TEST ──────────────────────────────────────────────
 * "Does this token get written to the database" is not decidable from the
 * source without following the value, and the two coarse versions of that walk
 * both produced false positives on display-time resolvers (CredentialsTab
 * opens a document AND saves a path; loadConversations resolves avatars AND
 * marks a thread read). The TTL decides it cleanly and says the same thing:
 *
 *   a token minted to outlive the page view is a token minted to be STORED.
 *
 * Every display-time resolver in the app signs in MINUTES — 300s
 * (CredentialsTab, AdminCredentialQueue), 3600s (useOpenProfile), 5 and 10
 * minutes (messageAttachments, applicationAttachments). Every persisted one
 * signs for a YEAR, or thirty days. The threshold sits in the gap.
 *
 * ── WHAT IS ACTUALLY IN PROD (read-only, fncmgoasalhdgfwzhsqa, 2026-09-21) ──
 * 44 persisted signed URLs across `jobs.proof_before_urls` (22) and
 * `jobs.proof_after_urls` (22), every one minted with a 365-day TTL:
 *
 *   earliest exp 2027-09-07,  latest exp 2027-09-18,  already expired 0
 *
 * So this is not yet broken — it is a dated fuse, and the date is a year from
 * the day each photo was taken. `disputes.evidence_urls` and
 * `jobs.dispute_evidence_urls` hold none today only because no dispute has
 * carried evidence through those paths yet; the code that fills them is the
 * same code.
 *
 * Offenders are PINNED with the column their token lands in, so the list can
 * only shrink: fix one and this test tells you to delete its pin.
 *
 * PhotoProof.tsx — the only one with data behind it — was fixed on 2026-09-22
 * (path stored, signed at display time) and its 93 stored values converted by
 * 20260922170321_proof_photo_urls_to_paths.sql. FOUR pins remain, all of them
 * code-only: nothing has yet been written through those paths in prod.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

/**
 * The line between "minted for this page view" and "minted to be stored".
 * A day: longer than any session, shorter than every persisted token here.
 */
const DISPLAY_TTL_CEILING = 60 * 60 * 24;

/** Known offenders, each with the column the token lands in. */
const PINNED: Record<string, string> = {
  // components/PhotoProof.tsx was here. FIXED 2026-09-22: it stores the
  // storage PATH and signs at display time (src/lib/proofPhotoStorage.ts,
  // src/hooks/useProofPhotoUrls.ts), and the 93 values already written down
  // were converted by 20260922170321_proof_photo_urls_to_paths.sql.
  "components/DisputeDialog.tsx":
    "365-day token -> dispute evidence via the file-dispute RPC",
  "components/DisputeTimelineDialog.tsx":
    "365-day token -> disputes.evidence_urls and jobs.dispute_evidence_urls",
  "components/activity/CompletionChoiceSheet.tsx":
    "365-day token -> job_revisions photos and the jobs row it updates",
  "components/profile/SupportInline.tsx":
    "30-day token pasted into reports.description; the file says so and accepts it ('older ones can be re-fetched by path if needed')",
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (entry === "test" || entry === "__fixtures__" || entry === "fixtures") continue;
      sourceFiles(abs, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    out.push(abs);
  }
  return out;
}

/**
 * The TTL argument of every `createSignedUrl(path, ttl)` whose ttl is a
 * literal product of numbers (`300`, `60 * 60 * 24 * 365`). A ttl passed as a
 * variable is a resolver's parameter, not a decision this call site made, and
 * is left to that resolver's own default.
 */
const TTL_RE = /createSignedUrls?\(\s*[^,()]+,\s*((?:\d+\s*\*\s*)*\d+)\s*\)/g;

function evalProduct(expr: string): number {
  return expr.split("*").reduce((acc, n) => acc * Number(n.trim()), 1);
}

/** Files that mint a signed URL intended to outlive the page view. */
function longLivedTokens(): { file: string; seconds: number }[] {
  const found: { file: string; seconds: number }[] = [];
  for (const abs of sourceFiles(SRC)) {
    const src = readFileSync(abs, "utf8");
    if (!src.includes("createSignedUrl")) continue;
    for (const m of src.matchAll(TTL_RE)) {
      const seconds = evalProduct(m[1]);
      if (seconds >= DISPLAY_TTL_CEILING) {
        found.push({ file: relative(SRC, abs), seconds });
      }
    }
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

describe("a signed URL is never persisted", () => {
  it("no NEW call site mints a token meant to outlive the page view", () => {
    const unpinned = [...new Set(longLivedTokens().map((t) => t.file))].filter(
      (f) => !(f in PINNED),
    );
    expect(
      unpinned,
      "These files call `createSignedUrl(path, ttl)` with a ttl of a day or more. " +
        "A token that long is a token being kept, and a kept token is a stored `exp`: " +
        "the row is correct the day it is written and 400s after it, with no error on " +
        "either side — the reader just gets an empty box with its alt text. Store the " +
        "PATH and sign at display time (see the user-documents column comment in " +
        "20260505220000_split_avatars_bucket_private_user_documents.sql).",
    ).toEqual([]);
  });

  it("every pin is still a real offender, so the list can only shrink", () => {
    // A pin that no longer describes anything is a permanent exemption wearing
    // a temporary name. Fix a file and this fails until its pin goes.
    const current = new Set(longLivedTokens().map((t) => t.file));
    const stale = Object.keys(PINNED).filter((f) => !current.has(f));
    expect(
      stale,
      "These files are pinned as minting a long-lived signed URL but no longer do. " +
        "Delete their entries from PINNED (and the matching line in docs/OPEN.md).",
    ).toEqual([]);
  });

  it("the scan reaches the files it claims to scan", () => {
    // Vacuity floor: a broken walk returns [] and every assertion above passes.
    expect(sourceFiles(SRC).length, "no source files scanned").toBeGreaterThan(300);
    expect(
      longLivedTokens().length,
      "the scan found no long-lived signed URL at all — it cannot have run",
    ).toBeGreaterThanOrEqual(4);
  });

  it("the threshold does not swallow the app's real display-time TTLs", () => {
    // 300s, 3600s, 5 and 10 minutes are what every resolver in the app uses.
    // If DISPLAY_TTL_CEILING ever dropped to those, the first assertion would
    // fail on files that are doing the right thing and the pin list would grow.
    for (const ttl of [300, 3600, 60 * 5, 60 * 10]) {
      expect(ttl).toBeLessThan(DISPLAY_TTL_CEILING);
    }
  });
});

// SHOWN ABLE TO FAIL: a new call site that keeps its token for a year is the
// whole defect class, and it must not be able to land quietly.
// @mutate src/lib/applicationAttachments.ts | .createSignedUrl(path, expiresInSeconds); | .createSignedUrl(path, 60 * 60 * 24 * 365);
