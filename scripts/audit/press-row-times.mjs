#!/usr/bin/env node
/**
 * Writes scripts/audit/press-row-times.json: what each press row cost, measured
 * from press-every-control runs' artifacts, for the shard planner
 * (pressShardPlan.mjs).
 *
 *   gh run download <run> -R louisianahelpr/louisianahelpr -n press-every-control-leg-<n> -D <dir>/leg-<n>   (n = 1..6)
 *   node scripts/audit/press-row-times.mjs <run-id>=<dir> [<run-id>=<dir> ...]
 *
 * Per row (one shard's results.json, plus its request meter in request-budget/):
 *   - min:  wall time, from its own start to the next row's start in the same
 *           shard (rowTimings, Q1405); a shard's last row ends at its last
 *           control's start;
 *   - work: min less the time the row waited on the request ceiling (paceMs),
 *           i.e. what it costs when it is never throttled;
 *   - req:  the metered backend requests of the shard's own meter in the
 *           row's span (per epoch minute, prorated at the ends).
 * A row cut short or handed on is scaled by the controls its note says were
 * left (`with N control(s) ... unpressed`); `found` counts only the controls the
 * row got to, so it cannot be used for that. Within a run see runRowCosts;
 * across the runs given each row shape (real ids replaced, rowTimeKey) keeps the
 * LONGEST work and the MOST requests: the plan has to hold on the slow night.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROW_TIMES_FILE, rowTimeKey } from "./pressShardPlan.mjs";

const LEFT_RX = /with (\d+) control\(s\)/;

/** Metered requests between two instants, from a meter's epoch-minute counts. */
export function requestsInSpan(minutes, fromMs, toMs) {
  let n = 0;
  for (const [k, count] of Object.entries(minutes ?? {})) {
    const a = Number(k) * 60_000, b = a + 60_000;
    const overlap = Math.min(b, toMs) - Math.max(a, fromMs);
    if (overlap > 0) n += (count * overlap) / 60_000;
  }
  return n;
}

export function rowCostsFromResults(results, meterMinutes = {}) {
  const started = results.filter((r) => typeof r.startedAt === "number");
  const out = [];
  started.forEach((r, i) => {
    if (r.persona === "-") return; // a pure redirect route; a persona bounced at runtime ("redirect") is measured like any row
    const lastCtl = Math.max(r.startedAt, ...(r.controls ?? []).map((c) => c.startedAt ?? 0));
    const end = started[i + 1]?.startedAt ?? lastCtl;
    const min = (end - r.startedAt) / 60_000;
    const work = Math.max(0, min - (r.paceMs ?? 0) / 60_000);
    const req = requestsInSpan(meterMinutes, r.startedAt, end);
    const base = { key: rowTimeKey(r.route, r.persona), url: r.route, persona: r.persona };
    if (r.status === "handed-on" || r.status === "not-reached") {
      const done = r.found ?? 0;
      const left = Number(LEFT_RX.exec((r.notes ?? []).join(" "))?.[1] ?? NaN);
      if (!(done > 0) || !Number.isFinite(left)) return; // never got going: nothing measured
      const k = (done + left) / done;
      out.push({ ...base, min: min * k, work: work * k, req: req * k, complete: false });
      return;
    }
    out.push({ ...base, min, work, req, complete: true });
  });
  return out;
}

/**
 * One run's cost per row shape. A row handed on and then walked whole by a
 * later leg counts its whole walk; a row only ever cut short counts its scaled
 * measure. Several real rows of one shape in a run (the five /jobs/<id> rows,
 * one per job state) count their average, since the plan multiplies it back.
 */
export function runRowCosts(measures) {
  const byUrl = new Map();
  for (const m of measures) {
    const id = `${m.url}|${m.persona}`;
    const prev = byUrl.get(id);
    if (!prev || (m.complete && !prev.complete) || (m.complete === prev.complete && m.work > prev.work)) byUrl.set(id, m);
  }
  const byKey = new Map();
  for (const m of byUrl.values()) byKey.set(m.key, [...(byKey.get(m.key) ?? []), m]);
  const avg = (v, f) => v.reduce((a, m) => a + m[f], 0) / v.length;
  return new Map([...byKey].map(([k, v]) => [k, { min: avg(v, "min"), work: avg(v, "work"), req: avg(v, "req") }]));
}

