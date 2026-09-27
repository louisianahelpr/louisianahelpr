/**
 * The text bounds `public.jobs` enforces (Q782, 2026-09-27): the CHECKs
 * jobs_title_length (char_length(title) <= 32) and jobs_description_length
 * (char_length(description) <= 1000), the same numbers as the post-job form
 * (src/components/postjob/detailsSection/detailsSectionConstants.ts).
 *
 * For every script, probe and e2e fixture that inserts a job without the form.
 * A fixture title usually carries a sweeper marker plus a per-run id; `runTag`
 * turns any run id into a fixed-width token so the whole title fits, and
 * `fitJobTitle` refuses (throws) rather than letting Postgres reject the insert
 * mid-journey with a bare 23514. src/test/jobTextFitsTheDbChecks.test.ts holds
 * all three numbers together.
 */
export const JOB_TITLE_MAX = 32;
export const JOB_DESCRIPTION_MAX = 1000;

/** Characters as Postgres char_length counts them (code points). */
export const charLength = (s) => Array.from(String(s)).length;

/**
 * A deterministic lowercase base-36 token of exactly `n` characters for any
 * seed (FNV-1a over the string). Same seed, same token, so a spec can compute
 * its title once and look the row up by it.
 */
export function runTag(seed, n = 6) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (const ch of String(seed)) {
    const c = ch.codePointAt(0);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  const s = h1.toString(36) + h2.toString(36) + "0000000000000";
  // The jobs contact-leak trigger rejects a run of 10+ digits in a title as a
  // phone number; break any 9-digit run so no token can trip it.
  return s.slice(0, n).replace(/\d{9}/g, (m) => `x${m.slice(1)}`);
}

/** Returns `title` unchanged, or throws naming it when it is over the DB's bound. */
export function fitJobTitle(title) {
  const n = charLength(title);
  if (n > JOB_TITLE_MAX) {
    throw new Error(`job title is ${n} characters; public.jobs allows ${JOB_TITLE_MAX} (jobs_title_length, Q782): ${title}`);
  }
  return title;
}
