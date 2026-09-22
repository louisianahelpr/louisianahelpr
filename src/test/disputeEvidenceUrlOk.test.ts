/**
 * THE DISPUTE-EVIDENCE VALIDATOR MAY BE WIDENED, NEVER UNPINNED.
 *
 * `public.dispute_evidence_url_ok(_url, _uploader, _job_id)` is the single
 * predicate behind all THREE evidence writers — `open_dispute_as` (reached by
 * `rpc_open_dispute`), `rpc_add_dispute_evidence`, and the BEFORE UPDATE
 * trigger `trg_dispute_evidence_append_only` on `disputes`. What it accepts is
 * what an admin later sees in the dispute console and decides a money split
 * from, so it carries two jobs at once:
 *
 *   1. it must ACCEPT the shapes the client legitimately writes, or dispute
 *      filing breaks outright on the money path; and
 *   2. it must PIN the uploader and the job — a party may attach only their
 *      own upload for this job, never an arbitrary URL and never somebody
 *      else's photo.
 *
 * Those two pull in opposite directions, and 20260922172945 had to widen it
 * (store-the-path, sign-at-display needs the bare
 * `<uploader>/disputes/<job>/<file>` form accepted alongside the legacy signed
 * URL). The failure mode this guards is the easy, invisible one: widening the
 * pattern one notch too far — `.*` where `^` belonged, `[^/]+` where the
 * caller's own uuid belonged — which loosens authorisation while every test
 * that only asks "does a good value still pass?" stays green.
 *
 * So this test does not re-state the regex. It EXTRACTS the alternatives from
 * the migration that is actually shipping and runs adversarial values through
 * them. Rewrite the predicate however you like; unpin it and this goes red.
 *
 * (The JS translation is exact for these patterns: POSIX ERE and JS RegExp
 * agree on `^ $ | ( ) [^…] + ? \.` — the only constructs used. The same ten
 * cases were A/B-proven against the LIVE prod function in a rolled-back DO
 * block before the migration landed: under the old definition the bare path
 * was rejected, under the new one both forms pass and all eight hostile
 * shapes still fail.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/** The newest migration that defines the validator — the one in force. */
function validatorSource(): string {
  const file = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) =>
      readFileSync(join(MIGRATIONS, f), "utf8").includes(
        "FUNCTION public.dispute_evidence_url_ok(",
      ),
    );
  if (!file) throw new Error("no migration defines dispute_evidence_url_ok");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

/**
 * Every `_url ~ (<chain>)` alternative in the predicate, where <chain> is built
 * only from SQL string literals, `||`, and the two uuid arguments. A chain that
 * derived its uuids from anywhere else would not match this shape at all — and
 * the count assertion below then fails, which is the intended outcome: this
 * test is not able to vouch for a predicate it cannot read.
 */
