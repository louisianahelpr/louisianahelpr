/**
 * PRESS SHARDS ARE PLANNED BY MEASURED COST, NOT BY ROUTE ORDER (lead ruling 2026-10-17).
 *
 * press-every-control 39014836855 (2026-10-17) failed leg 6 on its time budget
 * alone: shard 11 had 47 rows not reached and shard 12 spent its whole 45 min on
 * /admin?view=marketing + /admin?view=social (284 found, 186 pressed). Same
 * class on 38536821617 (10-14, leg 6: 18 + 1 not reached). Measured from those
 * two runs' artifacts (scripts/audit/press-row-times.mjs):
 *   - shard time 543.2 / 543.1 min, of which 314.5 / 370.6 min was waiting on
 *     the request ceiling, while the shards' meters averaged 83 / 87 requests a
 *     minute against a 400 ceiling: each shard paced to its own HALF of the
 *     ceiling (400 x 0.85 / 2 = 170) with a 100-request burst estimate, so any
 *     minute past ~70 requests waited for the next one, even with its sibling
 *     idle. pressSharedCeiling.mjs gives the two shards of a leg ONE meter.
 *   - every leg ended on a row it handed on and the next leg walked again from
 *     the start: 67.9 / 62.4 min, because the queue was claimed in App.tsx
 *     order, so a 20-40 min row was claimed with minutes left;
 *   - /admin?view=social alone needs more than one 45-min shard (50 min unpaced).
 *
 * So:
 *   1. every row has a measured cost (press-row-times.json): `work`, its minutes
 *      when never throttled, and `req`, its metered requests;
 *   2. a row whose work is over PART_CAP_MIN is split into parts, each part
 *      pressing every n-th top-level control (overlay children follow their
 *      opener), and no two parts of one row are planned into the same leg (the
 *      two shards of a leg run side by side on the same shared accounts);
 *   3. units are packed longest-first (LPT) into the shard whose leg the
 *      pacing model (5.) leaves shortest, and each shard walks its own units
 *      first, longest first;
 *   4. a shard with time left takes other shards' unclaimed whole rows (never
 *      their parts), longest first, and an earlier leg claims nothing it cannot
 *      finish in the time it has left (nothing handed on to be walked twice);
 *   5. the pacing model (legMinutes): a leg lasts as long as its busier shard's
 *      work, or as long as its combined requests take at the leg's usable rate
 *      (ceiling x PACE_HEADROOM, less one burst: the pacer waits once a minute
 *      cannot hold another), whichever is longer.
 * pressShardPlan.test.ts fails when any leg's modelled time is over the budget
 * times PLAN_MARGIN.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_CYCLE_BURST, PACE_HEADROOM } from "./pressFailureClass.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROW_TIMES_FILE = resolve(HERE, "press-row-times.json");

/** 12 shards, two side by side per leg (press-wave.sh, press-every-control.yml legs 1-6). */
export const PLAN_SHARDS = 12;
export const PLAN_WAVE_WIDTH = 2;
/** The leg's TIME_BUDGET_MIN (press-every-control.yml); the test holds them equal. */
export const PLAN_BUDGET_MIN = 45;
/** Every leg's modelled minutes stay at or under this share of its budget. */
export const PLAN_MARGIN = 0.9;
/** A row whose unthrottled work is over this is split into parts. */
export const PART_CAP_MIN = 15;
/** Each part pays its own sign-in, load and settle again. */
export const PART_OVERHEAD_MIN = 1;

/** Requests a minute one leg can send before its pacer waits (see 5. above). */
export function legRatePerMin(ceilingPerMinute) {
  return Math.floor(ceilingPerMinute * PACE_HEADROOM) - MIN_CYCLE_BURST;
}

const UUID_RX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** One key per row shape: real ids (job, user) differ run to run. */
export function rowTimeKey(url, persona) {
  return `${url.replace(UUID_RX, ":id")}|${persona}`;
}

export function loadRowTimes(file = ROW_TIMES_FILE) {
  if (!existsSync(file)) return { measuredFrom: [], default: { work: 2, req: 200 }, rows: {} };
  return JSON.parse(readFileSync(file, "utf8"));
}

/** A row's measured cost; a row never measured costs the file's default (the median row). */
export function rowCost(times, url, persona) {
  const m = times.rows?.[rowTimeKey(url, persona)];
  return m ? { work: m.work, req: m.req, measured: true } : { work: times.default?.work ?? 2, req: times.default?.req ?? 200, measured: false };
}

const legOf = (shard, width = PLAN_WAVE_WIDTH) => Math.ceil(shard / width);

