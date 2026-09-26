/**
 * Dispute evidence is rendered as <a href> + <img src> in the admin console and
 * in both parties' timeline dialog. A party could store any string there
 * (open_dispute_as's re-file branch, the opener's direct UPDATE, and the legacy
 * jobs.dispute_evidence_urls array): a foreign image leaks the viewer's IP, a
 * link becomes a phishing tile in the admin queue (lh-authz-rls review of the
 * dispute-races rebase, MEDIUM). The server now validates new evidence; the
 * client renders only this project's signed proof-photos URLs and says how many
 * it withheld.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { isTrustedEvidenceUrl, partitionEvidenceUrls } from "./evidenceUrl";

const BASE = "https://proj.supabase.co";
const UID1 = "11111111-2222-3333-4444-555555555555";
const JOB1 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const good = `${BASE}/storage/v1/object/sign/proof-photos/${UID1}/disputes/${JOB1}/a.jpg?token=t`;

describe("isTrustedEvidenceUrl", () => {
  it("accepts this project's signed proof-photos object URL", () => {
    expect(isTrustedEvidenceUrl(good, BASE)).toBe(true);
  });

  it.each([
    ["another host carrying the same path", `https://attacker.example/storage/v1/object/sign/proof-photos/${UID1}/disputes/${JOB1}/a.jpg`],
    ["a javascript: URL", "javascript:alert(document.domain)"],
    ["the public (not signed) object route", `${BASE}/storage/v1/object/public/proof-photos/${UID1}/disputes/${JOB1}/a.jpg`],
    ["another bucket", `${BASE}/storage/v1/object/sign/avatars/uid-1/a.jpg`],
    ["http", good.replace("https://", "http://")],
    ["garbage", "not a url"],
  ])("refuses %s", (_label, url) => {
    expect(isTrustedEvidenceUrl(url, BASE)).toBe(false);
  });

  it("partitions a list and counts what it withheld", () => {
    expect(partitionEvidenceUrls([good, "https://attacker.example/x.png", good], BASE)).toEqual({ trusted: [good, good], withheld: 1 });
  });

  it("both evidence renderers go through it", () => {
    for (const f of ["src/components/DisputeTimelineDialog.tsx", "src/components/admin/adminDisputes/DisputeCard.tsx"]) {
      expect(readFileSync(f, "utf8")).toContain("partitionEvidenceUrls(");
    }
  });
});

/*
 * THE SERVER TWIN, which this module's header asserts exists and nothing
 * checked.
 *
 * The client partition is defence-in-depth on the RENDER side — it decides
 * what to draw. The actual gate is on the WRITE side:
 * `public.dispute_evidence_url_ok`, which every evidence write is validated
 * against. Verified live on prod 2026-09-21, where it is STRICTER than the
 * client: it pins the project host, requires the object path to be
 * `<uploader>/disputes/<job_id>/<file>`, caps the length and rejects `..`.
 *
 * Without this, dropping that function would leave evidence writes unvalidated
 * server-side and every test above still green — the client would go on
 * politely withholding hostile URLs it had already stored.
 *
 * Read from the NEWEST migration that defines it, not the first: it has been
 * redefined twice (20260915071502 reapplied it, 20260915101102 changed the
 * null-uid rule), and grading a superseded copy is its own defect class.
 */