const ALT_RE =
  /_url\s*~\s*\(\s*((?:'(?:[^']|'')*'|_uploader::text|_job_id::text|\s*\|\|\s*)+?)\s*\)/g;

type Alt = { chain: string; usesUploaderArg: boolean; usesJobArg: boolean };

function alternatives(sql: string): Alt[] {
  const body = sql.slice(sql.indexOf("AS $function$"), sql.lastIndexOf("$function$"));
  const out: Alt[] = [];
  for (const m of body.matchAll(ALT_RE)) {
    const chain = m[1];
    out.push({
      chain,
      usesUploaderArg: chain.includes("_uploader::text"),
      usesJobArg: chain.includes("_job_id::text"),
    });
  }
  return out;
}

/** Render one alternative's chain as a concrete regex for a given caller. */
function toRegExp(chain: string, uploader: string, jobId: string): RegExp {
  const pattern = chain
    .split("||")
    .map((tok) => {
      const t = tok.trim();
      if (t === "_uploader::text") return uploader;
      if (t === "_job_id::text") return jobId;
      if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
      throw new Error(`unrecognised token in predicate chain: ${t}`);
    })
    .join("");
  return new RegExp(pattern);
}

/** The non-regex guards the SQL applies before the pattern ever runs. */
function preGuards(url: string): boolean {
  return url.length <= 2048 && !url.includes("..");
}

const U = "11111111-1111-1111-1111-111111111111"; // the caller
const OTHER_U = "22222222-2222-2222-2222-222222222222";
const J = "33333333-3333-3333-3333-333333333333"; // this job
const OTHER_J = "44444444-4444-4444-4444-444444444444";
const HOST = "https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/sign/proof-photos/";

const ALTS = alternatives(validatorSource());

/** The shipping predicate, evaluated for caller U on job J. */
function accepts(url: string): boolean {
  return preGuards(url) && ALTS.some((a) => toRegExp(a.chain, U, J).test(url));
}

describe("dispute_evidence_url_ok", () => {
  it("reads the predicate it claims to test", () => {
    // Vacuity floor. A broken extraction yields [] and every `.some()` below
    // returns false, which would make the whole hostile half pass for free.
    expect(ALTS.length, "no _url ~ (...) alternative extracted").toBeGreaterThanOrEqual(2);
  });

  it("accepts BOTH forms, so the rollout is not a flag day", () => {
    // Legacy: what every existing row and today's client hold.
    expect(accepts(`${HOST}${U}/disputes/${J}/1758-abc.jpg?token=eyJhbGci`)).toBe(true);
    // New: the storage path, signed at display time.
    expect(accepts(`${U}/disputes/${J}/1758-abc.jpg`)).toBe(true);
  });

  it("still pins the uploader and the job", () => {
    // Someone else's upload, this job.
    expect(accepts(`${OTHER_U}/disputes/${J}/1758-abc.jpg`)).toBe(false);
    expect(accepts(`${HOST}${OTHER_U}/disputes/${J}/1758-abc.jpg?token=x`)).toBe(false);
    // My upload, a different job.
    expect(accepts(`${U}/disputes/${OTHER_J}/1758-abc.jpg`)).toBe(false);
    expect(accepts(`${HOST}${U}/disputes/${OTHER_J}/1758-abc.jpg?token=x`)).toBe(false);
  });

  it("refuses every way out of the pinned folder", () => {
    expect(accepts(`${U}/disputes/${J}/sub/1758-abc.jpg`)).toBe(false); // extra segment
    expect(accepts(`${U}/disputes/${J}/../../x.jpg`)).toBe(false); // traversal
    expect(accepts(`/${U}/disputes/${J}/1758-abc.jpg`)).toBe(false); // leading slash
    expect(accepts(`x/${U}/disputes/${J}/1758-abc.jpg`)).toBe(false); // unanchored prefix
    expect(accepts(`https://attacker.example/${U}/disputes/${J}/x.jpg`)).toBe(false);
  });

  it("refuses a token on the path form — a path is not a ticket", () => {
    // The whole point of the widening is that nothing carrying an `exp` gets
    // written down. A path branch that tolerated `?token=` would let the very
    // value this change exists to stop back in through the new door.
    expect(accepts(`${U}/disputes/${J}/1758-abc.jpg?token=eyJhbGci`)).toBe(false);
  });

  it("derives the uuids from the ARGUMENTS, never from the url", () => {
    // Structural, and the reason the hostile cases above can be trusted: a
    // pattern that matched `[0-9a-f-]+` in the uploader position would pass
    // every "does a good value work" test ever written.
    for (const alt of ALTS) {
      expect(alt.usesUploaderArg, `alternative does not pin _uploader: ${alt.chain}`).toBe(true);
      expect(alt.usesJobArg, `alternative does not pin _job_id: ${alt.chain}`).toBe(true);
      expect(alt.chain.trimStart().startsWith("'^"), `alternative is not ^-anchored: ${alt.chain}`).toBe(true);
      expect(alt.chain.trimEnd().endsWith("$'"), `alternative is not $-terminated: ${alt.chain}`).toBe(true);
    }
  });
});

// SHOWN ABLE TO FAIL: unpinning the uploader is the silent way to widen this
// too far — every good value still passes, and another party's photo becomes
// attachable to a dispute an admin decides money on.
// @mutate supabase/migrations/20260922172945_widen_dispute_evidence_url_ok_to_paths.sql | OR _url ~ ('^' \|\| _uploader::text \|\| '/disputes/' | OR _url ~ ('^' \|\| '[0-9a-f-]+' \|\| '/disputes/'