/**
 * rows: [{ routeIdx, url, persona, redirect }] in route order (persona "-" for a redirect row).
 * Returns { units, bins }: units carry { key, part, parts, est, req, shard } (est =
 * work minutes), bins { shard, minutes, req, units }, each bin's units longest first.
 */
export function planShards({ rows, times, shards = PLAN_SHARDS, width = PLAN_WAVE_WIDTH, partCapMin = PART_CAP_MIN, ceilingPerMinute = 400 }) {
  const rate = legRatePerMin(ceilingPerMinute);
  const units = [];
  for (const r of rows) {
    const idx = String(r.routeIdx).padStart(3, "0");
    if (r.redirect) { units.push({ ...r, key: `${idx}-redirect`, part: 1, parts: 1, est: 0, req: 0 }); continue; }
    const { work, req } = rowCost(times, r.url, r.persona);
    const parts = work > partCapMin ? Math.ceil(work / partCapMin) : 1;
    for (let k = 1; k <= parts; k++) {
      units.push({
        ...r, key: parts > 1 ? `${idx}-${r.persona}-p${k}of${parts}` : `${idx}-${r.persona}`, part: k, parts,
        est: parts > 1 ? work / parts + PART_OVERHEAD_MIN : work, req: req / parts,
      });
    }
  }
  const order = [...units].sort((a, b) => b.est - a.est || b.req - a.req || a.routeIdx - b.routeIdx || a.persona.localeCompare(b.persona) || a.part - b.part);
  const bins = Array.from({ length: shards }, (_, i) => ({ shard: i + 1, minutes: 0, req: 0, units: [] }));
  const rowOf = (u) => `${u.routeIdx}-${u.persona}`;
  const legAfter = (bin, u) => {
    const leg = legOf(bin.shard, width);
    const mates = bins.filter((o) => legOf(o.shard, width) === leg);
    const work = Math.max(...mates.map((o) => o.minutes + (o === bin ? u.est : 0)));
    const req = mates.reduce((a, o) => a + o.req, 0) + u.req;
    return Math.max(work, req / rate);
  };
  for (const u of order) {
    let pick = null;
    for (const b of bins) {
      if (u.parts > 1) {
        const leg = legOf(b.shard, width);
        if (bins.some((o) => legOf(o.shard, width) === leg && o.units.some((x) => rowOf(x) === rowOf(u)))) continue;
      }
      // The leg this unit would make longest under the pacing model (legMinutes) is
      // the worst place for it: pick the shard whose leg stays shortest, then the
      // shard with the least work.
      const after = legAfter(b, u);
      if (!pick || after < pick.after || (after === pick.after && b.minutes < pick.bin.minutes)) pick = { bin: b, after };
    }
    if (pick) pick = pick.bin;
    if (!pick) throw new Error(`press plan: no leg left for part ${u.part}/${u.parts} of ${u.url} (${u.persona})`);
    pick.units.push(u);
    pick.minutes += u.est;
    pick.req += u.req;
    u.shard = pick.shard;
  }
  return { units: order, bins };
}

/** The pacing model: each leg's modelled minutes under one shared ceiling. */
export function legMinutes(plan, { ceilingPerMinute, width = PLAN_WAVE_WIDTH }) {
  const rate = legRatePerMin(ceilingPerMinute);
  const legs = new Map();
  for (const b of plan.bins) {
    const leg = legOf(b.shard, width);
    const l = legs.get(leg) ?? { leg, shards: [], work: 0, req: 0 };
    l.shards.push(b.shard);
    l.work = Math.max(l.work, b.minutes);
    l.req += b.req;
    legs.set(leg, l);
  }
  return [...legs.values()].map((l) => ({ ...l, paced: l.req / rate, minutes: Math.max(l.work, l.req / rate) }));
}

/**
 * The order one shard walks: its own units longest first, then every other
 * shard's whole rows (never another shard's parts, unless this is the last
 * wave, which takes what is left), longest first.
 */
export function shardWalkOrder(plan, shard, { lastWave }) {
  const own = plan.units.filter((u) => u.shard === shard);
  const rest = plan.units.filter((u) => u.shard !== shard && (lastWave || u.parts === 1));
  return [...own, ...rest];
}

/**
 * Whether a shard of an earlier wave should claim a unit with the time it has
 * left. The last wave claims everything (it reports what it cannot reach).
 */
export function unitFits({ estMin, elapsedMs, budgetMs, lastWave }) {
  if (lastWave || !(budgetMs > 0)) return true;
  return estMin * 60_000 <= budgetMs - elapsedMs;
}

/** Which top-level controls a part presses: every n-th, from its own offset. */
export function inPart(index, part, parts) {
  return parts <= 1 || index % parts === part - 1;
}