describe("the server-side write gate still exists", () => {
  const newestDef = (() => {
    const dir = resolve(__dirname, "..", "..", "supabase", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    let found: string | null = null;
    for (const f of files) {
      const sql = readFileSync(resolve(dir, f), "utf8");
      // Body, not just the header: a dollar-quoted function opens AND closes
      // with the same tag, so stopping at the first one captures nothing that
      // can be graded.
      const at = sql.search(/create\s+or\s+replace\s+function\s+public\.dispute_evidence_url_ok/i);
      if (at === -1) continue;
      const open = sql.indexOf("$function$", at);
      if (open === -1) continue;
      const close = sql.indexOf("$function$", open + "$function$".length);
      if (close === -1) continue;
      found = sql.slice(at, close);
    }
    return found;
  })();

  it("is defined by a migration at all", () => {
    expect(
      newestDef,
      "public.dispute_evidence_url_ok is gone. The client-side partition in this " +
        "file only decides what to RENDER; this function is what stops a hostile " +
        "URL being STORED in the first place.",
    ).not.toBeNull();
  });

  it("still constrains the host, the bucket and the traversal escape", () => {
    const def = newestDef ?? "";
    expect(def, "no longer pins the project host").toMatch(/https:\/\/[a-z0-9]+\\?\.supabase\\?\.co/i);
    expect(def, "no longer pins the proof-photos bucket").toContain("proof-photos");
    expect(def, "no longer rejects '..'").toMatch(/position\('\.\.'/i);
  });
});

describe("the storage PATH shape (stored since 2026-09-22) is trusted, and only it", () => {
  const UP = "11111111-2222-3333-4444-555555555555";
  const JOB = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const OK = `${UP}/disputes/${JOB}/1758000000-abc.jpg`;

  it("renders the path both writers now store", () => {
    // Before this, `new URL(path)` THREW and every path-shaped value was
    // counted as WITHHELD — invisible to the admin deciding the money split.
    expect(isTrustedEvidenceUrl(OK, BASE)).toBe(true);
    expect(partitionEvidenceUrls([OK], BASE)).toEqual({ trusted: [OK], withheld: 0 });
  });

  it("still withholds anything that could name a host we do not own", () => {
    for (const hostile of [
      `//evil.example/${UP}/disputes/${JOB}/x.jpg`,   // protocol-relative
      `/${UP}/disputes/${JOB}/x.jpg`,                  // leading slash -> authority
      `https://evil.example/${UP}/disputes/${JOB}/x.jpg`,
      `javascript:${UP}/disputes/${JOB}/x.jpg`,
      `${UP}/disputes/${JOB}/x.jpg?next=//evil.example`, // query smuggling
      `${UP}/disputes/${JOB}/../../other/x.jpg`,       // traversal
      `${UP}/disputes/${JOB}/a/b.jpg`,                 // extra segment
      `not-a-uuid/disputes/${JOB}/x.jpg`,              // uploader not pinned
      `${UP}/evidence/${JOB}/x.jpg`,                   // not the disputes prefix
    ]) {
      expect(isTrustedEvidenceUrl(hostile, BASE), hostile).toBe(false);
    }
  });
});

// The origin check IS the guard: without it any host serving the same path
// renders as a link and an <img> in the admin queue and in both parties'
// dialog — a phishing tile plus an IP leak, which is the finding this file
// was written for.
// @mutate src/lib/evidenceUrl.ts | u.origin === base.origin && | true &&

// The path branch is a SECOND trust surface, so it gets its own proof it can
// fail: widen it to accept any leading segment and a foreign host walks back in
// through the door the URL branch closes.
// @mutate src/lib/evidenceUrl.ts | /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/disputes\/ | /^.*\/disputes\/

/*
 * Q398: WHAT IS TRUSTED MUST BE IMMUTABLE TO THE PARTY WHO FILED IT.
 *
 * 20260925141905 makes exactly one folder immutable to the parties: the
 * literal, lower-case `<uid>/disputes/<job>/`. Storage names are
 * case-sensitive, so `<uid>/DISPUTES/<job>/x.jpg` and every other proof-photos
 * object (before/after proof photos) stay overwritable and deletable by their
 * uploader. An evidence value that names one of those must be withheld, on
 * BOTH branches, or the admin decides money on a photo that can change after
 * they looked. The server twin is the case-sensitive `~` in
 * dispute_evidence_url_ok and trg_jobs_dispute_evidence_append_only
 * (20260925154842).
 */
describe("only the immutable disputes folder is trusted (Q398)", () => {
  const SIGN = `${BASE}/storage/v1/object/sign/proof-photos/`;

  it("still trusts both legitimate shapes", () => {
    expect(isTrustedEvidenceUrl(`${UID1}/disputes/${JOB1}/1758-a.jpg`, BASE)).toBe(true);
    expect(isTrustedEvidenceUrl(`${SIGN}${UID1}/disputes/${JOB1}/1758-a.jpg?token=t`, BASE)).toBe(true);
  });

  it.each([
    ["an upper-case DISPUTES path", `${UID1}/DISPUTES/${JOB1}/a.jpg`],
    ["a mixed-case Disputes path", `${UID1}/Disputes/${JOB1}/a.jpg`],
    ["an upper-case job uuid", `${UID1}/disputes/${JOB1.toUpperCase()}/a.jpg`],
    ["a legacy URL to a before/after proof photo", `${SIGN}${UID1}/${JOB1}/before.jpg?token=t`],
    ["a legacy URL to any other proof-photos object", `${SIGN}${JOB1}/after-1.jpg?token=t`],
    ["a legacy URL to an upper-case DISPUTES object", `${SIGN}${UID1}/DISPUTES/${JOB1}/a.jpg?token=t`],
    ["a legacy URL with a non-uuid uploader", `${SIGN}uid-1/disputes/${JOB1}/a.jpg?token=t`],
    ["a legacy URL one folder too deep", `${SIGN}${UID1}/disputes/${JOB1}/sub/a.jpg?token=t`],
  ])("withholds %s", (_label, url) => {
    expect(isTrustedEvidenceUrl(url, BASE)).toBe(false);
  });
});

// Case-insensitive again, and `<uid>/DISPUTES/<job>/…` — an object its uploader
// can still overwrite or delete — renders as trusted evidence (Q398).
// @mutate src/lib/evidenceUrl.ts | \\:]+$/; | \\:]+$/i;

// Unpin the legacy branch and a signed URL to a mutable before/after proof
// photo renders as trusted evidence (Q398).
// @mutate src/lib/evidenceUrl.ts | LEGACY_SIGNED_PATH_RE.test(u.pathname) && | u.pathname.startsWith("/storage/v1/object/sign/proof-photos/") &&