function files(dir, pred) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p, pred));
    else if (pred(p)) out.push(p);
  }
  return out.sort();
}

/** The shard's own request meter: <leg>/request-budget/shard-N/*.json beside <leg>/test-results/.../shard-N/results.json. */
function meterFor(resultsFile) {
  const shard = /shard-(\d+)/.exec(resultsFile)?.[1];
  const leg = dirname(dirname(dirname(dirname(resultsFile))));
  const dir = join(leg, "request-budget", `shard-${shard}`);
  const found = statSync(dir, { throwIfNoEntry: false })?.isDirectory() ? files(dir, (p) => p.endsWith(".json")) : [];
  const minutes = {};
  for (const f of found) for (const [k, v] of Object.entries(JSON.parse(readFileSync(f, "utf8")).minutes ?? {})) minutes[k] = (minutes[k] ?? 0) + v;
  return { minutes, found: found.length > 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (!args.length) { console.error("usage: press-row-times.mjs <run-id>=<dir> ..."); process.exit(2); }
  const rows = new Map();
  const measuredFrom = [];
  for (const a of args) {
    const [run, dir] = a.split("=");
    const results = files(dir, (p) => p.endsWith("/results.json"));
    if (!results.length) { console.error(`no results.json under ${dir}`); process.exit(1); }
    let shardMin = 0, paceMin = 0, requests = 0;
    const measures = [];
    for (const f of results) {
      const meter = meterFor(f);
      if (!meter.found) { console.error(`no request meter beside ${f}`); process.exit(1); }
      const rs = JSON.parse(readFileSync(f, "utf8")).results;
      measures.push(...rowCostsFromResults(rs, meter.minutes));
      requests += Object.values(meter.minutes).reduce((x, y) => x + y, 0);
      paceMin += rs.reduce((x, r) => x + (r.paceMs ?? 0), 0) / 60_000;
      const st = rs.filter((r) => typeof r.startedAt === "number");
      if (st.length) shardMin += (Math.max(...st.at(-1).controls.map((c) => c.startedAt ?? 0), st.at(-1).startedAt) - st[0].startedAt) / 60_000;
    }
    measuredFrom.push({ run, shardMin: +shardMin.toFixed(1), paceMin: +paceMin.toFixed(1), requests });
    for (const [key, c] of runRowCosts(measures)) {
      const p = rows.get(key);
      rows.set(key, p ? { min: Math.max(p.min, c.min), work: Math.max(p.work, c.work), req: Math.max(p.req, c.req) } : c);
    }
  }
  const works = [...rows.values()].map((r) => r.work).sort((a, b) => a - b);
  const reqs = [...rows.values()].map((r) => r.req).sort((a, b) => a - b);
  const median = (v) => +v[Math.floor(v.length / 2)].toFixed(2);
  const out = {
    note: "Generated by scripts/audit/press-row-times.mjs from the runs in measuredFrom; read by pressShardPlan.mjs. Do not hand-edit.",
    measuredFrom,
    default: { work: median(works), req: Math.round(median(reqs)) },
    rows: Object.fromEntries([...rows].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, { min: +v.min.toFixed(2), work: +v.work.toFixed(2), req: Math.round(v.req) }])),
  };
  writeFileSync(ROW_TIMES_FILE, JSON.stringify(out, null, 2) + "\n");
  const sum = (f) => [...rows.values()].reduce((x, r) => x + r[f], 0).toFixed(1);
  console.log(`wrote ${ROW_TIMES_FILE}: ${rows.size} row shapes from ${measuredFrom.map((m) => m.run).join(", ")}; per shape summed: min ${sum("min")}, work ${sum("work")}, req ${sum("req")}`);
  for (const m of measuredFrom) console.log(`  run ${m.run}: shard time ${m.shardMin} min, pace wait ${m.paceMin} min, metered requests ${m.requests}`);
}
