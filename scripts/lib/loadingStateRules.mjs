/**
 * The pure rules of the loading-state check (Q1695): how a measured cluster is
 * keyed, what counts as a breach, what a byDesign entry covers, and which
 * baselined `allow` entries are stale. Dependency-free on purpose, so the
 * loading-states-refresh `land` job (no npm install) can prune the fixed
 * entries with scripts/audit/prune-loading-baseline.mjs using the SAME rules
 * scripts/check-loading-state-shape.mjs grades with.
 */
/**
 * How far a placeholder row may differ from the row that replaces it.
 *
 * 8px, not 0: a row whose content wraps to a second line genuinely cannot be
 * predicted, and sub-pixel rounding on a 2x screenshot costs a pixel either
 * way. Anything past 8px is a visible step — the owner's own report is a feed
 * whose bones sit 12px taller than its cards.
 */
export const ROW_BUDGET = 8;

/**
 * A surface's address as it holds from run to run. The measured job is the
 * newest job on prod at measuring time (a different id on most runs), so
 * `/jobs/<id>` is keyed as `/jobs/:id`. `/user/<id>` keeps its id: those are
 * the two shared test accounts, the same ids every run, and they are two
 * different surfaces (the Helpr's page and the poster's). `/jobs/settings` is
 * its own route (Q2200, 2026-10-19), never a job id: keying it as `/jobs/:id`
 * made two results share one surface and turned loadingStatesMerge red on
 * every refresh (Q1695, run 42302309191).
 */
export const JOB_ID_PATH = /\/jobs\/(?!settings(?:[/?#]|$))[^/?#]+/;
// Q1837: the run's own Declutter draft item is a new id every run too; only a uuid is keyed, so
// /declutter/item/test (the not-an-id path) stays its own surface.
export const stableUrl = (url) =>
  url.replace(new RegExp(`^${JOB_ID_PATH.source}`), "/jobs/:id").replace(/^\/declutter\/item\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, "/declutter/item/:id");

/** A cluster's stable identity across runs. */
export const clusterKey = (r, i) => `${r.persona} ${stableUrl(r.url)} #${i}`;

/** Every breach in a measurement set, as {key, kind, detail}. */
export function breaches(results) {
  const out = [];
  for (const r of results) {
    if (r.status !== "measured") continue;
    (r.clusters ?? []).forEach((c, i) => {
      const key = clusterKey(r, i);
      if (!c.realBox) return; // nothing landed there; reported separately
      if (c.deltaRowH != null && Math.abs(c.deltaRowH) > ROW_BUDGET) {
        out.push({ key, kind: "jump", path: c.path, delta: c.deltaRowH, detail: `row ${c.rowH[0]}px → ${c.rowH[1]}px (${c.deltaRowH > 0 ? "+" : ""}${c.deltaRowH}px)` });
      }
      if (c.rows?.[0] !== c.rows?.[1]) {
        out.push({ key, kind: "rows", path: c.path, detail: `${c.rows[0]} placeholder row(s) → ${c.rows[1]} real row(s)` });
      }
      if (Math.abs((c.media?.[0] ?? 0) - (c.media?.[1] ?? 0)) > 1) {
        out.push({ key, kind: "media", path: c.path, detail: `${c.media[0]} avatar/media bone(s) → ${c.media[1]} real` });
      }
    });
  }
  return out;
}

/**
 * Does a `byDesign` entry cover this breach? Key and kind must match, and an
 * entry may narrow itself further (loading-states run 39020198289, 2026-10-17):
 *   path        — only the element measured at that key (keys are by index,
 *                 so on another run `#0` can be a different element);
 *   maxDeltaPx  — only a jump where the real row is TALLER than its placeholder
 *                 by at most this many px, the size the decision accepts. A
 *                 bigger jump, or a placeholder taller than what replaces it,
 *                 is not the decided case and is reported like any other breach.
 * An entry with neither keeps the whole-key rule the profile tabs rely on.
 */
export function byDesignCovers(b, entries) {
  return entries.some((e) => {
    if (e.key !== b.key || e.kind !== b.kind) return false;
    if (e.path && e.path !== b.path) return false;
    if (e.maxDeltaPx != null && !(typeof b.delta === "number" && b.delta > 0 && b.delta <= e.maxDeltaPx)) return false;
    return true;
  });
}

/**
 * Baselined `allow` entries this run did not breach, split into the STALE
 * (fixed: delete them) and the UNOBSERVED (not measured this run: keep them).
 *
 * Keys are by index (`#0`), so a cluster not captured on one run shifts the
 * index: on 2026-09-27 run 36339804281 captured customer /post-job after its
 * data had landed, so `#0` was the nav bar and the page skeleton's entries read
 * as fixed; 36335322192, the run before, measured them breaching (Q766).
 * An entry that records the `path` it was measured on is judged only when a
 * cluster with that path sits at its key; otherwise it is unobserved. An entry
 * whose path IS measured and does not breach is stale, same as before.
 */
export function staleEntries(results, allowEntries, found) {
  const seen = new Set(found.map((b) => `${b.key}|${b.kind}`));
  const pathAt = new Map();
  for (const r of results) {
    if (r.status !== "measured") continue;
    (r.clusters ?? []).forEach((c, i) => { if (c.realBox) pathAt.set(clusterKey(r, i), c.path); });
  }
  const stale = [];
  const unobserved = [];
  for (const a of allowEntries) {
    const id = `${a.key}|${a.kind}`;
    if (seen.has(id)) continue;
    if (a.path && pathAt.get(a.key) !== a.path) unobserved.push(id);
    else stale.push(id);
  }
  return { stale, unobserved };
}
